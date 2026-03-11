import test from 'node:test';
import assert from 'node:assert/strict';
import { NotifierOutboundRateLimiter } from '../../packages/common/dist/index.js';

test('notifier outbound limiter enforces global and tenant caps deterministically', () => {
  const limiter = new NotifierOutboundRateLimiter({
    enabled: true,
    globalPerMinute: 2,
    perTenantPerMinute: 2,
    perUserBurst: 2
  });

  assert.equal(limiter.consume({ tenantId: 't1', platformUserId: 'u1' }).allowed, true);
  assert.equal(limiter.consume({ tenantId: 't1', platformUserId: 'u2' }).allowed, true);
  const blocked = limiter.consume({ tenantId: 't2', platformUserId: 'u3' });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.scope, 'global');
});

test('notifier outbound limiter can be disabled', () => {
  const limiter = new NotifierOutboundRateLimiter({
    enabled: false,
    globalPerMinute: 1,
    perTenantPerMinute: 1,
    perUserBurst: 1
  });

  for (let i = 0; i < 5; i += 1) {
    assert.equal(limiter.consume({ tenantId: 't1', platformUserId: 'u1' }).allowed, true);
  }
});
