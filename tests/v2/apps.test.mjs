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
        resolve({ proc, status: res.status, body: await res.json() });
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
    { GATEWAY_HOST: '127.0.0.1', GATEWAY_PORT: '3200', NODE_ENV: 'test' },
    'http://127.0.0.1:3200/healthz'
  );

  proc.kill('SIGTERM');
  assert.equal(status, 200);
  assert.equal(body.service, 'gateway');
});

test('admin ready endpoint responds 200', async () => {
  const { proc, status, body } = await startServer(
    'apps/admin/dist/server.js',
    { ADMIN_HOST: '127.0.0.1', ADMIN_PORT: '3201', NODE_ENV: 'test', ADMIN_ENABLED: 'false' },
    'http://127.0.0.1:3201/readyz'
  );

  proc.kill('SIGTERM');
  assert.equal(status, 200);
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
