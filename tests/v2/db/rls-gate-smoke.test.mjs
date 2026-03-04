import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration003 = readFileSync('db/v2/migrations/003_v2_rls_roles.sql', 'utf8');

test('migration 003 includes fail-safe rls helper and policy pattern', () => {
  assert.ok(migration003.includes('CREATE OR REPLACE FUNCTION _rls_tenant_id()'));
  assert.ok(migration003.includes("current_setting('app.current_tenant', true)"));
  assert.ok(migration003.includes('USING (tenant_id = _rls_tenant_id())'));
  assert.ok(!migration003.includes('USING (true)'));
});
