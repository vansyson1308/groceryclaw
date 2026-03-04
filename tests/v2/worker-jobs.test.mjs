import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkerJobEnvelope } from '../../packages/common/dist/index.js';

test('validateWorkerJobEnvelope accepts PROCESS_INBOUND_EVENT payload', () => {
  const parsed = validateWorkerJobEnvelope({
    job_type: 'PROCESS_INBOUND_EVENT',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: '22222222-2222-2222-2222-222222222222',
    platform_user_id: 'u1',
    zalo_msg_id: 'm1',
    correlation_id: 'c1'
  });

  assert.equal(parsed.ok, true);
});

test('validateWorkerJobEnvelope rejects missing tenant for PROCESS_INBOUND_EVENT', () => {
  const parsed = validateWorkerJobEnvelope({
    job_type: 'PROCESS_INBOUND_EVENT',
    tenant_id: null,
    inbound_event_id: '22222222-2222-2222-2222-222222222222',
    platform_user_id: 'u1',
    zalo_msg_id: 'm1',
    correlation_id: 'c1'
  });

  assert.equal(parsed.ok, false);
});


test('validateWorkerJobEnvelope accepts MAP_RESOLVE payload', () => {
  const parsed = validateWorkerJobEnvelope({
    job_type: 'MAP_RESOLVE',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: null,
    platform_user_id: 'u1',
    zalo_msg_id: 'm1',
    correlation_id: 'c1',
    canonical_invoice_id: '33333333-3333-3333-3333-333333333333'
  });
  assert.equal(parsed.ok, true);
});


test('validateWorkerJobEnvelope accepts NOTIFY_USER payload', () => {
  const parsed = validateWorkerJobEnvelope({
    job_type: 'NOTIFY_USER',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: null,
    platform_user_id: 'u1',
    zalo_msg_id: 'm1',
    correlation_id: 'c1',
    notification_type: 'RATE_LIMITED',
    template_vars: {}
  });
  assert.equal(parsed.ok, true);
});

test('validateWorkerJobEnvelope accepts FLUSH_PENDING_NOTIFICATIONS payload', () => {
  const parsed = validateWorkerJobEnvelope({
    job_type: 'FLUSH_PENDING_NOTIFICATIONS',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: '22222222-2222-2222-2222-222222222222',
    platform_user_id: 'u1',
    zalo_user_id: '33333333-3333-3333-3333-333333333333',
    zalo_msg_id: 'm1',
    correlation_id: 'c1'
  });
  assert.equal(parsed.ok, true);
});

test('validateWorkerJobEnvelope accepts numeric enqueued_at_ms and rejects invalid values', () => {
  const ok = validateWorkerJobEnvelope({
    job_type: 'PROCESS_INBOUND_EVENT',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: '22222222-2222-2222-2222-222222222222',
    platform_user_id: 'u1',
    zalo_msg_id: 'm1',
    correlation_id: 'c1',
    enqueued_at_ms: Date.now()
  });
  assert.equal(ok.ok, true);

  const bad = validateWorkerJobEnvelope({
    job_type: 'PROCESS_INBOUND_EVENT',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: '22222222-2222-2222-2222-222222222222',
    platform_user_id: 'u1',
    zalo_msg_id: 'm1',
    correlation_id: 'c1',
    enqueued_at_ms: -5
  });
  assert.equal(bad.ok, false);
});
