import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { authenticateRequest, loadAdminAuthConfig } from '../../apps/admin/dist/auth.js';
import { isAllowedByRole } from '../../apps/admin/dist/rbac.js';

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

function startJwksServer(jwks) {
  const server = createServer((req, res) => {
    if (req.url !== '/.well-known/jwks.json') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwks] }));
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

test('OIDC authentication verifies JWT and extracts role', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'kid-1';

  const jwks = await startJwksServer(jwk);
  const cfg = loadAdminAuthConfig({
    ADMIN_ENABLED: 'true',
    ADMIN_OIDC_ISSUER: 'https://issuer.example',
    ADMIN_OIDC_AUDIENCE: 'groceryclaw-admin',
    ADMIN_OIDC_JWKS_URI: jwks.uri,
    ADMIN_OIDC_ROLES_CLAIM: 'roles',
    ADMIN_BREAKGLASS_ENABLED: 'false'
  });

  const now = Math.floor(Date.now() / 1000);
  const token = signJwt(privateKey, {
    iss: 'https://issuer.example',
    aud: 'groceryclaw-admin',
    sub: 'user-1',
    exp: now + 3600,
    nbf: now - 10,
    roles: ['read_only']
  });

  const principal = await authenticateRequest(cfg, {
    authorization: `Bearer ${token}`
  });

  assert.equal(principal?.subject, 'user-1');
  assert.equal(principal?.role, 'read_only');

  jwks.server.close();
});

test('RBAC hierarchy and method guard', () => {
  assert.equal(isAllowedByRole('read_only', 'ops', 'GET'), true);
  assert.equal(isAllowedByRole('ops', 'read_only', 'POST'), false);
  assert.equal(isAllowedByRole('admin', 'ops', 'GET'), false);
  assert.equal(isAllowedByRole('read_only', 'read_only', 'POST'), false);
});

test('admin protected endpoint returns 401 without auth, 200 with token, 403 missing role, and break-glass audit path', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'kid-1';
  const jwks = await startJwksServer(jwk);

  const dir = mkdtempSync(path.join(tmpdir(), 'groceryclaw-admin-'));
  const auditFile = path.join(dir, 'audit.sql.log');

  const proc = await startAdmin(3320, {
    ADMIN_METRICS_PORT: '19320',
    ADMIN_ENABLED: 'true',
    ADMIN_OIDC_ISSUER: 'https://issuer.example',
    ADMIN_OIDC_AUDIENCE: 'groceryclaw-admin',
    ADMIN_OIDC_JWKS_URI: jwks.uri,
    ADMIN_OIDC_ROLES_CLAIM: 'roles',
    ADMIN_BREAKGLASS_ENABLED: 'true',
    ADMIN_BREAKGLASS_API_KEY: 'bg-secret',
    ADMIN_BREAKGLASS_SCOPE: 'read_only',
    ADMIN_DB_CMD: 'node tests/v2/integration/fake-admin-db.mjs',
    FAKE_ADMIN_AUDIT_FILE: auditFile
  });

  const noAuth = await fetch('http://127.0.0.1:3320/admin/ping');
  assert.equal(noAuth.status, 401);

  const now = Math.floor(Date.now() / 1000);
  const okToken = signJwt(privateKey, {
    iss: 'https://issuer.example',
    aud: 'groceryclaw-admin',
    sub: 'user-1',
    exp: now + 3600,
    nbf: now - 10,
    roles: ['read_only']
  });

  const okResp = await fetch('http://127.0.0.1:3320/admin/ping', {
    headers: { authorization: `Bearer ${okToken}` }
  });
  assert.equal(okResp.status, 200);

  const badRoleToken = signJwt(privateKey, {
    iss: 'https://issuer.example',
    aud: 'groceryclaw-admin',
    sub: 'user-2',
    exp: now + 3600,
    nbf: now - 10,
    roles: ['read_only']
  });

  const badRoleResp = await fetch('http://127.0.0.1:3320/admin/ops-ping', {
    headers: { authorization: `Bearer ${badRoleToken}` }
  });
  assert.equal(badRoleResp.status, 403);

  const breakglassResp = await fetch('http://127.0.0.1:3320/admin/ping', {
    headers: { 'x-admin-api-key': 'bg-secret', 'x-request-id': '11111111-1111-1111-1111-111111111111' }
  });
  assert.equal(breakglassResp.status, 200);

  const auditLog = readFileSync(auditFile, 'utf8');
  assert.match(auditLog, /break_glass_access/);

  proc.kill('SIGTERM');
  jwks.server.close();
});
