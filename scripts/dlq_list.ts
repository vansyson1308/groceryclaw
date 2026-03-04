#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
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
  if (result.status !== 0) {
    throw new Error('dlq_db_error');
  }
  return result.stdout.trim();
}

async function main() {
  const dbCmd = getArg('--db-cmd') ?? process.env.ADMIN_DB_CMD ?? process.env.WORKER_DB_CMD ?? '';
  const tenantId = getArg('--tenant-id');
  const jobType = getArg('--job-type');
  const status = getArg('--status') ?? 'dead_letter';
  const limit = Number(getArg('--limit') ?? '100');

  if (!dbCmd) throw new Error('missing db cmd (--db-cmd or ADMIN_DB_CMD)');

  const where: string[] = [`status = ${sqlQuote(status)}`];
  if (tenantId) where.push(`tenant_id = ${sqlQuote(tenantId)}::uuid`);
  if (jobType) where.push(`type = ${sqlQuote(jobType)}`);

  const out = runSql(`
    SELECT id::text || '|' || tenant_id::text || '|' || type || '|' || status || '|' || attempts::text || '|' || max_attempts::text || '|' || created_at::text || '|' || COALESCE(error_message, '')
    FROM jobs
    WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT ${Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100};
  `, dbCmd);

  const items = out.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [id, tenant_id, type, statusText, attempts, max_attempts, created_at, error_message] = line.split('|');
    return { id, tenant_id, type, status: statusText, attempts: Number(attempts), max_attempts: Number(max_attempts), created_at, error_message: error_message || null };
  });

  console.log(JSON.stringify({ status_filter: status, tenant_id: tenantId ?? null, job_type: jobType ?? null, count: items.length, items }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
