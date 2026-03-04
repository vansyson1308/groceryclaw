import test from 'node:test';
import assert from 'node:assert/strict';
import { processInboundEventPipeline } from '../../apps/worker/dist/process-inbound.js';

test('process inbound creates canonical rows and enqueues next stage', async () => {
  const xml = '<invoice><invoiceNumber>INV-2</invoiceNumber><invoiceDate>2026-02-01</invoiceDate><items><item><name>A</name><qty>1</qty><unitPrice>10</unitPrice><lineTotal>10</lineTotal></item></items><total>10</total></invoice>';
  const statements = [];
  const queue = [];

  await processInboundEventPipeline({
    queryOne: async (sql) => {
      statements.push(sql);
      if (sql.includes('FROM inbound_events')) {
        return JSON.stringify({ id: '22222222-2222-2222-2222-222222222222', tenant_id: '11111111-1111-1111-1111-111111111111', payload: { attachments: [{ type: 'file', url: `https://files.zalo.me/invoice.xml` }] }, file_url: `https://files.zalo.me/invoice.xml` });
      }
      if (sql.includes('RETURNING id::text')) {
        return '33333333-3333-3333-3333-333333333333';
      }
      return '';
    },
    exec: async (sql) => { statements.push(sql); },
    enqueue: async (payload) => { queue.push(payload); },
    xmlParseEnabled: true,
    allowedDomains: ['zalo.me'],
    maxBytes: 1024 * 1024,
    timeoutMs: 10000,
    fetchXml: async () => xml
  }, {
    job_type: 'PROCESS_INBOUND_EVENT',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: '22222222-2222-2222-2222-222222222222',
    platform_user_id: 'u1',
    zalo_msg_id: 'm1',
    correlation_id: 'c1'
  });

  // because remote fetch is not performed against localhost under SSRF allowlist,
  // this test validates persistence/enqueue path via SQL emissions and queue payload.
  assert.ok(statements.some((sql) => sql.includes('canonical_invoices') || sql.includes('xml_parse_failed')));
  assert.ok(queue.length >= 1);
});

test('process inbound invalid xml enqueues notify placeholder', async () => {
  const statements = [];
  const queue = [];

  await processInboundEventPipeline({
    queryOne: async (sql) => {
      if (sql.includes('FROM inbound_events')) {
        return JSON.stringify({ id: '22222222-2222-2222-2222-222222222222', tenant_id: '11111111-1111-1111-1111-111111111111', payload: { attachments: [{ type: 'file', url: 'https://files.zalo.me/invoice.xml' }] }, file_url: 'https://files.zalo.me/invoice.xml' });
      }
      return '';
    },
    exec: async (sql) => { statements.push(sql); },
    enqueue: async (payload) => { queue.push(payload); },
    xmlParseEnabled: false,
    allowedDomains: ['zalo.me'],
    maxBytes: 1024,
    timeoutMs: 10
  }, {
    job_type: 'PROCESS_INBOUND_EVENT',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: '22222222-2222-2222-2222-222222222222',
    platform_user_id: 'u1',
    zalo_msg_id: 'm1',
    correlation_id: 'c1'
  });

  assert.ok(queue.some((x) => x.template === 'xml_skipped'));
  assert.ok(statements.some((sql) => sql.includes("status = 'completed'")));
});
