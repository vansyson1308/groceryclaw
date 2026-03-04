import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function has(cmd) {
  return spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' }).status === 0;
}

const shouldRun = process.env.RUN_COMPOSE_INTEGRATION === '1' && has('docker');

test('integration harness for compose webhook stack (opt-in)', {
  skip: !shouldRun,
  timeout: 60_000
}, () => {
  try {
    const up = spawnSync('bash', ['-lc', 'docker compose --env-file infra/compose/v2/.env.example -f infra/compose/v2/docker-compose.yml up -d --build'], { encoding: 'utf8', timeout: 55_000 });
    assert.equal(up.status, 0, up.stderr || up.stdout);

    const curl = spawnSync('bash', ['-lc', 'curl -sS -o /tmp/gc-webhook-compose-health.out -w "%{http_code}" http://127.0.0.1:8080/healthz'], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(curl.status, 0, curl.stderr || curl.stdout);
    assert.equal((curl.stdout || '').trim(), '200');
  } finally {
    spawnSync('bash', ['-lc', 'docker compose --env-file infra/compose/v2/.env.example -f infra/compose/v2/docker-compose.yml down -v --remove-orphans'], { encoding: 'utf8', timeout: 30_000 });
  }
});
