import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('db/v2/migrations/007_v2_notifier_hardening.sql', 'utf8');

test('migration 007 adds notifier terminal status and error codes', () => {
  assert.match(migration, /failed_terminal/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS error_code TEXT/);
});
