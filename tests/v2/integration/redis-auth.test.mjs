import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Queue, loadRedisConfig, redisPing } from '../../../packages/common/dist/index.js';
import { freePort, startService } from '../service-harness.mjs';

const redisUrl = process.env.REDIS_URL;
const redisUrlWrong = process.env.REDIS_URL_WRONG;
const run = Boolean(redisUrl && redisUrlWrong);

const WEBHOOK_SECRET = 'redis-auth-webhook-secret';
const validUpdate = JSON.parse(readFileSync('tests/fixtures/telegram_update_valid.json', 'utf8'));

test('redis auth enabled: enqueue succeeds and ping works', { skip: !run }, async () => {
  const redisConfig = loadRedisConfig({ env: { REDIS_URL: redisUrl } });
  const pingOk = await redisPing(redisConfig);
  assert.equal(pingOk, true);

  const queue = new Queue('redis-auth-test', { connection: redisConfig });
  await queue.add('PROCESS_INBOUND_EVENT', { ok: true, probe: 'redis-auth' });
});

test('wrong redis password fails fast and gateway returns controlled error without leaking secret', { skip: !run }, async (t) => {
  const badPassword = 'wrongpass-leak-check';
  const url = new URL(redisUrlWrong);
  url.password = badPassword;

  const port = await freePort();
  const gateway = await startService(t, {
    script: 'apps/gateway/dist/server.js',
    env: {
      NODE_ENV: 'development',
      GATEWAY_HOST: '127.0.0.1',
      GATEWAY_PORT: String(port),
      GATEWAY_METRICS_HOST: '127.0.0.1',
      GATEWAY_METRICS_PORT: String(await freePort()),
      V2_ONBOARDING_ENABLED: 'true',
      TELEGRAM_MODE: 'webhook',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
      DATABASE_URL: '',
      DB_APP_URL: '',
      POSTGRES_URL: '',
      REDIS_URL: url.toString()
    },
    readyUrl: `http://127.0.0.1:${port}/healthz`
  });
  let logs = '';
  gateway.stdout.on('data', (chunk) => { logs += chunk; });
  gateway.stderr.on('data', (chunk) => { logs += chunk; });

  // An unlinked user's message is enqueued (onboarding prompt) without touching the DB,
  // so the queue write is what hits the wrong Redis password.
  const r = await fetch(`http://127.0.0.1:${port}/webhooks/telegram`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': WEBHOOK_SECRET
    },
    body: JSON.stringify(validUpdate)
  });

  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'internal_error' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(logs, /queue_auth_error|gateway_webhook_failed/);
  assert.doesNotMatch(logs, new RegExp(badPassword));
});
