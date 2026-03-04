import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration004 = readFileSync('db/v2/migrations/004_v2_bootstrap_functions.sql', 'utf8');

test('migration 004 includes security definer bootstrap functions', () => {
  assert.ok(migration004.includes('FUNCTION resolve_membership_by_platform_user_id'));
  assert.ok(migration004.includes('FUNCTION consume_invite_code'));
  assert.ok(migration004.includes('SECURITY DEFINER'));
  assert.ok(migration004.includes("digest("));
  assert.ok(migration004.includes('FOR UPDATE SKIP LOCKED'));
});
