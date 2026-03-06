import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';

const validPayload = JSON.parse(readFileSync('tests/fixtures/zalo_webhook_valid.json', 'utf8'));
const invalidPayload = JSON.parse(readFileSync('tests/fixtures/zalo_webhook_invalid.json', 'utf8'));

function startGateway(port, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['apps/gateway/dist/server.js'], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
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
    }, 4000);

    proc.stdout.on('data', () => {
      clearTimeout(timeout);
      resolve(proc);
    });

    proc.stderr.on('data', (chunk) => {
      const t = chunk.toString();
      if (t.includes('Error')) {
        clearTimeout(timeout);
        reject(new Error(t));
      }
    });
  });
}

function signBody(body) {
  return createHmac('sha256', 'test-secret').update(body).digest('hex');
}

test('mode1 valid signature passes and invalid signature fails with generic body', async () => {
  const proc = await startGateway(3310);
  const body = JSON.stringify(validPayload);

  const okResponse = await fetch('http://127.0.0.1:3310/webhooks/zalo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zalo-signature': signBody(body)
    },
    body
  });

  assert.equal(okResponse.status, 200);

  const badResponse = await fetch('http://127.0.0.1:3310/webhooks/zalo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zalo-signature': '00'
    },
    body
  });

  assert.equal(badResponse.status, 401);
  assert.deepEqual(await badResponse.json(), { error: 'unauthorized' });

  proc.kill('SIGTERM');
});

test('mode2 valid token passes and missing token fails', async () => {
  const proc = await startGateway(3311, {
    WEBHOOK_VERIFY_MODE: 'mode2',
    WEBHOOK_MODE2_TOKEN: 'mode2-secret',
    WEBHOOK_MODE2_TOKEN_HEADER: 'x-webhook-token'
  });

  const body = JSON.stringify(validPayload);

  const okResponse = await fetch('http://127.0.0.1:3311/webhooks/zalo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-token': 'mode2-secret'
    },
    body
  });

  assert.equal(okResponse.status, 200);

  const badResponse = await fetch('http://127.0.0.1:3311/webhooks/zalo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body
  });

  assert.equal(badResponse.status, 403);
  assert.deepEqual(await badResponse.json(), { error: 'forbidden' });

  proc.kill('SIGTERM');
});

test('mode2 is blocked in production by default', async () => {
  const proc = await startGateway(3312, {
    NODE_ENV: 'production',
    WEBHOOK_VERIFY_MODE: 'mode2',
    WEBHOOK_MODE2_TOKEN: 'mode2-secret'
  });

  const body = JSON.stringify(validPayload);
  const r = await fetch('http://127.0.0.1:3312/webhooks/zalo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-token': 'mode2-secret'
    },
    body
  });

  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: 'forbidden' });

  proc.kill('SIGTERM');
});

test('gateway webhook rejects invalid schema payload after auth', async () => {
  const proc = await startGateway(3313);
  const body = JSON.stringify(invalidPayload);

  const r = await fetch('http://127.0.0.1:3313/webhooks/zalo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zalo-signature': signBody(body)
    },
    body
  });

  assert.equal(r.status, 400);

  proc.kill('SIGTERM');
});

test('onboarding invite success enqueues notify and linked flow obeys processing mode', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'groceryclaw-'));
  const dbState = path.join(dir, 'db-state.json');
  const queueFile = path.join(dir, 'queue.log');

  writeFileSync(dbState, JSON.stringify({ linked: false, tenant_id: '11111111-1111-1111-1111-111111111111', processing_mode: 'legacy', db_calls: 0 }), 'utf8');

  const proc = await startGateway(3314, {
    GATEWAY_DB_CMD: 'node tests/v2/integration/fake-db.mjs',
    GATEWAY_QUEUE_CMD: 'node tests/v2/integration/fake-queue.mjs',
    FAKE_DB_STATE_FILE: dbState,
    FAKE_QUEUE_FILE: queueFile,
    INVITE_PEPPER_B64: Buffer.from('0011', 'hex').toString('base64'),
    ONBOARDING_INVITE_USER_RATE_PER_MINUTE: '2',
    ONBOARDING_INVITE_IP_RATE_PER_MINUTE: '2'
  });

  const inviteBody = JSON.stringify({ ...validPayload, text: 'INVITE GOODCODE', zalo_msg_id: 'msg-invite-1' });
  const inviteResp = await fetch('http://127.0.0.1:3314/webhooks/zalo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zalo-signature': signBody(inviteBody), 'x-forwarded-for': '2.2.2.2' },
    body: inviteBody
  });
  assert.equal(inviteResp.status, 200);

  const linkedBody = JSON.stringify({ ...validPayload, zalo_msg_id: 'msg-linked-1' });
  const linkedResp = await fetch('http://127.0.0.1:3314/webhooks/zalo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zalo-signature': signBody(linkedBody), 'x-forwarded-for': '2.2.2.2' },
    body: linkedBody
  });
  assert.equal(linkedResp.status, 200);

  const lines = readFileSync(queueFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines[0].job_type, 'NOTIFY_USER');
  assert.equal(lines[0].template, 'invite_success');
  assert.equal(lines[1].job_type, 'FLUSH_PENDING_NOTIFICATIONS');
  assert.equal(lines[2].job_type, 'LEGACY_FORWARD_INBOUND');

  proc.kill('SIGTERM');
});

test('onboarding invalid code and rate-limited paths are generic', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'groceryclaw-'));
  const dbState = path.join(dir, 'db-state.json');
  const queueFile = path.join(dir, 'queue.log');
  writeFileSync(dbState, JSON.stringify({ linked: false, tenant_id: '11111111-1111-1111-1111-111111111111', processing_mode: 'v2', db_calls: 0 }), 'utf8');

  const proc = await startGateway(3315, {
    GATEWAY_DB_CMD: 'node tests/v2/integration/fake-db.mjs',
    GATEWAY_QUEUE_CMD: 'node tests/v2/integration/fake-queue.mjs',
    FAKE_DB_STATE_FILE: dbState,
    FAKE_QUEUE_FILE: queueFile,
    INVITE_PEPPER_B64: Buffer.from('0011', 'hex').toString('base64'),
    ONBOARDING_INVITE_USER_RATE_PER_MINUTE: '2',
    ONBOARDING_INVITE_IP_RATE_PER_MINUTE: '2'
  });

  const invalidCodeBody = JSON.stringify({ ...validPayload, text: 'INVITE BADCODE', zalo_msg_id: 'msg-invalid-1' });
  const invalidResp = await fetch('http://127.0.0.1:3315/webhooks/zalo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zalo-signature': signBody(invalidCodeBody), 'x-forwarded-for': '3.3.3.3' },
    body: invalidCodeBody
  });
  assert.equal(invalidResp.status, 200);

  for (let i = 0; i < 6; i += 1) {
    const body = JSON.stringify({ ...validPayload, text: `INVITE BAD${i}`, zalo_msg_id: `msg-rate-${i}` });
    await fetch('http://127.0.0.1:3315/webhooks/zalo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zalo-signature': signBody(body), 'x-forwarded-for': '3.3.3.3' },
      body
    });
  }

  const lines = readFileSync(queueFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines[0].template, 'invite_generic_failure');
  assert.ok(lines.some((item) => item.template === 'invite_wait_retry'));

  proc.kill('SIGTERM');
});


test('platform_user_id with quotes/semicolons is treated as data on linked flow', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'groceryclaw-'));
  const dbState = path.join(dir, 'db-state.json');
  const queueFile = path.join(dir, 'queue.log');
  writeFileSync(dbState, JSON.stringify({ linked: true, tenant_id: '11111111-1111-1111-1111-111111111111', processing_mode: 'v2', db_calls: 0 }), 'utf8');

  const proc = await startGateway(3316, {
    GATEWAY_DB_CMD: 'node tests/v2/integration/fake-db.mjs',
    GATEWAY_QUEUE_CMD: 'node tests/v2/integration/fake-queue.mjs',
    FAKE_DB_STATE_FILE: dbState,
    FAKE_QUEUE_FILE: queueFile
  });

  const payload = JSON.stringify({
    ...validPayload,
    platform_user_id: "user'; DROP TABLE tenants; --",
    zalo_msg_id: 'msg-weird-platform-user'
  });

  const resp = await fetch('http://127.0.0.1:3316/webhooks/zalo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zalo-signature': signBody(payload) },
    body: payload
  });

  assert.equal(resp.status, 200);
  const lines = readFileSync(queueFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const processJob = lines.find((item) => item.job_type === 'PROCESS_INBOUND_EVENT');
  assert.ok(processJob);
  assert.equal(processJob.platform_user_id, "user'; DROP TABLE tenants; --");

  proc.kill('SIGTERM');
});
