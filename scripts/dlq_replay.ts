#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

interface DlqJobRow {
  id: string;
  tenant_id: string;
  type: string;
  status: string;
  payload: string;
}

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function runSql(sql: string, dbCmd: string): string {
  const result = spawnSync('bash', ['-lc', dbCmd], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  if (result.status !== 0) throw new Error('dlq_db_error');
  return result.stdout.trim();
}

function runQueue(payload: Record<string, unknown>, queueCmd: string): void {
  const message = JSON.stringify(payload).replace(/'/g, "''");
  const cmd = `${queueCmd} '${message}'`;
  const result = spawnSync('bash', ['-lc', cmd], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('dlq_queue_error');
}

export function planReplay(rows: DlqJobRow[], tenantId: string): { replayable: DlqJobRow[]; skipped: Array<{ id: string; reason: string }> } {
  const replayable: DlqJobRow[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const row of rows) {
    if (row.tenant_id !== tenantId) {
      skipped.push({ id: row.id, reason: 'tenant_mismatch' });
      continue;
    }
    if (row.status !== 'dead_letter') {
      skipped.push({ id: row.id, reason: `status_${row.status}` });
      continue;
    }
    replayable.push(row);
  }

  return { replayable, skipped };
}

async function main() {
  const dbCmd = getArg('--db-cmd') ?? process.env.ADMIN_DB_CMD ?? process.env.WORKER_DB_CMD ?? '';
  const queueCmd = getArg('--queue-cmd') ?? process.env.WORKER_QUEUE_CMD ?? process.env.GATEWAY_QUEUE_CMD ?? '';
  const tenantId = getArg('--tenant-id') ?? '';
  const jobIdsCsv = getArg('--job-ids') ?? '';
  const apply = hasFlag('--apply');

  if (!tenantId) throw new Error('missing --tenant-id');
  if (!jobIdsCsv.trim()) throw new Error('missing --job-ids <id1,id2,...>');

  const jobIds = jobIdsCsv.split(',').map((x) => x.trim()).filter(Boolean);

  // Strict no-side-effect dry-run mode: no DB/queue calls, plan only.
  if (!apply) {
    console.log(JSON.stringify({
      dry_run: true,
      tenant_id: tenantId,
      requested_job_ids: jobIds,
      replayable: [],
      skipped: jobIds.map((id) => ({ id, reason: 'dry_run_no_side_effects' })),
      note: 'Dry-run is side-effect free and does not query DB state.'
    }, null, 2));
    return;
  }

  if (!dbCmd) throw new Error('missing db cmd (--db-cmd or ADMIN_DB_CMD)');
  if (!queueCmd) throw new Error('missing queue cmd (--queue-cmd or WORKER_QUEUE_CMD)');

  const idsArray = jobIds.map((id) => `${sqlQuote(id)}::uuid`).join(', ');

  const out = runSql(`
    SELECT id::text || '|' || tenant_id::text || '|' || type || '|' || status || '|' || payload::text
    FROM jobs
    WHERE tenant_id = ${sqlQuote(tenantId)}::uuid
      AND id = ANY(ARRAY[${idsArray}]);
  `, dbCmd);

  const rows: DlqJobRow[] = out.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [id, tenant_id, type, status, ...payloadParts] = line.split('|');
    return { id, tenant_id, type, status, payload: payloadParts.join('|') || '{}' };
  });

  const { replayable, skipped } = planReplay(rows, tenantId);

  const replayedIds: string[] = [];
  for (const row of replayable) {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      skipped.push({ id: row.id, reason: 'invalid_payload_json' });
      continue;
    }

    const requeuePayload = { ...payload, enqueued_at_ms: Date.now(), replayed_from_job_id: row.id };
    runQueue(requeuePayload, queueCmd);

    runSql(`
      UPDATE jobs
      SET status = 'queued',
          attempts = 0,
          error_message = NULL,
          available_at = now(),
          updated_at = now()
      WHERE tenant_id = ${sqlQuote(tenantId)}::uuid
        AND id = ${sqlQuote(row.id)}::uuid
        AND status = 'dead_letter';
    `, dbCmd);

    replayedIds.push(row.id);
  }

  runSql(`
    INSERT INTO admin_audit_logs (actor_subject, auth_mode, action, target_tenant_id, payload, request_id)
    VALUES (
      'dlq_tool',
      'break_glass',
      'dlq_replay',
      ${sqlQuote(tenantId)}::uuid,
      ${sqlQuote(JSON.stringify({ replayed_job_ids: replayedIds, skipped }))}::jsonb,
      ${sqlQuote(randomUUID())}::uuid
    );
  `, dbCmd);

  console.log(JSON.stringify({ dry_run: false, tenant_id: tenantId, replayed_job_ids: replayedIds, skipped }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
