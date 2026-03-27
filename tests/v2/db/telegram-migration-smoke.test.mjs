import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationSql = readFileSync('db/v2/migrations/012_v2_telegram_migration.sql', 'utf8');

test('migration 012: has migrate:up and migrate:down markers', () => {
  assert.ok(migrationSql.includes('-- migrate:up'), 'missing migrate:up');
  assert.ok(migrationSql.includes('-- migrate:down'), 'missing migrate:down');
});

test('migration 012: renames zalo_users to platform_users', () => {
  assert.ok(
    migrationSql.includes('ALTER TABLE zalo_users RENAME TO platform_users'),
    'missing table rename'
  );
});

test('migration 012: adds platform and telegram_chat_id columns', () => {
  assert.ok(
    migrationSql.includes('ADD COLUMN IF NOT EXISTS platform TEXT'),
    'missing platform column'
  );
  assert.ok(
    migrationSql.includes('ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT'),
    'missing telegram_chat_id column'
  );
});

test('migration 012: renames zalo_user_id to user_id in tenant_users', () => {
  assert.ok(
    migrationSql.includes('ALTER TABLE tenant_users RENAME COLUMN zalo_user_id TO user_id'),
    'missing tenant_users column rename'
  );
});

test('migration 012: renames zalo columns in inbound_events', () => {
  assert.ok(
    migrationSql.includes('ALTER TABLE inbound_events RENAME COLUMN zalo_user_id TO user_id'),
    'missing inbound_events user_id rename'
  );
  assert.ok(
    migrationSql.includes('ALTER TABLE inbound_events RENAME COLUMN zalo_msg_id TO message_id'),
    'missing inbound_events message_id rename'
  );
});

test('migration 012: renames zalo_user_id in pending_notifications', () => {
  assert.ok(
    migrationSql.includes('ALTER TABLE pending_notifications RENAME COLUMN zalo_user_id TO user_id'),
    'missing pending_notifications column rename'
  );
});

test('migration 012: creates employee_permissions table with RLS', () => {
  assert.ok(
    migrationSql.includes('CREATE TABLE IF NOT EXISTS employee_permissions'),
    'missing employee_permissions table'
  );
  assert.ok(
    migrationSql.includes('rls_employee_permissions_app_user'),
    'missing employee_permissions RLS policy'
  );
  assert.ok(
    migrationSql.includes('ALTER TABLE employee_permissions ENABLE ROW LEVEL SECURITY'),
    'missing employee_permissions RLS enable'
  );
  assert.ok(
    migrationSql.includes('ALTER TABLE employee_permissions FORCE ROW LEVEL SECURITY'),
    'missing employee_permissions FORCE RLS'
  );
});

test('migration 012: creates platform-agnostic unique index', () => {
  assert.ok(
    migrationSql.includes('idx_platform_users_platform_uid'),
    'missing composite unique index on (platform, platform_user_id)'
  );
});

test('migration 012: recreates bootstrap functions with new table refs', () => {
  // resolve_membership should reference platform_users, not zalo_users
  const upSection = migrationSql.split('-- migrate:down')[0];
  assert.ok(
    upSection.includes('FROM platform_users pu'),
    'resolve_membership should use platform_users'
  );
  assert.ok(
    upSection.includes('tu.user_id = pu.id'),
    'resolve_membership should join on user_id, not zalo_user_id'
  );

  // consume_invite_code should INSERT INTO platform_users
  assert.ok(
    upSection.includes('INSERT INTO platform_users'),
    'consume_invite_code should insert into platform_users'
  );
  assert.ok(
    upSection.includes('p_telegram_chat_id'),
    'consume_invite_code should accept telegram_chat_id param'
  );
});

test('migration 012: updates secret_versions constraint for new types', () => {
  assert.ok(
    migrationSql.includes("'kiotviet_client_credentials'"),
    'missing kiotviet_client_credentials in secret_type check'
  );
});

test('migration 012: drops old RLS policies before creating new ones', () => {
  const upSection = migrationSql.split('-- migrate:down')[0];
  assert.ok(
    upSection.includes('DROP POLICY IF EXISTS rls_zalo_users_app_user'),
    'should drop old zalo_users RLS policy'
  );
  assert.ok(
    upSection.includes('CREATE POLICY rls_platform_users_app_user'),
    'should create new platform_users RLS policy'
  );
});

test('migration 012: rollback section restores original schema', () => {
  const downSection = migrationSql.split('-- migrate:down')[1];
  assert.ok(downSection, 'missing migrate:down section');
  assert.ok(
    downSection.includes('RENAME TO zalo_users'),
    'rollback should rename back to zalo_users'
  );
  assert.ok(
    downSection.includes('RENAME COLUMN user_id TO zalo_user_id'),
    'rollback should restore zalo_user_id columns'
  );
  assert.ok(
    downSection.includes('RENAME COLUMN message_id TO zalo_msg_id'),
    'rollback should restore zalo_msg_id column'
  );
  assert.ok(
    downSection.includes('DROP TABLE IF EXISTS employee_permissions'),
    'rollback should drop employee_permissions'
  );
});

test('migration 012: FORCE RLS on platform_users', () => {
  const upSection = migrationSql.split('-- migrate:down')[0];
  assert.ok(
    upSection.includes('ALTER TABLE platform_users FORCE ROW LEVEL SECURITY'),
    'should FORCE RLS on platform_users'
  );
});

test('migration 012: grants bootstrap_owner access to new tables', () => {
  const upSection = migrationSql.split('-- migrate:down')[0];
  assert.ok(
    upSection.includes('GRANT SELECT, INSERT, UPDATE ON platform_users TO groceryclaw_bootstrap_owner'),
    'bootstrap_owner should have access to platform_users'
  );
});
