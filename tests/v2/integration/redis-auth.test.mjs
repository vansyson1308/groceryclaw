import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { Queue, loadRedisConfig, redisPing } from '../../../packages/common/dist/index.js';

const redisUrl = process.env.REDIS_URL;
const redisUrlWrong = process.env.REDIS_URL_WRONG;
const run = Boolean(redisUrl && redisUrlWrong);

const validPayload = JSON.parse(readFileSync('tests/fixtures/zalo_webhook_valid.json', 'utf8'));

function signBody(body) {
  return createHmac('sha256', 'test-secret').update(body).digest('hex');
}

function startGateway(port, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const logs = [];
    const proc = spawn('node', ['apps/gateway/dist/server.js'], {
      env: {
        ...process.env,
        GATEWAY_HOST: '127.0.0.1',
        GATEWAY_PORT: String(port),
        V2_GATEWAY_WEBHOOK_ENABLED: 'true',
        V2_ONBOARDING_ENABLED: 'true',
        WEBHOOK_VERIFY_MODE: 'mode1',
        WEBHOOK_SIGNATURE_SECRET: 'test-secret',
        ...extraEnv
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('gateway start timeout'));
    }, 6000);

    proc.stdout.on('data', (chunk) => {
      logs.push(chunk.toString());
      clearTimeout(timeout);
      resolve({ proc, logs });
    });
    proc.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  });
}

test('redis auth enabled: enqueue succeeds and ping works', { skip: !run }, async () => {
  const redisConfig = loadRedisConfig({ env: { REDIS_URL: redisUrl } });
  const pingOk = await redisPing(redisConfig);
  assert.equal(pingOk, true);

  const queue = new Queue('redis-auth-test', { connection: redisConfig });
  await queue.add('PROCESS_INBOUND_EVENT', { ok: true, probe: 'redis-auth' });
});

test('wrong redis password fails fast and gateway returns controlled error without leaking secret', { skip: !run }, async () => {
  const badPassword = 'wrongpass-leak-check';
  const url = new URL(redisUrlWrong);
  url.password = badPassword;

  const { proc, logs } = await startGateway(3391, {
    NODE_ENV: 'development',
    REDIS_URL: url.toString()
  });

  try {
    const body = JSON.stringify({ ...validPayload, zalo_msg_id: 'redis-auth-failure-msg' });
    const r = await fetch('http://127.0.0.1:3391/webhooks/zalo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-zalo-signature': signBody(body)
      },
      body
    });

    assert.equal(r.status, 500);
    const text = logs.join('\n');
    assert.match(text, /queue_auth_error|gateway_webhook_failed/);
    assert.doesNotMatch(text, new RegExp(badPassword));
  } finally {
    proc.kill('SIGTERM');
  }
});
