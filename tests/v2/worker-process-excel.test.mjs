import test from 'node:test';
import assert from 'node:assert/strict';

async function createTestExcelBuffer(headers, rows) {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.default.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow(row);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

test('processExcelInvoice: parses Excel and enqueues MAP_RESOLVE', async () => {
  const { processExcelInvoice } = await import('../../apps/worker/dist/process-excel-invoice.js');

  const excelBuffer = await createTestExcelBuffer(
    ['Ten SP', 'SL', 'Don gia', 'Thanh tien'],
    [
      ['Sua tuoi TH', 10, 12000, 120000],
      ['Mi goi Hao Hao', 30, 4500, 135000],
    ]
  );

  const enqueuedJobs = [];
  const execCalls = [];
  const queryCalls = [];

  const deps = {
    queryOne: async (sql) => {
      queryCalls.push(sql);
      if (sql.includes('SELECT id::text FROM canonical_invoices')) return '';
      if (sql.includes('INSERT INTO canonical_invoices')) return '99999999-9999-9999-9999-999999999999';
      return '';
    },
    exec: async (sql) => { execCalls.push(sql); },
    enqueue: async (payload) => { enqueuedJobs.push(payload); },
    telegramAdapter: {
      sendText: async () => ({ message_id: 'stub' }),
      downloadFile: async () => excelBuffer,
    }
  };

  const job = {
    job_type: 'PROCESS_EXCEL_INVOICE',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: '22222222-2222-2222-2222-222222222222',
    platform_user_id: 'u1',
    message_id: 'm1',
    correlation_id: 'c1',
    file_id: 'file-abc',
    telegram_chat_id: 12345,
  };

  await processExcelInvoice(deps, job);

  assert.ok(enqueuedJobs.length >= 1, 'should enqueue at least MAP_RESOLVE');

  const mapResolveJob = enqueuedJobs.find(j => j.job_type === 'MAP_RESOLVE');
  assert.ok(mapResolveJob, 'should enqueue MAP_RESOLVE');
  assert.equal(mapResolveJob.tenant_id, '11111111-1111-1111-1111-111111111111');
  assert.equal(mapResolveJob.canonical_invoice_id, '99999999-9999-9999-9999-999999999999');

  const notifyJob = enqueuedJobs.find(j => j.job_type === 'NOTIFY_USER');
  assert.ok(notifyJob, 'should enqueue NOTIFY_USER');
  assert.equal(notifyJob.notification_type, 'INVOICE_PROCESSED');
  assert.equal(notifyJob.telegram_chat_id, 12345);

  assert.ok(execCalls.some(sql => sql.includes('INSERT INTO canonical_invoice_items')), 'should insert invoice items');
});

test('processExcelInvoice: throws on missing file_id', async () => {
  const { processExcelInvoice } = await import('../../apps/worker/dist/process-excel-invoice.js');

  const deps = {
    queryOne: async () => '',
    exec: async () => {},
    enqueue: async () => {},
    telegramAdapter: { sendText: async () => ({ message_id: 'stub' }), downloadFile: async () => Buffer.from('') },
  };

  const job = {
    job_type: 'PROCESS_EXCEL_INVOICE',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: '22222222-2222-2222-2222-222222222222',
    platform_user_id: 'u1',
    message_id: 'm1',
    correlation_id: 'c1',
  };

  await assert.rejects(() => processExcelInvoice(deps, job), { message: 'excel_invoice_missing_file_id' });
});

test('processExcelInvoice: throws on missing tenant_id', async () => {
  const { processExcelInvoice } = await import('../../apps/worker/dist/process-excel-invoice.js');

  const deps = {
    queryOne: async () => '',
    exec: async () => {},
    enqueue: async () => {},
    telegramAdapter: { sendText: async () => ({ message_id: 'stub' }), downloadFile: async () => Buffer.from('') },
  };

  const job = {
    job_type: 'PROCESS_EXCEL_INVOICE',
    tenant_id: null,
    inbound_event_id: null,
    platform_user_id: 'u1',
    message_id: 'm1',
    correlation_id: 'c1',
    file_id: 'file-abc',
  };

  await assert.rejects(() => processExcelInvoice(deps, job), { message: 'excel_invoice_missing_context' });
});

test('processExcelInvoice: returns existing id for duplicate fingerprint', async () => {
  const { processExcelInvoice } = await import('../../apps/worker/dist/process-excel-invoice.js');

  const excelBuffer = await createTestExcelBuffer(
    ['Ten SP', 'SL', 'Don gia'],
    [['Test Item', 1, 1000]]
  );

  const enqueuedJobs = [];
  const execCalls = [];
  const deps = {
    queryOne: async (sql) => {
      if (sql.includes('SELECT id::text FROM canonical_invoices')) return '88888888-8888-8888-8888-888888888888';
      if (sql.includes('INSERT INTO canonical_invoices')) return '';
      return '';
    },
    exec: async (sql) => { execCalls.push(sql); },
    enqueue: async (payload) => { enqueuedJobs.push(payload); },
    telegramAdapter: {
      sendText: async () => ({ message_id: 'stub' }),
      downloadFile: async () => excelBuffer,
    }
  };

  const job = {
    job_type: 'PROCESS_EXCEL_INVOICE',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: '22222222-2222-2222-2222-222222222222',
    platform_user_id: 'u1',
    message_id: 'm1',
    correlation_id: 'c1',
    file_id: 'file-abc',
    telegram_chat_id: 12345,
  };

  await processExcelInvoice(deps, job);

  assert.ok(!execCalls.some(sql => sql.includes('INSERT INTO canonical_invoice_items')),
    'should NOT insert items for existing invoice');
});
