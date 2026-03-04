import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const stateFile = process.env.FAKE_DLQ_STATE_FILE;
const auditFile = process.env.FAKE_DLQ_AUDIT_FILE;
const sql = readFileSync(0, 'utf8');

function loadState() {
  if (!stateFile || !existsSync(stateFile)) {
    return { jobs: [] };
  }
  return JSON.parse(readFileSync(stateFile, 'utf8'));
}

function saveState(state) {
  if (!stateFile) return;
  writeFileSync(stateFile, JSON.stringify(state), 'utf8');
}

const state = loadState();
if (!state.jobs) state.jobs = [];

if (sql.includes('FROM jobs') && sql.includes('id = ANY')) {
  const tenantId = sql.match(/tenant_id = '([0-9a-f-]{36})'::uuid/i)?.[1] ?? '';
  const ids = [...sql.matchAll(/'([0-9a-f-]{36})'::uuid/g)].map((m) => m[1]);
  const lines = state.jobs
    .filter((j) => j.tenant_id === tenantId && ids.includes(j.id))
    .map((j) => `${j.id}|${j.tenant_id}|${j.type}|${j.status}|${JSON.stringify(j.payload)}`)
    .join('\n');
  if (lines) process.stdout.write(`${lines}\n`);
  process.exit(0);
}

if (sql.includes('UPDATE jobs') && sql.includes("status = 'queued'")) {
  const id = sql.match(/\bAND\s+id\s*=\s*'([0-9a-f-]{36})'::uuid/i)?.[1] ?? '';
  const row = state.jobs.find((j) => j.id === id);
  if (row && row.status === 'dead_letter') {
    row.status = 'queued';
    row.attempts = 0;
  }
  saveState(state);
  process.exit(0);
}

if (sql.includes('INSERT INTO admin_audit_logs') && sql.includes('dlq_replay')) {
  if (auditFile) appendFileSync(auditFile, `${sql}\n`, 'utf8');
  process.exit(0);
}

if (sql.includes('FROM jobs') && sql.includes('ORDER BY created_at DESC')) {
  const lines = state.jobs.map((j) => `${j.id}|${j.tenant_id}|${j.type}|${j.status}|${j.attempts || 0}|${j.max_attempts || 4}|2026-01-01T00:00:00.000Z|${j.error_message || ''}`).join('\n');
  if (lines) process.stdout.write(`${lines}\n`);
  process.exit(0);
}

saveState(state);
