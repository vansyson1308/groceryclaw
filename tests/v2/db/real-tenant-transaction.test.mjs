import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPgPool,
  closePool,
  query,
  runTenantScopedTransaction
} from '../../../packages/common/dist/index.js';

const dbUrl = process.env.DATABASE_URL;
const skip = !dbUrl;

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

let pool;

async function scalar(sql, params = []) {
  const result = await query(pool, sql, params);
  const row = result.rows[0] ?? {};
  return String(Object.values(row)[0] ?? '');
}

async function setupFixture() {
  await query(pool, 'BEGIN');
  try {
    await query(pool, `
      DELETE FROM sync_results;
      DELETE FROM resolved_invoice_items;
      DELETE FROM unit_conversions;
      DELETE FROM product_cache;
      DELETE FROM mapping_dictionary;
      DELETE FROM canonical_invoice_items;
      DELETE FROM canonical_invoices;
      DELETE FROM admin_audit_logs;
      DELETE FROM audit_logs;
      DELETE FROM pending_notifications;
      DELETE FROM idempotency_keys;
      DELETE FROM jobs;
      DELETE FROM inbound_events;
      DELETE FROM secret_versions;
      DELETE FROM invite_codes;
      DELETE FROM tenant_users;
      DELETE FROM zalo_users;
      DELETE FROM tenants;

      INSERT INTO tenants (id, name, status, processing_mode)
      VALUES
        ($1::uuid, 'Tenant A', 'active', 'v2'),
        ($2::uuid, 'Tenant B', 'active', 'v2');
    `, [TENANT_A, TENANT_B]);
    await query(pool, 'COMMIT');
  } catch (error) {
    await query(pool, 'ROLLBACK');
    throw error;
  }
}

test('db integration setup', { skip }, async () => {
  pool = await createPgPool({
    connectionString: dbUrl,
    applicationName: 'db-real-tests',
    statementTimeoutMs: 5000
  });
  await setupFixture();
});

test('tenant scoping enforces RLS isolation inside transaction helper', { skip }, async () => {
  const visibleA = await runTenantScopedTransaction({
    pool,
    tenantId: TENANT_A,
    applicationName: 'worker:TEST_A',
    work: async (client) => {
      await query(client, 'SET LOCAL ROLE groceryclaw_app_user');
      const out = await query(client, 'SELECT count(*)::int AS c FROM tenants');
      return Number(out.rows[0]?.c ?? 0);
    }
  });

  const visibleB = await runTenantScopedTransaction({
    pool,
    tenantId: TENANT_B,
    applicationName: 'worker:TEST_B',
    work: async (client) => {
      await query(client, 'SET LOCAL ROLE groceryclaw_app_user');
      const out = await query(client, 'SELECT count(*)::int AS c FROM tenants');
      return Number(out.rows[0]?.c ?? 0);
    }
  });

  assert.equal(visibleA, 1);
  assert.equal(visibleB, 1);
});

test('missing tenant context fails safe for app role', { skip }, async () => {
  const count = await scalar(`
    BEGIN;
      SET LOCAL ROLE groceryclaw_app_user;
      RESET app.current_tenant;
      SELECT count(*)::int FROM tenants;
    COMMIT;
  `);
  assert.equal(count, '0');
});

test('rollback removes inserted rows on thrown error', { skip }, async () => {
  await assert.rejects(async () => {
    await runTenantScopedTransaction({
      pool,
      tenantId: TENANT_A,
      applicationName: 'worker:ROLLBACK',
      work: async (client) => {
        await query(client, 'SET LOCAL ROLE groceryclaw_app_user');
        await query(
          client,
          "INSERT INTO jobs (tenant_id, type, payload) VALUES ($1::uuid, 'rollback_probe', '{}'::jsonb)",
          [TENANT_A]
        );
        throw new Error('force_rollback');
      }
    });
  }, /force_rollback/);

  const persisted = await scalar("SELECT count(*)::int FROM jobs WHERE tenant_id = $1::uuid AND type = 'rollback_probe'", [TENANT_A]);
  assert.equal(persisted, '0');
});

test('no tenant bleed between sequential transactions', { skip }, async () => {
  const outA = await runTenantScopedTransaction({
    pool,
    tenantId: TENANT_A,
    applicationName: 'worker:BLEED_A',
    work: async (client) => {
      await query(client, 'SET LOCAL ROLE groceryclaw_app_user');
      const out = await query(client, 'SELECT id::text FROM tenants LIMIT 1');
      return String(out.rows[0]?.id ?? '');
    }
  });

  const outB = await runTenantScopedTransaction({
    pool,
    tenantId: TENANT_B,
    applicationName: 'worker:BLEED_B',
    work: async (client) => {
      await query(client, 'SET LOCAL ROLE groceryclaw_app_user');
      const out = await query(client, 'SELECT id::text FROM tenants LIMIT 1');
      return String(out.rows[0]?.id ?? '');
    }
  });

  assert.equal(outA, TENANT_A);
  assert.equal(outB, TENANT_B);
});

test('db integration teardown', { skip }, async () => {
  if (pool) {
    await closePool(pool);
  }
});
