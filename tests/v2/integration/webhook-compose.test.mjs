import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function has(cmd) {
  return spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' }).status === 0;
}

test('integration harness for compose webhook stack (informational)', { skip: !has('docker') }, async () => {
  const up = spawnSync('bash', ['-lc', 'docker compose --env-file infra/compose/v2/.env.example -f infra/compose/v2/docker-compose.yml up -d --build'], { encoding: 'utf8' });
  assert.equal(up.status, 0, up.stderr || up.stdout);

  const curl = await fetch('http://127.0.0.1:8080/healthz');
  assert.equal(curl.status, 200);

  spawnSync('bash', ['-lc', 'docker compose --env-file infra/compose/v2/.env.example -f infra/compose/v2/docker-compose.yml down'], { encoding: 'utf8' });
});
