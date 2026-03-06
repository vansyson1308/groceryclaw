import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRedisConfig, parseRedisUrl, redactRedisUrl, redisPing } from '../../packages/common/dist/index.js';

test('parseRedisUrl extracts host/port/db/password', () => {
  const cfg = parseRedisUrl('redis://:secret@redis.local:6380/2');
  assert.equal(cfg.host, 'redis.local');
  assert.equal(cfg.port, 6380);
  assert.equal(cfg.db, 2);
  assert.equal(cfg.password, 'secret');
});

test('loadRedisConfig supports canonical URL and fallback legacy vars', () => {
  const warnings = [];
  const viaUrl = loadRedisConfig({
    env: { REDIS_URL: 'redis://:topsecret@cache:6379/0' },
    onWarning: (message) => warnings.push(message)
  });
  assert.equal(viaUrl.host, 'cache');
  assert.equal(warnings.length, 0);

  const viaFallback = loadRedisConfig({
    env: { REDIS_HOST: 'legacy-cache', REDIS_PORT: '6381', REDIS_DB: '3', REDIS_PASSWORD: 'legacy' },
    onWarning: (message) => warnings.push(message)
  });
  assert.equal(viaFallback.host, 'legacy-cache');
  assert.equal(viaFallback.port, 6381);
  assert.equal(viaFallback.db, 3);
  assert.equal(viaFallback.password, 'legacy');
  assert.ok(warnings.some((m) => m.includes('deprecated')));
});

test('redactRedisUrl strips credentials', () => {
  const redacted = redactRedisUrl('redis://:super-secret@127.0.0.1:6379/0');
  assert.doesNotMatch(redacted, /super-secret/);
  assert.match(redacted, /\[REDACTED\]/);
});


test('redisPing returns false quickly for unreachable endpoint', async () => {
  const ok = await redisPing({ host: '127.0.0.1', port: 1, db: 0 }, 50);
  assert.equal(ok, false);
});
