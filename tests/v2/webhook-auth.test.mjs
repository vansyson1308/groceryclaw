import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyWebhookRequest } from '../../packages/common/dist/index.js';

// Zalo OA MAC formula: SHA256(appId + rawBody + timestamp + OASecretKey)
function zaloMac(appId, rawBody, timestamp, oaSecret) {
  return createHash('sha256').update(appId + rawBody + timestamp + oaSecret, 'utf8').digest('hex');
}

const secret = 'test_oa_secret_key';
const rawBodyStr = '{"app_id":"12345","timestamp":"1700000000000","platform_user_id":"u1","zalo_msg_id":"m1","attachments":[]}';
const rawBody = Buffer.from(rawBodyStr);
const validSig = zaloMac('12345', rawBodyStr, '1700000000000', secret);

function baseConfig(overrides = {}) {
  return {
    nodeEnv: 'test',
    verifyMode: 'mode1',
    mode2AllowInProduction: false,
    signatureSecret: secret,
    signatureHeaders: ['x-zevent-signature'],
    signatureAlgorithm: 'sha256',
    mode2TokenHeader: 'x-webhook-token',
    mode2Token: 'token',
    mode2IpAllowlist: [],
    mode2GlobalRateLimitPerMinute: 300,
    mode2PerIpRateLimitPerMinute: 60,
    mode2PerPlatformUserRateLimitPerMinute: 30,
    mode2AttachmentAllowlist: ['zalo.me', 'zadn.vn'],
    enforceTimestamp: false,
    timestampHeader: 'x-zalo-timestamp',
    timestampMaxDriftSeconds: 300,
    ...overrides
  };
}

test('verifyWebhookRequest mode1 accepts valid Zalo OA MAC signature', () => {
  const cfg = baseConfig();
  const ok = verifyWebhookRequest(cfg, { headers: { 'x-zevent-signature': validSig }, sourceIp: '1.1.1.1' }, rawBody);
  assert.equal(ok.ok, true);
  assert.equal(ok.statusCode, 200);
});

test('verifyWebhookRequest mode1 rejects invalid signature', () => {
  const cfg = baseConfig();
  const bad = verifyWebhookRequest(cfg, { headers: { 'x-zevent-signature': 'deadbeef'.repeat(8) }, sourceIp: '1.1.1.1' }, rawBody);
  assert.equal(bad.ok, false);
  assert.equal(bad.statusCode, 401);
});

test('verifyWebhookRequest mode1 rejects missing signature header', () => {
  const cfg = baseConfig();
  const result = verifyWebhookRequest(cfg, { headers: {}, sourceIp: '1.1.1.1' }, rawBody);
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 401);
});

test('verifyWebhookRequest mode1 handles mac= prefix in signature', () => {
  const cfg = baseConfig();
  const ok = verifyWebhookRequest(cfg, { headers: { 'x-zevent-signature': `mac=${validSig}` }, sourceIp: '1.1.1.1' }, rawBody);
  assert.equal(ok.ok, true);
});

test('verifyWebhookRequest mode1 rejects wrong secret', () => {
  const cfg = baseConfig({ signatureSecret: 'wrong_secret' });
  const result = verifyWebhookRequest(cfg, { headers: { 'x-zevent-signature': validSig }, sourceIp: '1.1.1.1' }, rawBody);
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 401);
});

test('verifyWebhookRequest mode2 allowed in production only with explicit override', () => {
  const cfg = baseConfig({
    nodeEnv: 'production',
    verifyMode: 'mode2',
    mode2AllowInProduction: true,
    mode2Token: 'allow-token'
  });

  const ok = verifyWebhookRequest(cfg, { headers: { 'x-webhook-token': 'allow-token' }, sourceIp: '1.1.1.1' }, rawBody);
  assert.equal(ok.ok, true);
});
