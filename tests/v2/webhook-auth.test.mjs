import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhookRequest } from '../../packages/common/dist/index.js';

const rawBody = Buffer.from('{"platform_user_id":"u1","zalo_msg_id":"m1","attachments":[]}');

test('verifyWebhookRequest mode1 accepts valid hmac and rejects invalid', () => {
  const secret = 'abc123';
  const sig = createHmac('sha256', secret).update(rawBody).digest('hex');
  const baseConfig = {
    nodeEnv: 'test',
    verifyMode: 'mode1',
    mode2AllowInProduction: false,
    signatureSecret: secret,
    signatureHeaders: ['x-zalo-signature'],
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
    timestampMaxDriftSeconds: 300
  };

  const ok = verifyWebhookRequest(baseConfig, { headers: { 'x-zalo-signature': sig }, sourceIp: '1.1.1.1' }, rawBody);
  assert.equal(ok.ok, true);

  const bad = verifyWebhookRequest(baseConfig, { headers: { 'x-zalo-signature': 'deadbeef' }, sourceIp: '1.1.1.1' }, rawBody);
  assert.equal(bad.ok, false);
  assert.equal(bad.statusCode, 401);
});


test('verifyWebhookRequest mode1 rejects missing signature header', () => {
  const secret = 'abc123';
  const cfg = {
    nodeEnv: 'test',
    verifyMode: 'mode1',
    mode2AllowInProduction: false,
    signatureSecret: secret,
    signatureHeaders: ['x-zalo-signature'],
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
    timestampMaxDriftSeconds: 300
  };

  const result = verifyWebhookRequest(cfg, { headers: {}, sourceIp: '1.1.1.1' }, rawBody);
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 401);
});

test('verifyWebhookRequest mode2 allowed in production only with explicit override', () => {
  const cfg = {
    nodeEnv: 'production',
    verifyMode: 'mode2',
    mode2AllowInProduction: true,
    signatureSecret: 'unused',
    signatureHeaders: ['x-zalo-signature'],
    signatureAlgorithm: 'sha256',
    mode2TokenHeader: 'x-webhook-token',
    mode2Token: 'allow-token',
    mode2IpAllowlist: [],
    mode2GlobalRateLimitPerMinute: 300,
    mode2PerIpRateLimitPerMinute: 60,
    mode2PerPlatformUserRateLimitPerMinute: 30,
    mode2AttachmentAllowlist: ['zalo.me', 'zadn.vn'],
    enforceTimestamp: false,
    timestampHeader: 'x-zalo-timestamp',
    timestampMaxDriftSeconds: 300
  };

  const ok = verifyWebhookRequest(cfg, { headers: { 'x-webhook-token': 'allow-token' }, sourceIp: '1.1.1.1' }, rawBody);
  assert.equal(ok.ok, true);
});
