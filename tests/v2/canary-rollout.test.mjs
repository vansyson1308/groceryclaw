import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

function waitForReady(proc, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('process start timeout'));
    }, timeoutMs);

    proc.stdout.on('data', () => {
      clearTimeout(timeout);
      resolve();
    });

    proc.stderr.on('data', (chunk) => {
      const text = String(chunk);
      if (/error/i.test(text)) {
        clearTimeout(timeout);
        reject(new Error(text));
      }
    });
  });
}

function queueTypes(queueFile) {
  const lines = readFileSync(queueFile, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean);
  return lines.map((line) => {
    const payload = JSON.parse(line);
    return payload.job_type;
  });
}

test('canary flip and rollback toggle gateway routing by processing_mode', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'kid-1';
  const jwks = await startJwksServer(jwk);

  const dir = mkdtempSync(path.join(tmpdir(), 'groceryclaw-canary-'));
  const stateFile = path.join(dir, 'shared-state.json');
  const queueFile = path.join(dir, 'queue.log');

  writeFileSync(stateFile, JSON.stringify({
    linked: true,
    tenant_id: '11111111-1111-1111-1111-111111111111',
    processing_mode: 'legacy',
    tenants: {
      '11111111-1111-1111-1111-111111111111': {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Tenant Drill',
        processing_mode: 'legacy',
        status: 'active',
        config: {}
      }
    },
    invites: {},
    secrets: {}
  }), 'utf8');

  const adminPort = 3600 + Math.floor(Math.random() * 200);
  const gatewayPort = 3800 + Math.floor(Math.random() * 200);

  const adminProc = spawn('node', ['apps/admin/dist/server.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ADMIN_HOST: '127.0.0.1',
      ADMIN_PORT: String(adminPort),
      ADMIN_ENABLED: 'true',
      ADMIN_TENANT_ENDPOINTS_ENABLED: 'true',
      ADMIN_SECRETS_ENABLED: 'true',
      ADMIN_OIDC_ISSUER: 'https://issuer.example',
      ADMIN_OIDC_AUDIENCE: 'groceryclaw-admin',
      ADMIN_OIDC_JWKS_URI: jwks.uri,
      ADMIN_OIDC_ROLES_CLAIM: 'roles',
      ADMIN_DB_CMD: 'node tests/v2/integration/fake-admin-db.mjs',
      FAKE_ADMIN_STATE_FILE: stateFile
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForReady(adminProc);

  const gatewayProc = spawn('node', ['apps/gateway/dist/server.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      GATEWAY_HOST: '127.0.0.1',
      GATEWAY_PORT: String(gatewayPort),
      V2_GATEWAY_WEBHOOK_ENABLED: 'true',
      V2_ONBOARDING_ENABLED: 'true',
      WEBHOOK_VERIFY_MODE: 'mode2',
      WEBHOOK_MODE2_TOKEN: 'test-token',
      WEBHOOK_MODE2_ALLOW_IN_PRODUCTION: 'true',
      GATEWAY_DB_CMD: 'node tests/v2/integration/fake-db.mjs',
      GATEWAY_QUEUE_CMD: `node tests/v2/integration/fake-queue.mjs`,
      FAKE_DB_STATE_FILE: stateFile,
      FAKE_QUEUE_FILE: queueFile
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForReady(gatewayProc);

  const now = Math.floor(Date.now() / 1000);
  const opsToken = signJwt(privateKey, {
    iss: 'https://issuer.example',
    aud: 'groceryclaw-admin',
    sub: 'ops-user',
    exp: now + 3600,
    nbf: now - 10,
    roles: ['ops']
  });

  async function hitGateway(msgId) {
    const resp = await fetch(`http://127.0.0.1:${gatewayPort}/webhooks/zalo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-token': 'test-token'
      },
      body: JSON.stringify({
        platform_user_id: 'linked_user_1',
        zalo_msg_id: msgId,
        message_type: 'file',
        attachments: [{ type: 'file', url: 'https://example.zalo.me/invoice.xml', name: 'invoice.xml' }],
        text: 'invoice attached'
      })
    });
    assert.equal(resp.status, 200);
  }

  await hitGateway('legacy-msg-1');
  let types = queueTypes(queueFile);
  assert.equal(types.includes('LEGACY_FORWARD_INBOUND'), true);

  const toV2 = await fetch(`http://127.0.0.1:${adminPort}/tenants/11111111-1111-1111-1111-111111111111`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${opsToken}` },
    body: JSON.stringify({ processing_mode: 'v2' })
  });
  assert.equal(toV2.status, 200);

  await hitGateway('v2-msg-1');
  types = queueTypes(queueFile);
  assert.equal(types.includes('PROCESS_INBOUND_EVENT'), true);

  const rollback = await fetch(`http://127.0.0.1:${adminPort}/tenants/11111111-1111-1111-1111-111111111111`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${opsToken}` },
    body: JSON.stringify({ processing_mode: 'legacy' })
  });
  assert.equal(rollback.status, 200);

  await hitGateway('legacy-msg-2');
  types = queueTypes(queueFile);
  const legacyCount = types.filter((x) => x === 'LEGACY_FORWARD_INBOUND').length;
  assert.equal(legacyCount >= 2, true);

  gatewayProc.kill('SIGTERM');
  adminProc.kill('SIGTERM');
  jwks.server.close();
});
