import { decryptPayload, type EnvelopeEncrypted, type WorkerJobEnvelope } from '../../../packages/common/dist/index.js';
import type { HttpKiotvietAdapter } from './kiotviet-adapter.js';

export interface ProductSyncDeps {
  readonly queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
  readonly exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  readonly adapter: HttpKiotvietAdapter;
  readonly mekB64?: string;
}

function parseSecretRow(line: string): EnvelopeEncrypted | null {
  const [encryptedDekHex, encryptedValueHex, dekNonceHex, valueNonceHex] = line.split('|');
  if (!encryptedDekHex || !encryptedValueHex || !dekNonceHex || !valueNonceHex) return null;
  return {
    encryptedDek: Buffer.from(encryptedDekHex, 'hex'),
    encryptedValue: Buffer.from(encryptedValueHex, 'hex'),
    dekNonce: Buffer.from(dekNonceHex, 'hex'),
    valueNonce: Buffer.from(valueNonceHex, 'hex')
  };
}

async function resolveOAuthToken(deps: ProductSyncDeps, tenantId: string): Promise<{ token: string; retailer: string } | null> {
  if (!deps.mekB64) return null;

  const secretRow = await deps.queryOne(`
    SELECT encode(encrypted_dek, 'hex') || '|' || encode(encrypted_value, 'hex') || '|' || encode(dek_nonce, 'hex') || '|' || encode(value_nonce, 'hex')
    FROM secret_versions
    WHERE tenant_id = $1::uuid
      AND secret_type = 'kiotviet_client_credentials'
      AND status = 'active'
    ORDER BY version DESC LIMIT 1;
  `, [tenantId]);

  const line = secretRow.split('\n').map((x) => x.trim()).find((x) => x.includes('|'));
  if (!line) return null;

  const parsed = parseSecretRow(line);
  if (!parsed) return null;

  const plaintext = decryptPayload(parsed, deps.mekB64);
  const creds = JSON.parse(plaintext) as Record<string, unknown>;
  const clientId = typeof creds.client_id === 'string' ? creds.client_id : '';
  const clientSecret = typeof creds.client_secret === 'string' ? creds.client_secret : '';
  const retailer = typeof creds.retailer === 'string' ? creds.retailer : '';

  if (!clientId || !clientSecret || !retailer) return null;

  // Check token cache
  const cachedRow = await deps.queryOne(`
    SELECT access_token FROM kiotviet_token_cache
    WHERE tenant_id = $1::uuid AND expires_at > now() LIMIT 1;
  `, [tenantId]);
  const cachedToken = cachedRow.split('\n').map((x) => x.trim()).find((x) => x.length > 10);
  if (cachedToken) return { token: cachedToken, retailer };

  // Exchange credentials
  const res = await fetch('https://id.kiotviet.vn/connect/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      scopes: 'PublicApi.Access',
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    }).toString(),
    signal: AbortSignal.timeout(10_000)
  });

  if (!res.ok) return null;
  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;

  const expiresAt = new Date(Date.now() + ((data.expires_in ?? 3600) - 60) * 1000).toISOString();
  await deps.exec(`
    INSERT INTO kiotviet_token_cache (tenant_id, access_token, expires_at)
    VALUES ($1::uuid, $2, $3::timestamptz)
    ON CONFLICT (tenant_id) DO UPDATE SET access_token = EXCLUDED.access_token, expires_at = EXCLUDED.expires_at, created_at = now();
  `, [tenantId, data.access_token, expiresAt]);

  return { token: data.access_token, retailer };
}

export async function processKiotvietProductSync(deps: ProductSyncDeps, job: WorkerJobEnvelope): Promise<{ synced: number }> {
  if (!job.tenant_id) throw new Error('product_sync_missing_tenant');

  const auth = await resolveOAuthToken(deps, job.tenant_id);
  if (!auth) throw new Error('product_sync_no_credentials');

  let totalSynced = 0;
  let currentItem = 0;
  const pageSize = 100;

  while (true) {
    const page = await deps.adapter.listProducts(
      { authToken: auth.token, retailer: auth.retailer },
      { pageSize, currentItem }
    );

    if (page.data.length === 0) break;

    for (const product of page.data) {
      if (!product.code) continue;
      await deps.exec(`
        INSERT INTO product_cache (tenant_id, sku, product_name, barcode, unit, active, updated_at)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, now())
        ON CONFLICT (tenant_id, sku) DO UPDATE SET
          product_name = EXCLUDED.product_name,
          barcode = EXCLUDED.barcode,
          unit = EXCLUDED.unit,
          active = EXCLUDED.active,
          updated_at = now();
      `, [
        job.tenant_id,
        product.code,
        product.name ?? product.code,
        product.barCode ?? null,
        product.unit ?? null,
        product.isActive !== false
      ]);
      totalSynced++;
    }

    currentItem += page.data.length;
    if (currentItem >= page.total) break;
    if (currentItem > 10000) break; // safety limit
  }

  await deps.exec(`
    INSERT INTO audit_logs (tenant_id, actor_type, actor_id, event_type, resource_type, resource_id, payload)
    VALUES ($1::uuid, 'system', 'worker', 'kiotviet_product_sync', 'product_cache', $1, $2::jsonb);
  `, [job.tenant_id, JSON.stringify({ synced: totalSynced })]);

  return { synced: totalSynced };
}
