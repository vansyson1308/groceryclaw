import { runSql } from './db_v2_lib.mjs';

function expectEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected=${expected} actual=${actual}`);
  }
}

function scalar(sql) {
  const out = runSql(sql).trim();
  return out;
}

function setupFixture() {
  runSql(`
    BEGIN;
      -- Full cleanup in FK-safe order to keep fixture deterministic across test runs.
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
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tenant A', 'active', 'v2'),
        ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Tenant B', 'active', 'v2');

      INSERT INTO zalo_users (id, platform_user_id, display_name)
      VALUES
        ('aaaaaaaa-0000-0000-0000-000000000001', 'zalo_a_owner', 'A Owner'),
        ('bbbbbbbb-0000-0000-0000-000000000001', 'zalo_b_owner', 'B Owner');

      INSERT INTO tenant_users (id, tenant_id, zalo_user_id, role, status)
      VALUES
        ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner', 'active'),
        ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner', 'active');

      INSERT INTO audit_logs (tenant_id, actor_type, event_type, payload)
      VALUES
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'system', 'seed_a', '{}'::jsonb),
        ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'system', 'seed_b', '{}'::jsonb);
    COMMIT;
  `);
}

function assertMissingTenantReturnsZeroRows() {
  const count = scalar(`
    BEGIN;
      SET LOCAL ROLE groceryclaw_app_user;
      RESET app.current_tenant;
      SELECT count(*)::text FROM tenants;
    COMMIT;
  `);

  expectEq(count, '0', 'missing tenant context must return zero rows');
}

function assertTenantAIsolation() {
  const countTenants = scalar(`
    BEGIN;
      SET LOCAL ROLE groceryclaw_app_user;
      SET LOCAL app.current_tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      SELECT count(*)::text FROM tenants;
    COMMIT;
  `);
  expectEq(countTenants, '1', 'tenant A should only see one tenant row');

  const countAudit = scalar(`
    BEGIN;
      SET LOCAL ROLE groceryclaw_app_user;
      SET LOCAL app.current_tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      SELECT count(*)::text FROM audit_logs;
    COMMIT;
  `);
  expectEq(countAudit, '1', 'tenant A should only see its own audit logs');

  const sameTenantWrite = scalar(`
    BEGIN;
      SET LOCAL ROLE groceryclaw_app_user;
      SET LOCAL app.current_tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      INSERT INTO jobs (tenant_id, type, payload)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'same_tenant_write', '{}'::jsonb);
      SELECT count(*)::text FROM jobs WHERE tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND type='same_tenant_write';
    COMMIT;
  `);
  expectEq(sameTenantWrite, '1', 'same-tenant write should succeed for app_user');

  const crossWrite = scalar(`
    BEGIN;
      SET LOCAL ROLE groceryclaw_app_user;
      SET LOCAL app.current_tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      DO $$
      BEGIN
        BEGIN
          INSERT INTO jobs (tenant_id, type, payload)
          VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cross_tenant_write', '{}'::jsonb);
        EXCEPTION WHEN insufficient_privilege THEN
          NULL;
        END;
      END
      $$;
      SELECT count(*)::text FROM jobs WHERE tenant_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND type='cross_tenant_write';
    COMMIT;
  `);
  expectEq(crossWrite, '0', 'cross-tenant write should be blocked for app_user');
}

function assertAdminReaderPath() {
  const directDenied = scalar(`
    SELECT CASE WHEN has_table_privilege('groceryclaw_admin_reader', 'audit_logs', 'SELECT') THEN 'yes' ELSE 'no' END;
  `);
  expectEq(directDenied, 'no', 'admin_reader must not have raw SELECT on audit_logs');

  const viaFunction = scalar(`
    BEGIN;
      SET LOCAL ROLE groceryclaw_admin_reader;
      SELECT count(*)::text FROM admin_get_audit_logs(200);
    COMMIT;
  `);
  expectEq(viaFunction, '2', 'admin_reader must read cross-tenant logs via approved function');
}

function assertNoMixedIds() {
  const check = scalar(`
    WITH expected(col_table, col_name, col_type) AS (
      VALUES
        ('tenant_users', 'zalo_user_id', 'uuid'),
        ('tenant_users', 'tenant_id', 'uuid'),
        ('invite_codes', 'used_by', 'uuid'),
        ('inbound_events', 'zalo_user_id', 'uuid'),
        ('pending_notifications', 'zalo_user_id', 'uuid'),
        ('pending_notifications', 'platform_user_id', 'text')
    )
    SELECT CASE WHEN count(*) = 6 THEN 'ok' ELSE 'bad' END
    FROM expected e
    JOIN information_schema.columns c
      ON c.table_schema = 'public'
     AND c.table_name = e.col_table
     AND c.column_name = e.col_name
     AND c.udt_name = e.col_type;
  `);

  expectEq(check, 'ok', 'mixed-ID sanity check failed');
}

setupFixture();
assertMissingTenantReturnsZeroRows();
assertTenantAIsolation();
assertAdminReaderPath();
assertNoMixedIds();

console.log('RLS integration checks passed.');
