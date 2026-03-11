import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dictionary = JSON.parse(readFileSync('db/v2/schema_dictionary.json', 'utf8'));

test('schema dictionary has core V2 tables', () => {
  const required = [
    'tenants',
    'zalo_users',
    'tenant_users',
    'invite_codes',
    'secret_versions',
    'inbound_events',
    'jobs',
    'idempotency_keys',
    'pending_notifications',
    'audit_logs',
    'admin_audit_logs'
  ];

  for (const table of required) {
    assert.ok(dictionary.tables[table], `missing dictionary table: ${table}`);
    assert.ok(Object.keys(dictionary.tables[table].columns).length > 0, `${table} has no columns in dictionary`);
  }
});
