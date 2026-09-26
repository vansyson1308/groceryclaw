import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { freePort, startService } from './service-harness.mjs';

const validUpdate = JSON.parse(readFileSync('tests/fixtures/telegram_update_valid.json', 'utf8'));
const invalidUpdate = JSON.parse(readFileSync('tests/fixtures/telegram_update_invalid.json', 'utf8'));
const WEBHOOK_SECRET = 'test-telegram-secret';
const TENANT_ID = '11111111-1111-1111-1111-111111111111';

let nextUpdateId = 910000;
function update({ text, messageId, userId } = {}) {
  nextUpdateId += 1;
  const from = { ...validUpdate.message.from, ...(userId ? { id: userId } : {}) };
  return {
    ...validUpdate,
    update_id: nextUpdateId,
    message: {
      ...validUpdate.message,
      message_id: messageId ?? nextUpdateId,
      from,
      chat: { ...validUpdate.message.chat, id: from.id },
      ...(text !== undefined ? { text } : {})
    }
  };
}

async function startGateway(t, extraEnv = {}) {
  const port = await freePort();
  const metricsPort = await freePort();
  await startService(t, {
    script: 'apps/gateway/dist/server.js',
    env: {
      NODE_ENV: 'test',
      GATEWAY_HOST: '127.0.0.1',
      GATEWAY_PORT: String(port),
      GATEWAY_METRICS_HOST: '127.0.0.1',
      GATEWAY_METRICS_PORT: String(metricsPort),
      V2_ONBOARDING_ENABLED: 'true',
      TELEGRAM_MODE: 'webhook',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
      DATABASE_URL: '',
      DB_APP_URL: '',
      POSTGRES_URL: '',
      ...extraEnv
    },
    readyUrl: `http://127.0.0.1:${port}/healthz`
  });
  return `http://127.0.0.1:${port}`;
}

function postUpdate(baseUrl, body, headers = { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET }) {
  return fetch(`${baseUrl}/webhooks/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

function fakeBackends(state) {
  const dir = mkdtempSync(path.join(tmpdir(), 'groceryclaw-gw-'));
  const dbState = path.join(dir, 'db-state.json');
  const queueFile = path.join(dir, 'queue.log');
  writeFileSync(dbState, JSON.stringify({ tenant_id: TENANT_ID, processing_mode: 'v2', db_calls: 0, ...state }), 'utf8');
  return {
    queueFile,
    env: {
      GATEWAY_DB_CMD: 'node tests/v2/integration/fake-db.mjs',
      GATEWAY_QUEUE_CMD: 'node tests/v2/integration/fake-queue.mjs',
      FAKE_DB_STATE_FILE: dbState,
      FAKE_QUEUE_FILE: queueFile
    }
  };
}

function queuedJobs(queueFile) {
  if (!existsSync(queueFile)) return [];
  return readFileSync(queueFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('secret token: valid passes, wrong is 403, missing is 401, bodies are generic', async (t) => {
  const baseUrl = await startGateway(t);

  const ok = await postUpdate(baseUrl, update());
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).status, 'accepted');

  const wrong = await postUpdate(baseUrl, update(), { 'x-telegram-bot-api-secret-token': 'x'.repeat(WEBHOOK_SECRET.length) });
  assert.equal(wrong.status, 403);
  assert.deepEqual(await wrong.json(), { error: 'unauthorized' });

  const missing = await postUpdate(baseUrl, update(), {});
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { error: 'unauthorized' });
});

test('old Zalo route is gone', async (t) => {
  const baseUrl = await startGateway(t);
  const resp = await fetch(`${baseUrl}/webhooks/zalo`, { method: 'POST', body: '{}' });
  assert.equal(resp.status, 404);
});

test('invalid update is acknowledged without enqueueing; malformed JSON is 400', async (t) => {
  const backends = fakeBackends({ linked: true });
  const baseUrl = await startGateway(t, backends.env);

  const invalid = await postUpdate(baseUrl, invalidUpdate);
  assert.equal(invalid.status, 200);
  assert.deepEqual(await invalid.json(), { status: 'ok', note: 'unprocessable_update' });
  assert.equal(queuedJobs(backends.queueFile).length, 0);

  const malformed = await postUpdate(baseUrl, '{"update_id": 1,');
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: 'bad_request' });
});

test('onboarding: a good invite links the user, then text goes to the chatbot pipeline', async (t) => {
  const backends = fakeBackends({ linked: false });
  const baseUrl = await startGateway(t, backends.env);

  const invite = await postUpdate(baseUrl, update({ text: 'INVITE GOODCODE' }));
  assert.equal(invite.status, 200);

  const linked = await postUpdate(baseUrl, update({ text: 'xin chao' }));
  assert.equal(linked.status, 200);

  const jobs = queuedJobs(backends.queueFile);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].job_type, 'NOTIFY_USER');
  assert.equal(jobs[0].notification_type, 'WELCOME_LINKED');
  assert.equal(jobs[0].tenant_id, TENANT_ID);
  assert.equal(jobs[1].job_type, 'CHATBOT_REPLY');
  assert.equal(jobs[1].tenant_id, TENANT_ID);
  assert.equal(jobs[1].message_text, 'xin chao');
  assert.equal(jobs[1].telegram_chat_id, validUpdate.message.chat.id);
});

test('onboarding: invalid code and rate-limited attempts get generic replies', async (t) => {
  const backends = fakeBackends({ linked: false });
  const baseUrl = await startGateway(t, {
    ...backends.env,
    ONBOARDING_INVITE_USER_RATE_PER_MINUTE: '2',
    ONBOARDING_INVITE_IP_RATE_PER_MINUTE: '2'
  });

  for (let i = 0; i < 4; i += 1) {
    const resp = await postUpdate(baseUrl, update({ text: `INVITE BADCODE${i}` }));
    assert.equal(resp.status, 200);
  }

  const jobs = queuedJobs(backends.queueFile);
  assert.equal(jobs.length, 4);
  assert.equal(jobs[0].notification_type, 'GENERIC_INFO');
  assert.equal(jobs[0].tenant_id, null);
  assert.ok(jobs.some((job) => job.notification_type === 'RATE_LIMITED'));
});

test('unlinked user without an invite gets the onboarding prompt', async (t) => {
  const backends = fakeBackends({ linked: false });
  const baseUrl = await startGateway(t, backends.env);

  const resp = await postUpdate(baseUrl, update({ text: 'xin chao' }));
  assert.equal(resp.status, 200);

  const jobs = queuedJobs(backends.queueFile);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].job_type, 'NOTIFY_USER');
  assert.equal(jobs[0].notification_type, 'GENERIC_INFO');
  assert.equal(jobs[0].tenant_id, null);
});

test('text with quotes and semicolons is carried as data on the linked flow', async (t) => {
  const backends = fakeBackends({ linked: true });
  const baseUrl = await startGateway(t, backends.env);
  const hostile = "hi'; DROP TABLE tenants; --";

  const resp = await postUpdate(baseUrl, update({ text: hostile }));
  assert.equal(resp.status, 200);

  const job = queuedJobs(backends.queueFile).find((item) => item.job_type === 'CHATBOT_REPLY');
  assert.ok(job);
  assert.equal(job.message_text, hostile);
  assert.equal(job.platform_user_id, String(validUpdate.message.from.id));
});

test('linked duplicate message id is deduplicated by the replay cache', async (t) => {
  const backends = fakeBackends({ linked: true });
  const baseUrl = await startGateway(t, backends.env);

  const first = await postUpdate(baseUrl, update({ text: 'xin chao', messageId: 777 }));
  const second = await postUpdate(baseUrl, update({ text: 'xin chao', messageId: 777 }));
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(queuedJobs(backends.queueFile).filter((job) => job.job_type === 'CHATBOT_REPLY').length, 1);
});
