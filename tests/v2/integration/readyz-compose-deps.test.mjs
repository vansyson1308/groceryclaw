import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

function has(cmd) {
  return spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' }).status === 0;
}

const shouldRun = process.env.RUN_COMPOSE_INTEGRATION === '1' && has('docker');
const composeFile = 'infra/compose/v2/docker-compose.yml';

function run(cmd, timeout = 60_000) {
  const r = spawnSync('bash', ['-lc', cmd], { encoding: 'utf8', timeout });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || `failed: ${cmd}`);
  }
  return r.stdout.trim();
}

async function waitReady(expectedStatus, retries = 40) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const r = await fetch('http://127.0.0.1:8080/readyz');
      if (r.status === expectedStatus) {
        return;
      }
    } catch {
      // continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`gateway /readyz did not reach status ${expectedStatus}`);
}

test('gateway /readyz flips to 503 when redis or postgres is down', {
  skip: !shouldRun,
  timeout: 180_000
}, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'groceryclaw-readyz-'));
  const envFile = path.join(dir, '.env');

  const pgPassword = randomBytes(12).toString('hex');
  const redisPassword = randomBytes(12).toString('hex');
  const webhookSecret = randomBytes(16).toString('hex');

  writeFileSync(envFile, [
    'NODE_ENV=development',
    'LOG_LEVEL=info',
    'GATEWAY_HOST=0.0.0.0',
    'GATEWAY_PORT=8080',
    'POSTGRES_DB=groceryclaw_readyz_test',
    'POSTGRES_SUPERUSER=postgres',
    `POSTGRES_SUPERUSER_PASSWORD=${pgPassword}`,
    'APP_DB_USER=app_user',
    `APP_DB_PASSWORD=${pgPassword}`,
    `REDIS_PASSWORD=${redisPassword}`,
    `WEBHOOK_SIGNATURE_SECRET=${webhookSecret}`,
    'READYZ_STRICT=true',
    'READYZ_TIMEOUT_MS=300'
  ].join('\n'));

  const compose = (cmd, timeout) => run(`docker compose --env-file ${envFile} -f ${composeFile} ${cmd}`, timeout);

  try {
    compose('up -d postgres redis gateway', 120_000);
    await waitReady(200);

    compose('stop redis');
    await waitReady(503);

    compose('start redis');
    await waitReady(200);

    compose('stop postgres');
    await waitReady(503);
  } finally {
    try {
      compose('down -v --remove-orphans', 60_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
