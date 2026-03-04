import { createHash, randomUUID } from 'node:crypto';
import { runSql } from './db_v2_lib.mjs';

function readInt(name, fallback) {
  const value = Number(process.env[name] ?? String(fallback));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const tenantCount = readInt('LOAD_TENANT_COUNT', 50);
const usersPerTenant = readInt('LOAD_USERS_PER_TENANT', 10);
const includeSecrets = (process.env.LOAD_SEED_INCLUDE_SECRETS ?? 'true') === 'true';
const secretType = process.env.LOAD_SECRET_TYPE ?? 'kiotviet_token';

function sqlQuote(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

let tenantRows = '';
let userRows = '';
let membershipRows = '';
let secretRows = '';

for (let t = 0; t < tenantCount; t += 1) {
  const tenantId = randomUUID();
  const tenantCode = `load_tenant_${t}`;

  tenantRows += `(${sqlQuote(tenantId)}::uuid, ${sqlQuote(`Load Tenant ${t}`)}, ${sqlQuote(tenantCode)}, 'v2', 'active', '{"load":true}'::jsonb),\n`;

  for (let u = 0; u < usersPerTenant; u += 1) {
    const platformUserId = `load_tenant_${t}_user_${u}`;
    const zaloUserId = randomUUID();
    userRows += `(${sqlQuote(zaloUserId)}::uuid, ${sqlQuote(platformUserId)}, ${sqlQuote(`Load user ${t}-${u}`)}, now(), now()),\n`;
    membershipRows += `(${sqlQuote(randomUUID())}::uuid, ${sqlQuote(tenantId)}::uuid, ${sqlQuote(zaloUserId)}::uuid, 'staff', 'active'),\n`;
  }

  if (includeSecrets) {
    const token = createHash('sha256').update(`${tenantCode}:token`).digest('hex');
    const fakeCiphertext = Buffer.from(JSON.stringify({ token })).toString('hex');
    secretRows += `(${sqlQuote(randomUUID())}::uuid, ${sqlQuote(tenantId)}::uuid, ${sqlQuote(secretType)}, 1, decode(${sqlQuote(fakeCiphertext)}, 'hex'), decode(${sqlQuote(fakeCiphertext)}, 'hex'), decode('00112233445566778899aabb', 'hex'), decode('00112233445566778899aabb', 'hex'), 'active', now()),\n`;
  }
}

const trim = (v) => (v ? v.slice(0, -2) : '');

runSql(`
BEGIN;
INSERT INTO tenants (id, name, kiotviet_retailer, processing_mode, status, config)
VALUES
${trim(tenantRows)}
ON CONFLICT (id) DO UPDATE SET
  processing_mode = EXCLUDED.processing_mode,
  status = EXCLUDED.status,
  config = EXCLUDED.config;

INSERT INTO zalo_users (id, platform_user_id, display_name, last_interaction_at, updated_at)
VALUES
${trim(userRows)}
ON CONFLICT (platform_user_id) DO UPDATE SET
  last_interaction_at = EXCLUDED.last_interaction_at;

INSERT INTO tenant_users (id, tenant_id, zalo_user_id, role, status)
VALUES
${trim(membershipRows)}
ON CONFLICT (tenant_id, zalo_user_id) DO UPDATE SET
  status = EXCLUDED.status;
${includeSecrets ? `
INSERT INTO secret_versions (id, tenant_id, secret_type, version, encrypted_dek, encrypted_value, dek_nonce, value_nonce, status, created_at)
VALUES
${trim(secretRows)}
ON CONFLICT (id) DO NOTHING;
` : ''}
COMMIT;
`);

console.log(JSON.stringify({ seeded_tenants: tenantCount, users_per_tenant: usersPerTenant, include_secrets: includeSecrets }));
