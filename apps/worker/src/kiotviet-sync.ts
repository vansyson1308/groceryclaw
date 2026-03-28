import { createHash } from 'node:crypto';
import { decryptPayload, type EnvelopeEncrypted, type WorkerJobEnvelope } from '../../../packages/common/dist/index.js';
import type { KiotvietAdapter } from './kiotviet-adapter.js';
import { isRetriableKiotvietError } from './kiotviet-adapter.js';

export interface KiotvietSyncDeps {
  readonly queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
  readonly queryMany: (sql: string, params?: readonly unknown[]) => Promise<string[]>;
  readonly exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  readonly enqueue: (payload: Record<string, unknown>) => Promise<void>;
  readonly adapter: KiotvietAdapter;
  readonly syncEnabled: boolean;
  readonly maxRetries: number;
  readonly backoffBaseMs: number;
  readonly mekB64?: string;
  readonly branchId?: number;
}

function parseSecretRow(line: string): EnvelopeEncrypted | null {
  const [encryptedDekHex, encryptedValueHex, dekNonceHex, valueNonceHex] = line.split('|');
  if (!encryptedDekHex || !encryptedValueHex || !dekNonceHex || !valueNonceHex) {
    return null;
  }

  return {
    encryptedDek: Buffer.from(encryptedDekHex, 'hex'),
    encryptedValue: Buffer.from(encryptedValueHex, 'hex'),
    dekNonce: Buffer.from(dekNonceHex, 'hex'),
    valueNonce: Buffer.from(valueNonceHex, 'hex')
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sqlQuoteSync(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function resolveKiotvietOAuthToken(
  deps: KiotvietSyncDeps,
  tenantId: string,
  credentials: Record<string, unknown>
): Promise<string | null> {
  const clientId = typeof credentials.client_id === 'string' ? credentials.client_id : '';
  const clientSecret = typeof credentials.client_secret === 'string' ? credentials.client_secret : '';

  if (!clientId || !clientSecret) return null;

  // Check cache first
  const cachedRow = await deps.queryOne(`
    SELECT access_token
    FROM kiotviet_token_cache
    WHERE tenant_id = ${sqlQuoteSync(tenantId)}::uuid
      AND expires_at > now()
    LIMIT 1;
  `);

  const cachedToken = cachedRow.split('\n').map((x) => x.trim()).find((x) => x.length > 10);
  if (cachedToken) return cachedToken;

  // Exchange credentials for access token
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch('https://id.kiotviet.vn/connect/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          scopes: 'PublicApi.Access',
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret
        }).toString(),
        signal: controller.signal
      });

      if (!res.ok) return null;

      const data = await res.json() as { access_token?: string; expires_in?: number };
      if (!data.access_token) return null;

      const expiresInSeconds = data.expires_in ?? 3600;
      const expiresAt = new Date(Date.now() + (expiresInSeconds - 60) * 1000).toISOString();

      // Cache the token
      await deps.exec(`
        INSERT INTO kiotviet_token_cache (tenant_id, access_token, expires_at)
        VALUES (${sqlQuoteSync(tenantId)}::uuid, ${sqlQuoteSync(data.access_token)}, ${sqlQuoteSync(expiresAt)}::timestamptz)
        ON CONFLICT (tenant_id) DO UPDATE SET
          access_token = EXCLUDED.access_token,
          expires_at = EXCLUDED.expires_at,
          created_at = now();
      `);

      return data.access_token;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

// Helper to build a notification envelope (avoids repeating boilerplate)
function notifyEnvelope(job: WorkerJobEnvelope, message: string): Record<string, unknown> {
  return {
    job_type: 'NOTIFY_USER',
    notification_type: 'GENERIC_INFO',
    tenant_id: job.tenant_id,
    platform_user_id: job.platform_user_id,
    telegram_chat_id: job.telegram_chat_id,
    correlation_id: job.correlation_id,
    message_id: job.message_id,
    template_vars: { message }
  };
}

export async function processKiotvietSync(deps: KiotvietSyncDeps, job: WorkerJobEnvelope): Promise<void> {
  if (!job.tenant_id || !job.canonical_invoice_id) throw new Error('invalid_sync_job');

  if (!deps.syncEnabled) {
    await deps.exec(`
      INSERT INTO sync_results (tenant_id, canonical_invoice_id, external_system, status, payload)
      VALUES ($1::uuid, $2::uuid, 'kiotviet', 'skipped', '{"reason":"sync_disabled"}'::jsonb);
    `, [job.tenant_id, job.canonical_invoice_id]);
    return;
  }

  const sideEffectKey = `kiotviet:${job.canonical_invoice_id}`;
  const existing = await deps.queryOne(`
    SELECT metadata::text
    FROM idempotency_keys
    WHERE tenant_id = $1::uuid
      AND key_scope = 'kiotviet_sync'
      AND key_value = $2
    LIMIT 1;
  `, [job.tenant_id, sideEffectKey]);

  if (existing.trim()) {
    await deps.exec(`
      INSERT INTO audit_logs (tenant_id, actor_type, actor_id, event_type, resource_type, resource_id, payload)
      VALUES ($1::uuid, 'system', 'worker', 'kiotviet_sync_idempotent_hit', 'canonical_invoices', $2, '{}'::jsonb);
    `, [job.tenant_id, job.canonical_invoice_id]);
    return;
  }

  // Query resolved items with unit_price from canonical_invoice_items
  const resolvedRows = await deps.queryMany(`
    SELECT ri.resolved_sku || '|' || ri.quantity::text || '|' || COALESCE(ci.unit_price, 0)::text
    FROM resolved_invoice_items ri
    LEFT JOIN canonical_invoice_items ci ON ci.id = ri.canonical_item_id AND ci.tenant_id = ri.tenant_id
    WHERE ri.tenant_id = $1::uuid
      AND ri.canonical_invoice_id = $2::uuid
      AND ri.status = 'resolved'
    ORDER BY ri.id ASC;
  `, [job.tenant_id, job.canonical_invoice_id]);

  const items = resolvedRows
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sku, qty, price] = line.split('|');
      return { sku: sku ?? '', quantity: Number(qty ?? '0'), price: Number(price ?? '0') };
    })
    .filter((x) => x.sku.length > 0 && Number.isFinite(x.quantity) && x.quantity > 0);

  if (items.length === 0) {
    await deps.exec(`
      INSERT INTO sync_results (tenant_id, canonical_invoice_id, external_system, status, payload)
      VALUES ($1::uuid, $2::uuid, 'kiotviet', 'failed', '{"reason":"no_resolved_items"}'::jsonb);
    `, [job.tenant_id, job.canonical_invoice_id]);
    await deps.enqueue(notifyEnvelope(job, 'Khong co san pham nao duoc doi chieu thanh cong. Phieu nhap khong duoc tao.'));
    return;
  }

  // Resolve tenant retailer name for KiotViet Retailer header
  const retailerRow = await deps.queryOne(`
    SELECT kiotviet_retailer
    FROM tenants
    WHERE id = $1::uuid;
  `, [job.tenant_id]);
  const retailer = retailerRow.split('\n').map((x) => x.trim()).find((x) => x.length > 0) ?? '';

  if (!retailer) {
    await deps.exec(`
      INSERT INTO sync_results (tenant_id, canonical_invoice_id, external_system, status, payload)
      VALUES ($1::uuid, $2::uuid, 'kiotviet', 'failed', '{"reason":"missing_retailer"}'::jsonb);
    `, [job.tenant_id, job.canonical_invoice_id]);
    await deps.enqueue(notifyEnvelope(job, 'Chua cau hinh KiotViet cho cua hang. Vui long lien he ho tro.'));
    return;
  }

  let secretToken = '';
  if (deps.mekB64) {
    // Try kiotviet_client_credentials first (per-tenant OAuth), then fall back to kiotviet_token (legacy)
    for (const secretType of ['kiotviet_client_credentials', 'kiotviet_token'] as const) {
      const secretRow = await deps.queryOne(`
        SELECT encode(encrypted_dek, 'hex') || '|' || encode(encrypted_value, 'hex') || '|' || encode(dek_nonce, 'hex') || '|' || encode(value_nonce, 'hex')
        FROM secret_versions
        WHERE tenant_id = $1::uuid
          AND secret_type = $2
          AND status = 'active'
        ORDER BY version DESC
        LIMIT 1;
      `, [job.tenant_id, secretType]);

      const line = secretRow.split('\n').map((x) => x.trim()).find((x) => x.includes('|'));
      if (line) {
        const parsed = parseSecretRow(line);
        if (parsed) {
          const plaintext = decryptPayload(parsed, deps.mekB64);
          const payload = JSON.parse(plaintext) as Record<string, unknown>;

          if (secretType === 'kiotviet_client_credentials') {
            // OAuth flow: exchange client_id + client_secret for access token
            const accessToken = await resolveKiotvietOAuthToken(deps, job.tenant_id, payload);
            if (accessToken) {
              secretToken = accessToken;
              break;
            }
          } else if (typeof payload.token === 'string' && payload.token.trim()) {
            secretToken = payload.token;
            break;
          }
        }
      }
    }
  }

  if (deps.mekB64 && !secretToken) {
    await deps.exec(`
      INSERT INTO sync_results (tenant_id, canonical_invoice_id, external_system, status, payload)
      VALUES ($1::uuid, $2::uuid, 'kiotviet', 'failed', '{"reason":"missing_active_secret"}'::jsonb);
    `, [job.tenant_id, job.canonical_invoice_id]);
    await deps.enqueue(notifyEnvelope(job, 'Khong the xac thuc voi KiotViet. Vui long kiem tra lai cau hinh.'));
    return;
  }

  let lastError = '';
  for (let attempt = 1; attempt <= deps.maxRetries; attempt += 1) {
    try {
      const response = await deps.adapter.createPurchaseOrder({
        tenant_id: job.tenant_id,
        canonical_invoice_id: job.canonical_invoice_id,
        correlation_id: job.correlation_id,
        items
      }, { authToken: secretToken, retailer, ...(deps.branchId != null ? { branchId: deps.branchId } : {}) });

      const payloadHash = createHash('sha256').update(JSON.stringify(response.raw)).digest('hex');

      await deps.exec(`
        INSERT INTO idempotency_keys (tenant_id, key_scope, key_value, status, metadata)
        VALUES (
          $1::uuid,
          'kiotviet_sync',
          $2,
          'consumed',
          $3::jsonb
        )
        ON CONFLICT (tenant_id, key_scope, key_value) DO NOTHING;
      `, [job.tenant_id as string, sideEffectKey, JSON.stringify({ external_reference_id: response.externalReferenceId, payload_hash: payloadHash })]);

      await deps.exec(`
        INSERT INTO sync_results (tenant_id, canonical_invoice_id, external_system, external_reference_id, status, payload)
        VALUES ($1::uuid, $2::uuid, 'kiotviet', $3, 'success', $4::jsonb);
      `, [job.tenant_id as string, job.canonical_invoice_id as string, response.externalReferenceId, JSON.stringify(response.raw)]);

      await deps.exec(`
        INSERT INTO audit_logs (tenant_id, actor_type, actor_id, event_type, resource_type, resource_id, payload)
        VALUES ($1::uuid, 'system', 'worker', 'kiotviet_sync_success', 'canonical_invoices', $2, $3::jsonb);
      `, [job.tenant_id as string, job.canonical_invoice_id as string, JSON.stringify({ external_reference_id: response.externalReferenceId })]);

      // Notify user of success
      await deps.enqueue(notifyEnvelope(job,
        `Da tao phieu nhap kho thanh cong: ${response.externalReferenceId}. ${items.length} san pham.`));

      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      lastError = message;
      if (!isRetriableKiotvietError(message) || attempt >= deps.maxRetries) {
        break;
      }
      await sleep(deps.backoffBaseMs * attempt);
    }
  }

  await deps.exec(`
    INSERT INTO sync_results (tenant_id, canonical_invoice_id, external_system, status, payload)
    VALUES ($1::uuid, $2::uuid, 'kiotviet', 'failed', $3::jsonb);
  `, [job.tenant_id, job.canonical_invoice_id, JSON.stringify({ reason: lastError })]);

  // Notify user of failure (sanitize error — no sensitive info)
  await deps.enqueue(notifyEnvelope(job,
    'Khong the tao phieu nhap KiotViet. Vui long thu lai sau hoac lien he ho tro.'));
}
