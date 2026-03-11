import test from 'node:test';
import assert from 'node:assert/strict';
import { NotifierOutboundRateLimiter, InMemoryTokenBucketRateLimiter } from '../../packages/common/dist/index.js';
import { InMemoryStubZaloAdapter, ZaloSendError } from '../../apps/worker/dist/zalo-adapter.js';
import { NotifierRetriableError, processFlushPendingNotificationsJob, processNotifyUserJob } from '../../apps/worker/dist/notifier.js';

function makeDeps(overrides = {}) {
  const state = {
    ageSeconds: 999999,
    pending: [],
    jobs: []
  };
  const sql = [];

  const deps = {
    exec: async (statement) => {
      sql.push(statement);
      if (statement.includes('INSERT INTO pending_notifications')) {
        const typeMatch = statement.match(/'([A-Z_]+)'\s*,\s*\{?/g);
        const messageType = typeMatch?.[0]?.replace(/['\s,]/g, '') ?? 'GENERIC_INFO';
        state.pending.push({
          id: `p-${state.pending.length + 1}`,
          platform_user_id: 'user-1',
          message_type: messageType,
          payload: {},
          status: 'pending'
        });
      }
      if (statement.includes('INSERT INTO jobs')) {
        state.jobs.push(statement);
      }
      if (statement.includes("AND status = 'pending'\n          ORDER BY created_at DESC\n          OFFSET")) {
        const m = statement.match(/OFFSET\s+(\d+)/);
        const keep = m ? Number(m[1]) : 20;
        state.pending = state.pending.slice(-keep);
      }
      if (statement.includes("message_type = 'INVOICE_PROCESSED'")) {
        state.pending = state.pending.filter((item) => item.message_type !== 'INVOICE_PROCESSED');
      }
      if (statement.includes("SET status = 'flushed'")) {
        const idMatch = statement.match(/WHERE id = '([^']+)'::uuid/);
        const id = idMatch?.[1];
        state.pending = state.pending.map((item) => (item.id === id ? { ...item, status: 'flushed' } : item));
      }
      if (statement.includes("SET status = 'failed_terminal'")) {
        const idMatch = statement.match(/WHERE id = '([^']+)'::uuid/);
        const id = idMatch?.[1];
        state.pending = state.pending.map((item) => (item.id === id ? { ...item, status: 'failed_terminal' } : item));
      }
    },
    queryOne: async () => String(state.ageSeconds),
    queryMany: async () => state.pending
      .filter((item) => item.status === 'pending')
      .map((item) => `${item.id}|${item.platform_user_id}|${item.message_type}|${JSON.stringify(item.payload)}`),
    adapter: new InMemoryStubZaloAdapter(),
    enabled: true,
    interactionWindowEnforced: true,
    flushEnabled: true,
    dlqEnabled: true,
    maxMessageLen: 500,
    interactionWindowSeconds: 3600,
    pendingTtlSeconds: 86400,
    maxPendingPerUser: 2,
    flushBatchSize: 20,
    flushMaxPerRun: 20,
    flushRateLimiter: new InMemoryTokenBucketRateLimiter(100, 100),
    outboundRateLimiter: new NotifierOutboundRateLimiter({
      enabled: true,
      globalPerMinute: 100,
      perTenantPerMinute: 100,
      perUserBurst: 100
    }),
    retryBaseMs: 100,
    retryMaxMs: 2000,
    ...overrides
  };

  return { deps, state, sql };
}

test('closed window defers notification with pending row and no outbound send', async () => {
  const { deps, state } = makeDeps();
  state.ageSeconds = 7200;

  await processNotifyUserJob(deps, {
    job_type: 'NOTIFY_USER',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: null,
    platform_user_id: 'user-1',
    zalo_user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    zalo_msg_id: 'm1',
    correlation_id: 'c1',
    notification_type: 'INVOICE_PROCESSED',
    template_vars: { invoice_number: 'INV-1' }
  });

  assert.equal(deps.adapter.sent.length, 0);
  assert.equal(state.pending.length, 1);
  assert.equal(state.pending[0].status, 'pending');
});

test('flush sends pending exactly once and marks sent (idempotent)', async () => {
  const { deps, state } = makeDeps();
  state.ageSeconds = 60;
  state.pending.push({ id: 'p-1', platform_user_id: 'user-1', message_type: 'GENERIC_INFO', payload: { message: 'queued' }, status: 'pending' });

  await processFlushPendingNotificationsJob(deps, {
    job_type: 'FLUSH_PENDING_NOTIFICATIONS',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: 'in-1',
    platform_user_id: 'user-1',
    zalo_user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    zalo_msg_id: 'm1',
    correlation_id: 'c1'
  });

  await processFlushPendingNotificationsJob(deps, {
    job_type: 'FLUSH_PENDING_NOTIFICATIONS',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: 'in-2',
    platform_user_id: 'user-1',
    zalo_user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    zalo_msg_id: 'm2',
    correlation_id: 'c2'
  });

  assert.equal(deps.adapter.sent.length, 1);
  assert.equal(state.pending[0].status, 'flushed');
});

test('coalescing and backlog cap keep latest pending rows', async () => {
  const { deps, state } = makeDeps();
  state.ageSeconds = 999999;

  const baseJob = {
    job_type: 'NOTIFY_USER',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: null,
    platform_user_id: 'user-1',
    zalo_user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    zalo_msg_id: 'm1',
    correlation_id: 'c1',
    notification_type: 'INVOICE_PROCESSED',
    template_vars: { invoice_number: 'INV-1' }
  };

  await processNotifyUserJob(deps, baseJob);
  await processNotifyUserJob(deps, { ...baseJob, correlation_id: 'c2', template_vars: { invoice_number: 'INV-2' } });
  await processNotifyUserJob(deps, { ...baseJob, correlation_id: 'c3', notification_type: 'GENERIC_INFO', template_vars: { message: 'done' } });

  assert.equal(state.pending.length, 2);
  assert.ok(state.pending.some((item) => item.message_type === 'INVOICE_PROCESSED'));
  assert.ok(state.pending.some((item) => item.message_type === 'GENERIC_INFO'));
});

test('open window sends outbound and does not defer', async () => {
  const { deps, state } = makeDeps();
  state.ageSeconds = 30;

  await processNotifyUserJob(deps, {
    job_type: 'NOTIFY_USER',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: null,
    platform_user_id: 'user-1',
    zalo_user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    zalo_msg_id: 'm1',
    correlation_id: 'c1',
    notification_type: 'WELCOME_LINKED',
    template_vars: {}
  });

  assert.equal(deps.adapter.sent.length, 1);
  assert.equal(state.pending.length, 0);
});

test('retriable send errors throw NotifierRetriableError for retry', async () => {
  const retriableAdapter = {
    sendText: async () => {
      throw new ZaloSendError('RETRIABLE', 'zalo_http_429', 50);
    }
  };
  const { deps, state } = makeDeps({ adapter: retriableAdapter });
  state.ageSeconds = 20;

  await assert.rejects(
    processNotifyUserJob(deps, {
      job_type: 'NOTIFY_USER',
      tenant_id: '11111111-1111-1111-1111-111111111111',
      inbound_event_id: null,
      platform_user_id: 'user-1',
      zalo_user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      zalo_msg_id: 'm1',
      correlation_id: 'c1',
      notification_type: 'WELCOME_LINKED',
      template_vars: {}
    }),
    (error) => error instanceof NotifierRetriableError
  );
});

test('terminal send errors do not retry and move pending to failed_terminal with job record', async () => {
  const terminalAdapter = {
    sendText: async () => {
      throw new ZaloSendError('TERMINAL', 'zalo_http_400');
    }
  };
  const { deps, state } = makeDeps({ adapter: terminalAdapter });
  state.ageSeconds = 60;
  state.pending.push({ id: 'p-1', platform_user_id: 'user-1', message_type: 'GENERIC_INFO', payload: { message: 'queued' }, status: 'pending' });

  await processFlushPendingNotificationsJob(deps, {
    job_type: 'FLUSH_PENDING_NOTIFICATIONS',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: 'in-1',
    platform_user_id: 'user-1',
    zalo_user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    zalo_msg_id: 'm1',
    correlation_id: 'c1'
  });

  assert.equal(state.pending[0].status, 'failed_terminal');
  assert.ok(state.jobs.length > 0);
});
