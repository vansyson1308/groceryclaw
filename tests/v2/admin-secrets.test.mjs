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

function startAdmin(port, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['apps/admin/dist/server.js'], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ADMIN_HOST: '127.0.0.1',
        ADMIN_PORT: String(port),
        ADMIN_TENANT_ENDPOINTS_ENABLED: 'true',
        ADMIN_SECRETS_ENABLED: 'true',
        ...extraEnv
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('admin start timeout'));
    }, 4000);

    proc.stdout.on('data', () => {
      clearTimeout(timeout);
      resolve(proc);
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) {
        clearTimeout(timeout);
        reject(new Error(text));
      }
    });
  });
}

test('admin secret rotate/revoke/list hides plaintext and audits', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'kid-1';

  const jwks = await startJwksServer(jwk);
  const dir = mkdtempSync(path.join(tmpdir(), 'groceryclaw-admin-secrets-'));
  const stateFile = path.join(dir, 'admin-state.json');
  const auditFile = path.join(dir, 'admin-audit.log');
  writeFileSync(stateFile, JSON.stringify({ tenants: { '11111111-1111-1111-1111-111111111111': { id: '11111111-1111-1111-1111-111111111111', name: 'T', processing_mode: 'legacy', status: 'active', config: {} } }, invites: {}, secrets: {} }), 'utf8');

  const port = 3500 + Math.floor(Math.random() * 500);
  const proc = await startAdmin(port, {
    ADMIN_ENABLED: 'true',
    ADMIN_OIDC_ISSUER: 'https://issuer.example',
    ADMIN_OIDC_AUDIENCE: 'groceryclaw-admin',
    ADMIN_OIDC_JWKS_URI: jwks.uri,
    ADMIN_OIDC_ROLES_CLAIM: 'roles',
    ADMIN_DB_CMD: 'node tests/v2/integration/fake-admin-db.mjs',
    FAKE_ADMIN_AUDIT_FILE: auditFile,
    FAKE_ADMIN_STATE_FILE: stateFile,
    ADMIN_MEK_B64: Buffer.alloc(32, 9).toString('base64')
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

  const rotate = await fetch(`http://127.0.0.1:${port}/tenants/11111111-1111-1111-1111-111111111111/secrets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${opsToken}` },
    body: JSON.stringify({ secret_type: 'kiotviet_token', payload: { token: 'kv-secret-token' } })
  });
  assert.equal(rotate.status, 201);
  const rotated = await rotate.json();
  assert.ok(rotated.id);

  const listResp = await fetch(`http://127.0.0.1:${port}/tenants/11111111-1111-1111-1111-111111111111/secrets`, {
    headers: { authorization: `Bearer ${opsToken}` }
  });
  assert.equal(listResp.status, 200);
  const listed = await listResp.json();
  assert.equal('payload' in listed.items[0], false);

  const revokeResp = await fetch(`http://127.0.0.1:${port}/tenants/11111111-1111-1111-1111-111111111111/secrets/${rotated.id}/revoke`, {
    method: 'POST',
    headers: { authorization: `Bearer ${opsToken}` }
  });
  assert.equal(revokeResp.status, 200);

  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const stored = state.secrets[rotated.id];
  assert.equal(stored.status, 'revoked');
  assert.ok(stored.encrypted_value);
  assert.equal(stored.encrypted_value.includes('kv-secret-token'), false);

  const audit = readFileSync(auditFile, 'utf8');
  assert.match(audit, /secret_rotate/);
  assert.match(audit, /secret_revoke/);
  assert.doesNotMatch(audit, /kv-secret-token/);

  proc.kill('SIGTERM');
  jwks.server.close();
});
