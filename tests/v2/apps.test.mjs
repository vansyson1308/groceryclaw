import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

function startServer(file, env, url) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [file], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Timed out waiting for ${file}`));
    }, 4000);

    proc.stdout.on('data', async () => {
      try {
        const res = await fetch(url);
        clearTimeout(timeout);
        resolve({ proc, status: res.status, body: await res.json(), headers: res.headers });
      } catch {
        // keep waiting
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) {
        clearTimeout(timeout);
        reject(new Error(text));
      }
    });

    proc.on('exit', (code) => {
      if (code && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`${file} exited with code ${code}`));
      }
    });
  });
}

test('gateway health endpoint responds 200', async () => {
  const { proc, status, body } = await startServer(
    'apps/gateway/dist/server.js',
    { GATEWAY_HOST: '127.0.0.1', GATEWAY_PORT: '3200', GATEWAY_METRICS_PORT: '19200', NODE_ENV: 'test' },
    'http://127.0.0.1:3200/healthz'
  );

  proc.kill('SIGTERM');
  assert.equal(status, 200);
  assert.equal(body.service, 'gateway');
});

test('gateway ready endpoint is strict by default and returns 503 when dependencies are missing', async () => {
  const { proc, status, body } = await startServer(
    'apps/gateway/dist/server.js',
    { GATEWAY_HOST: '127.0.0.1', GATEWAY_PORT: '3202', GATEWAY_METRICS_PORT: '19202', NODE_ENV: 'test', READYZ_STRICT: 'true' },
    'http://127.0.0.1:3202/readyz'
  );

  proc.kill('SIGTERM');
  assert.equal(status, 503);
  assert.equal(body.service, 'gateway');
});

test('admin ready endpoint responds 200 when strict readiness is disabled', async () => {
  const { proc, status, body } = await startServer(
    'apps/admin/dist/server.js',
    { ADMIN_HOST: '127.0.0.1', ADMIN_PORT: '3201', ADMIN_METRICS_PORT: '19201', NODE_ENV: 'test', ADMIN_ENABLED: 'false', READYZ_STRICT: 'false' },
    'http://127.0.0.1:3201/readyz'
  );

  proc.kill('SIGTERM');
  assert.equal(status, 200);
  assert.equal(body.service, 'admin');
});

test('admin ready endpoint returns 503 by default when dependencies are unavailable', async () => {
  const { proc, status, body } = await startServer(
    'apps/admin/dist/server.js',
    { ADMIN_HOST: '127.0.0.1', ADMIN_PORT: '3203', ADMIN_METRICS_PORT: '19203', NODE_ENV: 'test', ADMIN_ENABLED: 'false', READYZ_STRICT: 'true' },
    'http://127.0.0.1:3203/readyz'
  );

  proc.kill('SIGTERM');
  assert.equal(status, 503);
  assert.equal(body.service, 'admin');
});


test('admin service remains private in V2 compose (no host ports)', () => {
  const compose = readFileSync('infra/compose/v2/docker-compose.yml', 'utf8');
  const adminBlockMatch = compose.match(/admin:[\s\S]*?worker:/m);
  assert.ok(adminBlockMatch);
  const adminBlock = adminBlockMatch[0];
  assert.equal(/\n\s+ports:\s*\n/.test(adminBlock), false);
  assert.match(adminBlock, /ADMIN_HOST:\s*\$\{ADMIN_HOST:-127\.0\.0\.1\}/);
});


test('gateway sets baseline security headers and no CORS by default', async () => {
  const { proc, headers } = await startServer(
    'apps/gateway/dist/server.js',
    { GATEWAY_HOST: '127.0.0.1', GATEWAY_PORT: '3204', GATEWAY_METRICS_PORT: '19204', NODE_ENV: 'test' },
    'http://127.0.0.1:3204/healthz'
  );

  proc.kill('SIGTERM');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.ok((headers.get('content-security-policy') || '').includes("default-src 'none'"));
  assert.equal(headers.has('access-control-allow-origin'), false);
});

test('admin sets baseline security headers on readyz', async () => {
  const { proc, headers } = await startServer(
    'apps/admin/dist/server.js',
    { ADMIN_HOST: '127.0.0.1', ADMIN_PORT: '3205', ADMIN_METRICS_PORT: '19205', NODE_ENV: 'test', ADMIN_ENABLED: 'false', READYZ_STRICT: 'false' },
    'http://127.0.0.1:3205/readyz'
  );

  proc.kill('SIGTERM');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'DENY');
});

test('gateway exposes private metrics endpoint on metrics port', async () => {
  const { proc } = await startServer(
    'apps/gateway/dist/server.js',
    { GATEWAY_HOST: '127.0.0.1', GATEWAY_PORT: '3206', GATEWAY_METRICS_HOST: '127.0.0.1', GATEWAY_METRICS_PORT: '9200', NODE_ENV: 'test' },
    'http://127.0.0.1:3206/healthz'
  );

  const metrics = await fetch('http://127.0.0.1:9200/metrics');
  const body = await metrics.text();
  proc.kill('SIGTERM');

  assert.equal(metrics.status, 200);
  assert.match(body, /groceryclaw_gateway_readyz_checks_total/);
  assert.match(body, /groceryclaw_gateway_webhook_auth_failures_total/);
});

test('admin exposes private metrics endpoint on metrics port', async () => {
  const { proc } = await startServer(
    'apps/admin/dist/server.js',
    { ADMIN_HOST: '127.0.0.1', ADMIN_PORT: '3207', ADMIN_METRICS_HOST: '127.0.0.1', ADMIN_METRICS_PORT: '9201', NODE_ENV: 'test', ADMIN_ENABLED: 'false', READYZ_STRICT: 'false' },
    'http://127.0.0.1:3207/readyz'
  );

  const metrics = await fetch('http://127.0.0.1:9201/metrics');
  const body = await metrics.text();
  proc.kill('SIGTERM');

  assert.equal(metrics.status, 200);
  assert.match(body, /groceryclaw_admin_readyz_checks_total/);
  assert.match(body, /groceryclaw_admin_requests_total/);
});
