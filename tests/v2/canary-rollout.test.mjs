import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { freePort, startService } from './service-harness.mjs';

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signJwt(privateKey, payload, kid = 'kid-1') {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

function startJwksServer(jwk) {
  const server = createServer((req, res) => {
    if (req.url !== '/.well-known/jwks.json') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, uri: `http://127.0.0.1:${address.port}/.well-known/jwks.json` });
    });
  });
}

function queueTypes(queueFile) {
  return readFileSync(queueFile, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean)
    .map((line) => JSON.parse(line).job_type);
}

test('processing_mode canary flip and rollback via admin API; gateway keeps linked tenants on the Telegram pipeline', async (t) => {
  // The Telegram rewrite (fd7eef7) removed the gateway's legacy/V2 split: linked
  // tenants always take the V2 pipeline, and processing_mode is only stored.
  // This drill checks the admin flip/rollback and that routing is unaffected.
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'kid-1';
  const jwks = await startJwksServer(jwk);
  t.after(() => jwks.server.close());

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const dir = mkdtempSync(path.join(tmpdir(), 'groceryclaw-canary-'));
  const stateFile = path.join(dir, 'shared-state.json');
  const queueFile = path.join(dir, 'queue.log');

  writeFileSync(stateFile, JSON.stringify({
    linked: true,
    tenant_id: tenantId,
    processing_mode: 'legacy',
    tenants: {
      [tenantId]: {
        id: tenantId,
        name: 'Tenant Drill',
        processing_mode: 'legacy',
        status: 'active',
        config: {}
      }
    },
    invites: {},
    secrets: {}
  }), 'utf8');

  const adminPort = await freePort();
  const gatewayPort = await freePort();
  await startService(t, {
    script: 'apps/admin/dist/server.js',
    env: {
      NODE_ENV: 'test',
      ADMIN_HOST: '127.0.0.1',
      ADMIN_PORT: String(adminPort),
      ADMIN_METRICS_PORT: String(await freePort()),
      ADMIN_ENABLED: 'true',
      ADMIN_TENANT_ENDPOINTS_ENABLED: 'true',
      ADMIN_SECRETS_ENABLED: 'true',
      ADMIN_OIDC_ISSUER: 'https://issuer.example',
      ADMIN_OIDC_AUDIENCE: 'groceryclaw-admin',
      ADMIN_OIDC_JWKS_URI: jwks.uri,
      ADMIN_OIDC_ROLES_CLAIM: 'roles',
      ADMIN_DB_CMD: 'node tests/v2/integration/fake-admin-db.mjs',
      FAKE_ADMIN_STATE_FILE: stateFile,
      DATABASE_URL: '',
      DB_ADMIN_URL: ''
    },
    readyUrl: `http://127.0.0.1:${adminPort}/healthz`
  });

  await startService(t, {
    script: 'apps/gateway/dist/server.js',
    env: {
      NODE_ENV: 'test',
      GATEWAY_HOST: '127.0.0.1',
      GATEWAY_PORT: String(gatewayPort),
      GATEWAY_METRICS_HOST: '127.0.0.1',
      GATEWAY_METRICS_PORT: String(await freePort()),
      V2_ONBOARDING_ENABLED: 'true',
      TELEGRAM_MODE: 'webhook',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_WEBHOOK_SECRET: 'test-token',
      GATEWAY_DB_CMD: 'node tests/v2/integration/fake-db.mjs',
      GATEWAY_QUEUE_CMD: 'node tests/v2/integration/fake-queue.mjs',
      FAKE_DB_STATE_FILE: stateFile,
      FAKE_QUEUE_FILE: queueFile,
      DATABASE_URL: '',
      DB_APP_URL: '',
      POSTGRES_URL: ''
    },
    readyUrl: `http://127.0.0.1:${gatewayPort}/healthz`
  });

  const now = Math.floor(Date.now() / 1000);
  const opsToken = signJwt(privateKey, {
    iss: 'https://issuer.example',
    aud: 'groceryclaw-admin',
    sub: 'ops-user',
    exp: now + 3600,
    nbf: now - 10,
    roles: ['ops']
  });

  let messageId = 1000;
  async function sendInvoice() {
    messageId += 1;
    const resp = await fetch(`http://127.0.0.1:${gatewayPort}/webhooks/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'test-token' },
      body: JSON.stringify({
        update_id: messageId,
        message: {
          message_id: messageId,
          date: now,
          chat: { id: 555001, type: 'private' },
          from: { id: 555001, is_bot: false, first_name: 'Owner' },
          document: { file_id: `file-${messageId}`, file_unique_id: `u-${messageId}`, file_name: 'invoice.xlsx' },
          caption: 'invoice attached'
        }
      })
    });
    assert.equal(resp.status, 200);
    return queueTypes(queueFile).at(-1);
  }

  async function setMode(mode) {
    const resp = await fetch(`http://127.0.0.1:${adminPort}/tenants/${tenantId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opsToken}` },
      body: JSON.stringify({ processing_mode: mode })
    });
    assert.equal(resp.status, 200);
    assert.equal((await resp.json()).processing_mode, mode);
    const stored = JSON.parse(readFileSync(stateFile, 'utf8')).tenants[tenantId].processing_mode;
    assert.equal(stored, mode);
  }

  assert.equal(await sendInvoice(), 'PROCESS_EXCEL_INVOICE');

  await setMode('v2');
  assert.equal(await sendInvoice(), 'PROCESS_EXCEL_INVOICE');

  await setMode('legacy');
  assert.equal(await sendInvoice(), 'PROCESS_EXCEL_INVOICE');

  assert.equal(queueTypes(queueFile).length, 3);
});
