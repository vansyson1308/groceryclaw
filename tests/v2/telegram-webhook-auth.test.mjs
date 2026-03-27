import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyTelegramWebhook } from '../../packages/common/dist/index.js';

test('verifyTelegramWebhook: passes when no secret configured', () => {
  const result = verifyTelegramWebhook('', undefined);
  assert.ok(result.ok);
  assert.equal(result.statusCode, 200);
});

test('verifyTelegramWebhook: passes with matching token', () => {
  const result = verifyTelegramWebhook('my-secret-token', 'my-secret-token');
  assert.ok(result.ok);
  assert.equal(result.statusCode, 200);
});

test('verifyTelegramWebhook: fails when token missing', () => {
  const result = verifyTelegramWebhook('my-secret-token', undefined);
  assert.ok(!result.ok);
  assert.equal(result.statusCode, 401);
  assert.equal(result.reason, 'missing_secret_token');
});

test('verifyTelegramWebhook: fails when token wrong', () => {
  const result = verifyTelegramWebhook('my-secret-token', 'wrong-token-here');
  assert.ok(!result.ok);
  assert.equal(result.statusCode, 403);
  assert.equal(result.reason, 'invalid_secret_token');
});

test('verifyTelegramWebhook: fails on length mismatch', () => {
  const result = verifyTelegramWebhook('short', 'longertoken');
  assert.ok(!result.ok);
  assert.equal(result.statusCode, 403);
});
