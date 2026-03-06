import { createHash } from 'node:crypto';
import { decryptPayload, type EnvelopeEncrypted, type WorkerJobEnvelope } from '../../../packages/common/dist/index.js';
import { runTenantScopedTransaction } from './db-session.js';
import type { KiotvietAdapter } from './kiotviet-adapter.js';
import { isRetriableKiotvietError } from './kiotviet-adapter.js';

export interface KiotvietSyncDeps {
  readonly queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
  readonly queryMany: (sql: string, params?: readonly unknown[]) => Promise<string[]>;
  readonly exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  readonly adapter: KiotvietAdapter;
  readonly syncEnabled: boolean;
  readonly maxRetries: number;
  readonly backoffBaseMs: number;
  readonly mekB64?: string;
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

  const resolvedRows = await deps.queryMany(`
    SELECT resolved_sku || '|' || quantity::text
    FROM resolved_invoice_items
    WHERE tenant_id = $1::uuid
      AND canonical_invoice_id = $2::uuid
      AND status = 'resolved'
    ORDER BY id ASC;
  `, [job.tenant_id, job.canonical_invoice_id]);

  const items = resolvedRows
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sku, qty] = line.split('|');
      return { sku: sku ?? '', quantity: Number(qty ?? '0') };
    })
    .filter((x) => x.sku.length > 0 && Number.isFinite(x.quantity) && x.quantity > 0);

  if (items.length === 0) {
    await deps.exec(`
      INSERT INTO sync_results (tenant_id, canonical_invoice_id, external_system, status, payload)
      VALUES ($1::uuid, $2::uuid, 'kiotviet', 'failed', '{"reason":"no_resolved_items"}'::jsonb);
    `, [job.tenant_id, job.canonical_invoice_id]);
    return;
  }

  let secretToken = '';
  if (deps.mekB64) {
    const secretRow = await deps.queryOne(`
      SELECT encode(encrypted_dek, 'hex') || '|' || encode(encrypted_value, 'hex') || '|' || encode(dek_nonce, 'hex') || '|' || encode(value_nonce, 'hex')
      FROM secret_versions
      WHERE tenant_id = $1::uuid
        AND secret_type = 'kiotviet_token'
        AND status = 'active'
      ORDER BY version DESC
      LIMIT 1;
    `, [job.tenant_id]);

    const line = secretRow.split('\n').map((x) => x.trim()).find((x) => x.includes('|'));
    if (line) {
      const parsed = parseSecretRow(line);
      if (parsed) {
        const plaintext = decryptPayload(parsed, deps.mekB64);
        const payload = JSON.parse(plaintext) as Record<string, unknown>;
        if (typeof payload.token === 'string' && payload.token.trim()) {
          secretToken = payload.token;
        }
      }
    }
  }

  if (deps.mekB64 && !secretToken) {
    await deps.exec(`
      INSERT INTO sync_results (tenant_id, canonical_invoice_id, external_system, status, payload)
      VALUES ($1::uuid, $2::uuid, 'kiotviet', 'failed', '{"reason":"missing_active_secret"}'::jsonb);
    `, [job.tenant_id, job.canonical_invoice_id]);
    return;
  }

  let lastError = '';
  for (let attempt = 1; attempt <= deps.maxRetries; attempt += 1) {
    try {
      const response = await deps.adapter.upsertImportDraft({
        tenant_id: job.tenant_id,
        canonical_invoice_id: job.canonical_invoice_id,
        correlation_id: job.correlation_id,
        items
      }, secretToken || undefined);

      const payloadHash = createHash('sha256').update(JSON.stringify(response.raw)).digest('hex');

      await runTenantScopedTransaction({
        db: { runSql: deps.exec },
        tenantId: job.tenant_id,
        jobType: 'KIOTVIET_SYNC',
        work: async () => {
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
        }
      });
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
}
