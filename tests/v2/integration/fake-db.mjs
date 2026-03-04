import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const stateFile = process.env.FAKE_DB_STATE_FILE;
const sql = readFileSync(0, 'utf8');

function loadState() {
  if (!stateFile || !existsSync(stateFile)) {
    return { linked: false, tenant_id: '11111111-1111-1111-1111-111111111111', processing_mode: 'v2', db_calls: 0, tenants: {} };
  }
  const loaded = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (!loaded.tenants) loaded.tenants = {};
  return loaded;
}

function resolveTenantRecord(state) {
  if (state.tenants && state.tenant_id && state.tenants[state.tenant_id]) {
    return state.tenants[state.tenant_id];
  }
  return null;
}


function saveState(state) {
  if (!stateFile) return;
  writeFileSync(stateFile, JSON.stringify(state), 'utf8');
}

const state = loadState();
state.db_calls += 1;

if (sql.includes('resolve_membership_by_platform_user_id')) {
  const tenant = resolveTenantRecord(state);
  if (state.linked) {
    process.stdout.write(`${tenant?.id ?? state.tenant_id}\n`);
  }
  saveState(state);
  process.exit(0);
}

if (sql.includes('consume_invite_code')) {
  if (sql.includes('GOODCODE')) {
    state.linked = true;
    process.stdout.write(`t|${state.tenant_id}|staff\n`);
  } else {
    process.stdout.write('f||\n');
  }
  saveState(state);
  process.exit(0);
}

if (sql.includes('SELECT processing_mode')) {
  const tenant = resolveTenantRecord(state);
  process.stdout.write(`${tenant?.processing_mode ?? state.processing_mode}\n`);
  saveState(state);
  process.exit(0);
}

if (sql.includes('UPDATE zalo_users') && sql.includes('last_interaction_at')) {
  process.stdout.write('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\n');
  saveState(state);
  process.exit(0);
}

if (sql.includes('FROM zalo_users') && sql.includes('platform_user_id')) {
  process.stdout.write('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\n');
  saveState(state);
  process.exit(0);
}

if (sql.includes('INSERT INTO inbound_events')) {
  process.stdout.write('22222222-2222-2222-2222-222222222222\n');
  saveState(state);
  process.exit(0);
}

saveState(state);
