import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const auditFile = process.env.FAKE_ADMIN_AUDIT_FILE;
const stateFile = process.env.FAKE_ADMIN_STATE_FILE;
const sql = readFileSync(0, 'utf8');

function loadState() {
  if (!stateFile || !existsSync(stateFile)) {
    return { tenants: {}, invites: {}, secrets: {} };
  }
  return JSON.parse(readFileSync(stateFile, 'utf8'));
}

function saveState(state) {
  if (!stateFile) return;
  writeFileSync(stateFile, JSON.stringify(state), 'utf8');
}

const state = loadState();
if (!state.secrets) state.secrets = {};

if (auditFile) {
  appendFileSync(auditFile, `${sql}\n`, 'utf8');
}

if (sql.includes('INSERT INTO tenants')) {
  const id = '11111111-1111-1111-1111-111111111111';
  const nameMatch = sql.match(/VALUES \(\s*'([^']+)'/s);
  const name = nameMatch?.[1] ?? 'Tenant';
  state.tenants[id] = {
    id,
    name,
    processing_mode: 'legacy',
    status: 'active',
    config: {}
  };
  saveState(state);
  process.stdout.write(`${id}|${name}|legacy|active\n`);
  process.exit(0);
}

if (sql.includes('UPDATE tenants')) {
  const idMatch = sql.match(/WHERE id = '([0-9a-f-]{36})'::uuid/i);
  const id = idMatch?.[1] ?? '11111111-1111-1111-1111-111111111111';
  const tenant = state.tenants[id] ?? { id, name: 'Tenant', processing_mode: 'legacy', status: 'active', config: {} };
  if (sql.includes("processing_mode = 'v2'") || sql.includes("COALESCE('v2'::text, processing_mode)")) tenant.processing_mode = 'v2';
  if (sql.includes("processing_mode = 'legacy'") || sql.includes("COALESCE('legacy'::text, processing_mode)")) tenant.processing_mode = 'legacy';
  if (sql.includes("status = 'suspended'") || sql.includes("COALESCE('suspended'::text, status)")) tenant.status = 'suspended';
  if (sql.includes("status = 'active'") || sql.includes("COALESCE('active'::text, status)")) tenant.status = 'active';
  const cfgMatch = sql.match(/config = '([^']+)'::jsonb/s) ?? sql.match(/COALESCE\('([^']+)'::jsonb, config\)/s);
  if (cfgMatch?.[1]) {
    tenant.config = JSON.parse(cfgMatch[1].replace(/''/g, "'"));
  }
  state.tenants[id] = tenant;
  saveState(state);
  process.stdout.write(`${tenant.id}|${tenant.processing_mode}|${tenant.status}|${JSON.stringify(tenant.config)}\n`);
  process.exit(0);
}

if (sql.includes('FROM tenants') && sql.includes('LIMIT 1')) {
  const idMatch = sql.match(/WHERE id = '([0-9a-f-]{36})'::uuid/i);
  const id = idMatch?.[1] ?? '11111111-1111-1111-1111-111111111111';
  const tenant = state.tenants[id];
  if (!tenant) {
    process.exit(0);
  }
  process.stdout.write(`${tenant.id}|${tenant.name}|${tenant.processing_mode}|${tenant.status}|${JSON.stringify(tenant.config)}\n`);
  process.exit(0);
}

if (sql.includes('INSERT INTO invite_codes')) {
  const id = `22222222-2222-2222-2222-${String(Object.keys(state.invites).length + 1).padStart(12, '0')}`;
  const tenantIdMatch = sql.match(/VALUES \(\s*'([0-9a-f-]{36})'::uuid/);
  const tenantId = tenantIdMatch?.[1] ?? '11111111-1111-1111-1111-111111111111';
  const hashMatch = sql.match(/decode\('([0-9a-f]+)'/i);
  const codeHash = hashMatch?.[1] ?? '';
  const hintMatch = sql.match(/,\s*'([^']+)'\s*,\s*'staff'/s);
  const codeHint = hintMatch?.[1] ?? 'AB****CD';

  state.invites[id] = {
    id,
    tenant_id: tenantId,
    code_hash: codeHash,
    code_hint: codeHint,
    status: 'active',
    target_role: 'staff',
    expires_at: '2099-01-01T00:00:00.000Z'
  };
  saveState(state);
  process.stdout.write(`${id}|2099-01-01T00:00:00.000Z|active|staff\n`);
  process.exit(0);
}

if (sql.includes('FROM invite_codes')) {
  const tenantIdMatch = sql.match(/WHERE tenant_id = '([0-9a-f-]{36})'::uuid/i);
  const tenantId = tenantIdMatch?.[1] ?? '11111111-1111-1111-1111-111111111111';
  const lines = Object.values(state.invites)
    .filter((invite) => invite.tenant_id === tenantId)
    .map((invite) => `${invite.id}|${invite.status}|${invite.target_role}|${invite.code_hint}|${invite.expires_at}`)
    .join('\n');
  if (lines) process.stdout.write(`${lines}\n`);
  process.exit(0);
}

if (sql.includes('COALESCE(MAX(version), 0)') && sql.includes('FROM secret_versions')) {
  const tenantIdMatch = sql.match(/tenant_id = '([0-9a-f-]{36})'::uuid/i);
  const tenantId = tenantIdMatch?.[1] ?? '';
  const maxVersion = Object.values(state.secrets)
    .filter((s) => s.tenant_id === tenantId)
    .reduce((acc, item) => Math.max(acc, Number(item.version ?? 0)), 0);
  process.stdout.write(`${maxVersion}\n`);
  saveState(state);
  process.exit(0);
}

if (sql.includes('UPDATE secret_versions') && sql.includes("status = 'rotated'")) {
  const tenantIdMatch = sql.match(/tenant_id = '([0-9a-f-]{36})'::uuid/i);
  const tenantId = tenantIdMatch?.[1] ?? '';
  for (const secret of Object.values(state.secrets)) {
    if (secret.tenant_id === tenantId && secret.status === 'active') {
      secret.status = 'rotated';
    }
  }
}

if (sql.includes('INSERT INTO secret_versions')) {
  const tenantId = (sql.match(/VALUES \(\s*'([0-9a-f-]{36})'::uuid/s)?.[1]) ?? '11111111-1111-1111-1111-111111111111';
  const secretType = (sql.match(/,\s*'([^']+)'\s*,\s*\d+\s*,/s)?.[1]) ?? 'kiotviet_token';
  const version = Number((sql.match(/,\s*(\d+)\s*,\s*decode\('/s)?.[1]) ?? '1');
  const decodeMatches = [...sql.matchAll(/decode\('([0-9a-f]+)'\s*,\s*'hex'\)/ig)].map((m) => m[1] ?? '');
  const encryptedDek = decodeMatches[0] ?? '';
  const encryptedValue = decodeMatches[1] ?? '';
  const dekNonce = decodeMatches[2] ?? '';
  const valueNonce = decodeMatches[3] ?? '';
  const id = `33333333-3333-3333-3333-${String(Object.keys(state.secrets).length + 1).padStart(12, '0')}`;

  state.secrets[id] = {
    id,
    tenant_id: tenantId,
    secret_type: secretType,
    version,
    encrypted_dek: encryptedDek,
    encrypted_value: encryptedValue,
    dek_nonce: dekNonce,
    value_nonce: valueNonce,
    status: 'active',
    created_at: '2099-01-01T00:00:00.000Z',
    revoked_at: null
  };
  saveState(state);
  process.stdout.write(`${id}|${version}|active|2099-01-01T00:00:00.000Z\n`);
  process.exit(0);
}

if (sql.includes('UPDATE secret_versions') && sql.includes("status = 'revoked'")) {
  const uuidMatches = [...sql.matchAll(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/ig)].map((m) => m[1] ?? '');
  const secretId = uuidMatches[1] ?? uuidMatches[0] ?? '';
  const secret = state.secrets[secretId];
  if (!secret) {
    process.exit(0);
  }
  secret.status = 'revoked';
  secret.revoked_at = '2099-01-02T00:00:00.000Z';
  saveState(state);
  process.stdout.write(`${secret.id}|${secret.secret_type}|${secret.version}|${secret.status}|${secret.revoked_at}\n`);
  process.exit(0);
}

if (sql.includes('FROM secret_versions') && sql.includes('ORDER BY version DESC')) {
  const tenantIdMatch = sql.match(/tenant_id = '([0-9a-f-]{36})'::uuid/i);
  const tenantId = tenantIdMatch?.[1] ?? '';
  const lines = Object.values(state.secrets)
    .filter((secret) => secret.tenant_id === tenantId)
    .sort((a, b) => Number(b.version) - Number(a.version))
    .map((secret) => `${secret.id}|${secret.secret_type}|${secret.version}|${secret.status}|${secret.created_at}|${secret.revoked_at ?? ''}`)
    .join('\n');
  if (lines) process.stdout.write(`${lines}\n`);
  process.exit(0);
}

saveState(state);
