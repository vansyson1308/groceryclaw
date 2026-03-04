import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('migration 006 creates mapping and sync tables', () => {
  const migration = readFileSync('db/v2/migrations/006_v2_mapping_sync_tables.sql', 'utf8');
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS mapping_dictionary'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS resolved_invoice_items'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS sync_results'));
});
