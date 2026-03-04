import test from 'node:test';
import assert from 'node:assert/strict';
import { renderNotificationTemplate } from '../../packages/common/dist/index.js';

test('renders valid notification', () => {
  const msg = renderNotificationTemplate({
    tenant_id: '123e4567-e89b-42d3-a456-426614174000',
    platform_user_id: 'u1',
    notification_type: 'INVOICE_PROCESSED',
    template_vars: { invoice_number: 'INV-001' },
    correlation_id: 'c1'
  });
  assert.ok(msg.includes('INV-001'));
});

test('invalid template vars fail deterministically', () => {
  assert.throws(() => renderNotificationTemplate({
    tenant_id: '123e4567-e89b-42d3-a456-426614174000',
    platform_user_id: 'u1',
    notification_type: 'INVOICE_PROCESSED',
    template_vars: {},
    correlation_id: 'c1'
  }));
});

test('message blocks sensitive/token/internal-id patterns', () => {
  assert.throws(() => renderNotificationTemplate({
    tenant_id: '123e4567-e89b-42d3-a456-426614174000',
    platform_user_id: 'u1',
    notification_type: 'GENERIC_INFO',
    template_vars: { message: 'Bearer secret-token' },
    correlation_id: 'c1'
  }));

  assert.throws(() => renderNotificationTemplate({
    tenant_id: '123e4567-e89b-42d3-a456-426614174000',
    platform_user_id: 'u1',
    notification_type: 'GENERIC_INFO',
    template_vars: { message: 'internal id 123e4567-e89b-42d3-a456-426614174000' },
    correlation_id: 'c1'
  }));
});
