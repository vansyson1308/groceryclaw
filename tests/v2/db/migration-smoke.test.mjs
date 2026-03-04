import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration001 = readFileSync('db/v2/migrations/001_v2_init.sql', 'utf8');

test('migration 001 has up and down markers', () => {
  assert.ok(migration001.includes('-- migrate:up'));
  assert.ok(migration001.includes('-- migrate:down'));
  assert.ok(migration001.includes('CREATE EXTENSION IF NOT EXISTS pgcrypto'));
});
