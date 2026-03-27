import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationSql = readFileSync('db/v2/migrations/013_v2_kiotviet_per_tenant.sql', 'utf8');

test('migration 013: has migrate:up and migrate:down markers', () => {
  assert.ok(migrationSql.includes('-- migrate:up'), 'missing migrate:up');
  assert.ok(migrationSql.includes('-- migrate:down'), 'missing migrate:down');
});

test('migration 013: adds kiotviet_client_id column to tenants', () => {
  assert.ok(
    migrationSql.includes('ADD COLUMN IF NOT EXISTS kiotviet_client_id TEXT'),
    'missing kiotviet_client_id column'
  );
});

test('migration 013: creates kiotviet_token_cache table', () => {
  assert.ok(
    migrationSql.includes('CREATE TABLE IF NOT EXISTS kiotviet_token_cache'),
    'missing kiotviet_token_cache table'
  );
});

test('migration 013: kiotviet_token_cache has RLS', () => {
  assert.ok(
    migrationSql.includes('ALTER TABLE kiotviet_token_cache ENABLE ROW LEVEL SECURITY'),
    'missing RLS enable'
  );
  assert.ok(
    migrationSql.includes('ALTER TABLE kiotviet_token_cache FORCE ROW LEVEL SECURITY'),
    'missing FORCE RLS'
  );
  assert.ok(
    migrationSql.includes('rls_kiotviet_token_cache_app_user'),
    'missing RLS policy'
  );
});

test('migration 013: rollback drops table and column', () => {
  const downSection = migrationSql.split('-- migrate:down')[1];
  assert.ok(downSection.includes('DROP TABLE IF EXISTS kiotviet_token_cache'), 'rollback should drop table');
  assert.ok(downSection.includes('DROP COLUMN IF EXISTS kiotviet_client_id'), 'rollback should drop column');
});
