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

test('admin tenant + invite endpoints enforce auth/rbac and avoid plaintext storage', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'kid-1';

  const jwks = await startJwksServer(jwk);
  const dir = mkdtempSync(path.join(tmpdir(), 'groceryclaw-admin-endpoints-'));
  const stateFile = path.join(dir, 'admin-state.json');
  const auditFile = path.join(dir, 'admin-audit.log');
  writeFileSync(stateFile, JSON.stringify({ tenants: {}, invites: {} }), 'utf8');

  const proc = await startAdmin(3321, {
    ADMIN_ENABLED: 'true',
    ADMIN_OIDC_ISSUER: 'https://issuer.example',
    ADMIN_OIDC_AUDIENCE: 'groceryclaw-admin',
    ADMIN_OIDC_JWKS_URI: jwks.uri,
    ADMIN_OIDC_ROLES_CLAIM: 'roles',
    ADMIN_DB_CMD: 'node tests/v2/integration/fake-admin-db.mjs',
    FAKE_ADMIN_AUDIT_FILE: auditFile,
    FAKE_ADMIN_STATE_FILE: stateFile,
    INVITE_PEPPER_B64: Buffer.from('test-pepper', 'utf8').toString('base64'),
    ADMIN_INVITE_TTL_HOURS: '72',
    ADMIN_INVITE_RATE_PER_TENANT_PER_MINUTE: '2'
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
  const readOnlyToken = signJwt(privateKey, {
    iss: 'https://issuer.example',
    aud: 'groceryclaw-admin',
    sub: 'ro-user',
    exp: now + 3600,
    nbf: now - 10,
    roles: ['read_only']
  });

  const unauth = await fetch('http://127.0.0.1:3321/tenants/11111111-1111-1111-1111-111111111111');
  assert.equal(unauth.status, 401);

  const created = await fetch('http://127.0.0.1:3321/tenants', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${opsToken}` },
    body: JSON.stringify({ name: 'Tenant A', code: 'tenant_a', metadata: { daily_summary_enabled: true } })
  });
  assert.equal(created.status, 201);
  const tenant = await created.json();
  assert.ok(tenant.id);

  const patched = await fetch(`http://127.0.0.1:3321/tenants/${tenant.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${opsToken}` },
    body: JSON.stringify({ processing_mode: 'v2', enabled: true, metadata: { canary: true } })
  });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).processing_mode, 'v2');

  const inviteCreate = await fetch(`http://127.0.0.1:3321/tenants/${tenant.id}/invites`, {
    method: 'POST',
    headers: { authorization: `Bearer ${opsToken}` }
  });
  assert.equal(inviteCreate.status, 201);
  const inviteBody = await inviteCreate.json();
  assert.ok(inviteBody.code);

  const inviteList = await fetch(`http://127.0.0.1:3321/tenants/${tenant.id}/invites`, {
    headers: { authorization: `Bearer ${readOnlyToken}` }
  });
  assert.equal(inviteList.status, 200);
  const invites = await inviteList.json();
  assert.equal(Array.isArray(invites.items), true);
  assert.equal('code' in invites.items[0], false);

  const readOnlyWrite = await fetch(`http://127.0.0.1:3321/tenants/${tenant.id}/invites`, {
    method: 'POST',
    headers: { authorization: `Bearer ${readOnlyToken}` }
  });
  assert.equal(readOnlyWrite.status, 403);

  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const storedInvite = Object.values(state.invites)[0];
  assert.ok(storedInvite.code_hash);
  assert.equal(Object.prototype.hasOwnProperty.call(storedInvite, 'code'), false);
  assert.notEqual(storedInvite.code_hash, inviteBody.code);

  const auditLog = readFileSync(auditFile, 'utf8');
  assert.match(auditLog, /tenant_create/);
  assert.match(auditLog, /tenant_patch/);
  assert.match(auditLog, /invite_create/);
  assert.doesNotMatch(auditLog, new RegExp(inviteBody.code));

  proc.kill('SIGTERM');
  jwks.server.close();
});
