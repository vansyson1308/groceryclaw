import test from 'node:test';
import assert from 'node:assert/strict';
import { detectInviteIntent } from '../../packages/common/dist/index.js';

test('detectInviteIntent parses prefixed codes', () => {
  const intent = detectInviteIntent('INVITE abcd-1234');
  assert.equal(intent.isInviteAttempt, true);
  assert.equal(intent.inviteCode, 'abcd-1234');
});

test('detectInviteIntent parses bare code', () => {
  const intent = detectInviteIntent('ABCD-1234');
  assert.equal(intent.isInviteAttempt, true);
});

test('detectInviteIntent ignores unrelated text', () => {
  const intent = detectInviteIntent('hello support team');
  assert.equal(intent.isInviteAttempt, false);
});
