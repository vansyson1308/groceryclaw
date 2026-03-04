import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('migration 005 creates canonical invoice tables', () => {
  const migration = readFileSync('db/v2/migrations/005_v2_canonical_invoices.sql', 'utf8');
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS canonical_invoices'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS canonical_invoice_items'));
  assert.ok(migration.includes('UNIQUE (tenant_id, invoice_fingerprint)'));
});
