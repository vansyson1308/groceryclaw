import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function has(cmd) {
  return spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' }).status === 0;
}

const shouldRun = process.env.RUN_COMPOSE_INTEGRATION === '1' && has('docker');

function run(cmd, timeout = 60_000) {
  const r = spawnSync('bash', ['-lc', cmd], { encoding: 'utf8', timeout });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || `failed: ${cmd}`);
  }
  return r.stdout.trim();
}

test('worker /healthz and /readyz are reachable inside compose network and return 200', {
  skip: !shouldRun,
  timeout: 120_000
}, () => {
  const compose = (cmd, timeout) => run(`docker compose --env-file infra/compose/v2/.env.example -f infra/compose/v2/docker-compose.yml ${cmd}`, timeout);

  try {
    compose('up -d postgres redis worker', 120_000);

    const health = compose("exec -T worker node -e \"fetch('http://127.0.0.1:3002/healthz').then(async r=>{if(!r.ok) process.exit(1); process.stdout.write(String(r.status));}).catch(()=>process.exit(1))\"");
    assert.equal(health, '200');

    const ready = compose("exec -T worker node -e \"fetch('http://127.0.0.1:3002/readyz').then(async r=>{if(!r.ok) process.exit(1); process.stdout.write(String(r.status));}).catch(()=>process.exit(1))\"");
    assert.equal(ready, '200');
  } finally {
    compose('down -v --remove-orphans', 60_000);
  }
});
