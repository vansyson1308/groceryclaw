import test from 'node:test';
import assert from 'node:assert/strict';
import { runTenantScopedTransaction } from '../../apps/worker/dist/db-session.js';

test('runTenantScopedTransaction sets tenant context per call without bleed', async () => {
  const seenSql = [];
  const db = {
    async runSql(sql) {
      seenSql.push(sql);
    }
  };

  await runTenantScopedTransaction({
    db,
    tenantId: 'tenant-a',
    jobType: 'PROCESS_INBOUND_EVENT',
    work: async () => {}
  });

  await runTenantScopedTransaction({
    db,
    tenantId: 'tenant-b',
    jobType: 'NOTIFY_USER',
    work: async () => {}
  });

  const setTenantStatements = seenSql.filter((sql) => sql.includes('SET LOCAL app.current_tenant'));
  assert.equal(setTenantStatements.length, 2);
  assert.ok(setTenantStatements[0].includes("tenant-a"));
  assert.ok(setTenantStatements[1].includes("tenant-b"));
});
