import { runSql } from './db_v2_lib.mjs';

function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected=${expected} actual=${actual}`);
}

function one(sql) {
  return runSql(sql).trim();
}

function seed() {
  runSql(`
    BEGIN;
      DELETE FROM audit_logs;
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
        ('aaaaaaaa-0000-0000-0000-000000000001', 'platform_owner_a', 'Owner A');

      INSERT INTO tenant_users (id, tenant_id, zalo_user_id, role, status)
      VALUES
        ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner', 'active');

      SET LOCAL app.invite_pepper = '746573742d706570706572';
      INSERT INTO invite_codes (
        id, tenant_id, code_hash, code_hint, target_role, status, expires_at, created_at
      ) VALUES (
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        digest(decode(current_setting('app.invite_pepper', true), 'hex') || convert_to('ABC123', 'UTF8'), 'sha256'),
        '23',
        'staff',
        'active',
        now() + interval '1 day',
        now()
      );

      INSERT INTO invite_codes (
        id, tenant_id, code_hash, code_hint, target_role, status, expires_at, created_at
      ) VALUES (
        'dddddddd-dddd-dddd-dddd-dddddddddddd',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        digest(decode(current_setting('app.invite_pepper', true), 'hex') || convert_to('OLD999', 'UTF8'), 'sha256'),
        '99',
        'staff',
        'active',
        now() - interval '1 day',
        now()
      );
    COMMIT;
  `);
}

function testResolveMembershipNoTenantContext() {
  const row = one(`
    BEGIN;
      SET LOCAL ROLE groceryclaw_app_user;
      RESET app.current_tenant;
      SELECT tenant_id::text || ',' || tenant_user_id::text || ',' || role || ',' || status
      FROM resolve_membership_by_platform_user_id('platform_owner_a');
    COMMIT;
  `);

  eq(
    row,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa,aaaaaaaa-1111-1111-1111-111111111111,owner,active',
    'resolve_membership should return active membership without tenant context'
  );
}

function testConsumeInviteSuccessThenFail() {
  const first = one(`
    BEGIN;
      SET LOCAL ROLE groceryclaw_app_user;
      SET LOCAL app.invite_pepper = '746573742d706570706572';
      SELECT ok::text || ',' || coalesce(tenant_id::text,'') || ',' || coalesce(role_assigned,'')
      FROM consume_invite_code('platform_staff_b', ' ABC-123 ');
    COMMIT;
  `);
  eq(first, 'true,bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb,staff', 'first invite consume should succeed');

  const second = one(`
    BEGIN;
      SET LOCAL ROLE groceryclaw_app_user;
      SET LOCAL app.invite_pepper = '746573742d706570706572';
      SELECT ok::text || ',' || coalesce(tenant_id::text,'') || ',' || coalesce(role_assigned,'')
      FROM consume_invite_code('platform_staff_b2', 'ABC123');
    COMMIT;
  `);
  eq(second, 'false,,', 'second consume should fail generically');

  const countMembership = one(`
    SELECT count(*)::text
    FROM tenant_users tu
    JOIN zalo_users zu ON zu.id = tu.zalo_user_id
    WHERE tu.tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND zu.platform_user_id IN ('platform_staff_b','platform_staff_b2');
  `);
  eq(countMembership, '1', 'no duplicate memberships after double consume');
}

function testExpiredInviteFailsGeneric() {
  const result = one(`
    BEGIN;
      SET LOCAL ROLE groceryclaw_app_user;
      SET LOCAL app.invite_pepper = '746573742d706570706572';
      SELECT ok::text || ',' || coalesce(tenant_id::text,'') || ',' || coalesce(role_assigned,'')
      FROM consume_invite_code('platform_staff_expired', 'OLD999');
    COMMIT;
  `);
  eq(result, 'false,,', 'expired invite should fail generically');
}

function testUserLockoutAfterFiveFails() {
  runSql(`
    BEGIN;
      SET LOCAL ROLE groceryclaw_app_user;
      SET LOCAL app.invite_pepper = '746573742d706570706572';
      SELECT consume_invite_code('platform_fail_user', 'NOPE1') FROM generate_series(1,5);
    COMMIT;
  `);

  const lockout = one(`
    SELECT CASE WHEN invite_lockout_until > now() THEN 'locked' ELSE 'open' END
    FROM zalo_users
    WHERE platform_user_id = 'platform_fail_user';
  `);
  eq(lockout, 'locked', 'user lockout should trigger after 5 failures');
}

function testRlsStillAppliesOutsideBootstrap() {
  const appUserCross = one(`
    BEGIN;
      SET LOCAL ROLE groceryclaw_app_user;
      SET LOCAL app.current_tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      SELECT count(*)::text FROM tenants WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    COMMIT;
  `);
  eq(appUserCross, '0', 'app_user must remain tenant-scoped outside bootstrap functions');
}

seed();
testResolveMembershipNoTenantContext();
testConsumeInviteSuccessThenFail();
testExpiredInviteFailsGeneric();
testUserLockoutAfterFiveFails();
testRlsStillAppliesOutsideBootstrap();

console.log('Bootstrap function integration checks passed.');
