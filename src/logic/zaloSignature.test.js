const test = require('node:test');
const assert = require('node:assert/strict');
const { computeZaloSignature, verifyZaloSignature } = require('./zaloSignature');

test('computes deterministic SHA256 signature from PRD formula', () => {
  const signature = computeZaloSignature({
    appId: '4321888999',
    timestamp: '1708905600000',
    payload: '{"event_name":"user_send_text","message":{"text":"hello"}}',
    secret: 'dummy_secret_key'
  });

  assert.equal(signature.length, 64);
  assert.match(signature, /^[a-f0-9]{64}$/);
});

test('verifies valid signature', () => {
  const input = {
    appId: '4321888999',
    timestamp: '1708905600000',
    payload: '{"k":"v"}',
    secret: 'dummy_secret_key'
  };

  const signature = computeZaloSignature(input);
  assert.equal(verifyZaloSignature({ ...input, signature }), true);
});

test('rejects invalid signature', () => {
  const ok = verifyZaloSignature({
    appId: '4321888999',
    timestamp: '1708905600000',
    payload: '{"k":"v"}',
    secret: 'dummy_secret_key',
    signature: 'deadbeef'
  });

  assert.equal(ok, false);
});
