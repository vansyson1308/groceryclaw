import test from 'node:test';
import assert from 'node:assert/strict';
import { startWorkerHealthServer } from '../../apps/worker/dist/health-server.js';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('worker health server exposes /healthz and /readyz with dependency status', async () => {
  let ready = false;
  const port = 3300 + Math.floor(Math.random() * 500);
  const server = startWorkerHealthServer({
    host: '127.0.0.1',
    port,
    isReady: async () => ready
  });

  await wait(80);

  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(health.status, 200);

  const notReady = await fetch(`http://127.0.0.1:${port}/readyz`);
  assert.equal(notReady.status, 503);

  ready = true;
  const yesReady = await fetch(`http://127.0.0.1:${port}/readyz`);
  assert.equal(yesReady.status, 200);

  server.close();
});
