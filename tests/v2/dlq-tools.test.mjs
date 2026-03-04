import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const tenantId = '11111111-1111-1111-1111-111111111111';
const deadJob = '22222222-2222-2222-2222-222222222222';
const doneJob = '33333333-3333-3333-3333-333333333333';

test('dlq replay dry-run shows replay plan and does not mutate state', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'groceryclaw-dlq-'));
  const stateFile = path.join(dir, 'state.json');
  writeFileSync(stateFile, JSON.stringify({
    jobs: [
      { id: deadJob, tenant_id: tenantId, type: 'NOTIFY_USER', status: 'dead_letter', payload: { job_type: 'NOTIFY_USER', tenant_id: tenantId, platform_user_id: 'u1', zalo_msg_id: 'm1', correlation_id: 'c1', notification_type: 'GENERIC_INFO' } },
      { id: doneJob, tenant_id: tenantId, type: 'NOTIFY_USER', status: 'completed', payload: { job_type: 'NOTIFY_USER' } }
    ]
  }), 'utf8');

  const run = spawnSync('node', ['--experimental-strip-types', 'scripts/dlq_replay.ts', '--tenant-id', tenantId, '--job-ids', `${deadJob},${doneJob}`], {
    encoding: 'utf8',
    env: { ...process.env, ADMIN_DB_CMD: 'node tests/v2/integration/fake-dlq-db.mjs', FAKE_DLQ_STATE_FILE: stateFile }
  });

  assert.equal(run.status, 0);
  const output = JSON.parse(run.stdout);
  assert.equal(output.dry_run, true);
  assert.equal(output.replayable.length, 1);
  assert.equal(output.replayable[0].id, deadJob);

  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(state.jobs.find((x) => x.id === deadJob).status, 'dead_letter');
});

test('dlq replay apply requeues dead-letter and writes audit', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'groceryclaw-dlq-apply-'));
  const stateFile = path.join(dir, 'state.json');
  const auditFile = path.join(dir, 'audit.log');
  const queueFile = path.join(dir, 'queue.log');

  writeFileSync(stateFile, JSON.stringify({
    jobs: [
      { id: deadJob, tenant_id: tenantId, type: 'NOTIFY_USER', status: 'dead_letter', payload: { job_type: 'NOTIFY_USER', tenant_id: tenantId, platform_user_id: 'u1', zalo_msg_id: 'm1', correlation_id: 'c1', notification_type: 'GENERIC_INFO' } }
    ]
  }), 'utf8');

  const run = spawnSync('node', ['--experimental-strip-types', 'scripts/dlq_replay.ts', '--tenant-id', tenantId, '--job-ids', deadJob, '--apply'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ADMIN_DB_CMD: 'node tests/v2/integration/fake-dlq-db.mjs',
      WORKER_QUEUE_CMD: 'node tests/v2/integration/fake-queue.mjs',
      FAKE_DLQ_STATE_FILE: stateFile,
      FAKE_DLQ_AUDIT_FILE: auditFile,
      FAKE_QUEUE_FILE: queueFile
    }
  });

  assert.equal(run.status, 0);

  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(state.jobs.find((x) => x.id === deadJob).status, 'queued');

  const queued = readFileSync(queueFile, 'utf8');
  assert.match(queued, /"replayed_from_job_id":"22222222-2222-2222-2222-222222222222"/);

  const audit = readFileSync(auditFile, 'utf8');
  assert.match(audit, /dlq_replay/);
});
