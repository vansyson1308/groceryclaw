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

async function scalar(sql, params) {
  // When params is undefined, call query without it to avoid the extended
  // query protocol, which rejects multi-statement strings. When params IS
  // provided (even []), the extended protocol is used — single statement only.
  const result = params !== undefined
    ? await query(pool, sql, params)
    : await query(pool, sql);

  // Guard against multi-statement results (pg returns an array) and empty
  // result sets so callers get null instead of a cryptic TypeError.
  const rows = Array.isArray(result) ? (result.at(-1)?.rows ?? []) : (result.rows ?? []);
  if (rows.length === 0) return null;
  return String(Object.values(rows[0])[0] ?? '');
}

async function setupFixture() {
  // Use postgres superuser for setup to bypass RLS
  const adminPool = await createPgPool({
    connectionString: dbUrl.replace('app_user', 'postgres').replace('app_password', 'postgres'),
    applicationName: 'db-real-tests-admin',
    statementTimeoutMs: 5000
  });

  await query(adminPool, 'BEGIN');
  try {
    // Delete in correct order to respect foreign key constraints
    await query(adminPool, 'DELETE FROM sync_results');
    await query(adminPool, 'DELETE FROM resolved_invoice_items');
    await query(adminPool, 'DELETE FROM unit_conversions');
    await query(adminPool, 'DELETE FROM product_cache');
    await query(adminPool, 'DELETE FROM mapping_dictionary');
    await query(adminPool, 'DELETE FROM canonical_invoice_items');
    await query(adminPool, 'DELETE FROM canonical_invoices');
    await query(adminPool, 'DELETE FROM admin_audit_logs');
    await query(adminPool, 'DELETE FROM audit_logs');
    await query(adminPool, 'DELETE FROM pending_notifications');
    await query(adminPool, 'DELETE FROM idempotency_keys');
    await query(adminPool, 'DELETE FROM jobs');
    await query(adminPool, 'DELETE FROM inbound_events');
    await query(adminPool, 'DELETE FROM secret_versions');
    await query(adminPool, 'DELETE FROM invite_codes');
    await query(adminPool, 'DELETE FROM tenant_users');
    await query(adminPool, 'DELETE FROM zalo_users');
    await query(adminPool, 'DELETE FROM tenants');

    await query(
      adminPool,
      'INSERT INTO tenants (id, name, status, processing_mode) VALUES ($1, $2, $3, $4)',
      [TENANT_A, 'Tenant A', 'active', 'v2']
    );
    await query(
      adminPool,
      'INSERT INTO tenants (id, name, status, processing_mode) VALUES ($1, $2, $3, $4)',
      [TENANT_B, 'Tenant B', 'active', 'v2']
    );

    await query(adminPool, 'COMMIT');
    await closePool(adminPool);
  } catch (error) {
    await query(adminPool, 'ROLLBACK');
    await closePool(adminPool);
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
  // Verify RLS hides all rows when no tenant context is set.
  // Use a dedicated client so SET LOCAL ROLE scopes correctly,
  // and execute statements individually.
  const client = await pool.connect();
  try {
    await query(client, 'BEGIN');
    await query(client, 'SET LOCAL ROLE groceryclaw_app_user');
    await query(client, 'RESET app.current_tenant');

    const out = await query(client, 'SELECT count(*)::int AS c FROM tenants');

    await query(client, 'COMMIT');
    assert.equal(Number(out.rows[0]?.c ?? -1), 0);
  } finally {
    await query(client, 'ROLLBACK').catch(() => {});
    client.release();
  }
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

  const persisted = await scalar(
    "SELECT count(*)::int FROM jobs WHERE tenant_id = $1::uuid AND type = 'rollback_probe'",
    [TENANT_A]
  );
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
