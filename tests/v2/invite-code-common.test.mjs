import test from 'node:test';
import assert from 'node:assert/strict';
import { computeInviteCodeHashHex, normalizeInviteCode } from '../../packages/common/dist/index.js';

test('normalizeInviteCode applies canonical normalization', () => {
  assert.equal(normalizeInviteCode(' ab-c 123 '), 'ABC123');
});

test('computeInviteCodeHashHex is deterministic for b64 pepper + normalized code', () => {
  const pepperB64 = Buffer.from('test-pepper', 'utf8').toString('base64');
  const normalized = 'ABC123';

  const h1 = computeInviteCodeHashHex(normalized, pepperB64);
  const h2 = computeInviteCodeHashHex(normalized, pepperB64);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});
