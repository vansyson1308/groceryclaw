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

test('processExcelInvoice with permissionCheckEnabled: filters items by product_code', async () => {
  const { processExcelInvoice } = await import('../../apps/worker/dist/process-excel-invoice.js');

  const excelBuffer = await createTestExcelBuffer(
    ['Ten SP', 'SL', 'Don gia', 'Thanh tien', 'SKU'],
    [
      ['Sua tuoi TH', 10, 12000, 120000, 'SKU001'],
      ['Mi goi Hao Hao', 30, 4500, 135000, 'SKU002'],
      ['Dau an Neptune', 5, 45000, 225000, 'SKU003'],
    ]
  );

  const enqueuedJobs = [];
  const execCalls = [];
  let queryCount = 0;

  const deps = {
    queryOne: async (sql) => {
      queryCount++;
      // tenant_users lookup
      if (sql.includes('JOIN tenant_users')) return 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      // 'all' permission check
      if (sql.includes("permission_type = 'all'")) return '0';
      // specific permissions - allow only SKU001 and SKU003
      if (sql.includes('string_agg')) return 'product_code:SKU001|product_code:SKU003';
      // canonical_invoices check
      if (sql.includes('SELECT id::text FROM canonical_invoices')) return '';
      // insert canonical_invoices
      if (sql.includes('INSERT INTO canonical_invoices')) return '99999999-9999-9999-9999-999999999999';
      return '';
    },
    exec: async (sql) => { execCalls.push(sql); },
    enqueue: async (payload) => { enqueuedJobs.push(payload); },
    telegramAdapter: {
      sendText: async () => ({ message_id: 'stub' }),
      downloadFile: async () => excelBuffer,
    },
    permissionCheckEnabled: true,
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

  // Should have inserted only 2 items (SKU001 + SKU003), not SKU002
  const itemInserts = execCalls.filter(sql => sql.includes('INSERT INTO canonical_invoice_items'));
  assert.equal(itemInserts.length, 2, 'should insert 2 items (SKU001 + SKU003)');
  assert.ok(itemInserts[0].includes('SKU001'), 'first item should be SKU001');
  assert.ok(itemInserts[1].includes('SKU003'), 'second item should be SKU003');
});

test('processExcelInvoice with permissionCheckEnabled: all permission allows everything', async () => {
  const { processExcelInvoice } = await import('../../apps/worker/dist/process-excel-invoice.js');

  const excelBuffer = await createTestExcelBuffer(
    ['Ten SP', 'SL', 'Don gia'],
    [
      ['Item A', 1, 1000],
      ['Item B', 2, 2000],
      ['Item C', 3, 3000],
    ]
  );

  const execCalls = [];

  const deps = {
    queryOne: async (sql) => {
      if (sql.includes('JOIN tenant_users')) return 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      if (sql.includes("permission_type = 'all'")) return '1'; // has 'all' permission
      if (sql.includes('SELECT id::text FROM canonical_invoices')) return '';
      if (sql.includes('INSERT INTO canonical_invoices')) return '99999999-9999-9999-9999-999999999999';
      return '';
    },
    exec: async (sql) => { execCalls.push(sql); },
    enqueue: async () => {},
    telegramAdapter: {
      sendText: async () => ({ message_id: 'stub' }),
      downloadFile: async () => excelBuffer,
    },
    permissionCheckEnabled: true,
  };

  const job = {
    job_type: 'PROCESS_EXCEL_INVOICE',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: '22222222-2222-2222-2222-222222222222',
    platform_user_id: 'u1',
    message_id: 'm1',
    correlation_id: 'c1',
    file_id: 'file-abc',
  };

  await processExcelInvoice(deps, job);

  const itemInserts = execCalls.filter(sql => sql.includes('INSERT INTO canonical_invoice_items'));
  assert.equal(itemInserts.length, 3, 'all 3 items should be inserted with "all" permission');
});

test('processExcelInvoice with permissionCheckEnabled: no matching items sends notification', async () => {
  const { processExcelInvoice } = await import('../../apps/worker/dist/process-excel-invoice.js');

  const excelBuffer = await createTestExcelBuffer(
    ['Ten SP', 'SL', 'Don gia', 'SKU'],
    [
      ['Item A', 1, 1000, 'BLOCKED1'],
      ['Item B', 2, 2000, 'BLOCKED2'],
    ]
  );

  const enqueuedJobs = [];

  const deps = {
    queryOne: async (sql) => {
      if (sql.includes('JOIN tenant_users')) return 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      if (sql.includes("permission_type = 'all'")) return '0';
      if (sql.includes('string_agg')) return 'product_code:ALLOWED_ONLY';
      return '';
    },
    exec: async () => {},
    enqueue: async (payload) => { enqueuedJobs.push(payload); },
    telegramAdapter: {
      sendText: async () => ({ message_id: 'stub' }),
      downloadFile: async () => excelBuffer,
    },
    permissionCheckEnabled: true,
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

  const notifyJob = enqueuedJobs.find(j => j.job_type === 'NOTIFY_USER' && j.notification_type === 'GENERIC_INFO');
  assert.ok(notifyJob, 'should send notification about no permitted items');
  assert.ok(String(notifyJob.template_vars.message).includes('quyen'), 'notification should mention permissions');
});
