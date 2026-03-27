import test from 'node:test';
import assert from 'node:assert/strict';

async function createTestExcel(headers, rows) {
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

test('parseExcelInvoice: parses Vietnamese headers', async () => {
  const { parseExcelInvoice } = await import('../../packages/common/dist/index.js');

  const buffer = await createTestExcel(
    ['Ten SP', 'SL', 'Don gia', 'Thanh tien', 'Don vi'],
    [
      ['Sua tuoi TH', 10, 12000, 120000, 'hop'],
      ['Mi goi Hao Hao', 30, 4500, 135000, 'goi'],
      ['Dau an Neptune', 5, 45000, 225000, 'chai'],
    ]
  );

  const invoice = await parseExcelInvoice(buffer);

  assert.equal(invoice.items.length, 3);
  assert.equal(invoice.currency, 'VND');
  assert.equal(invoice.items[0].product_name, 'Sua tuoi TH');
  assert.equal(invoice.items[0].quantity, 10);
  assert.equal(invoice.items[0].unit_price, 12000);
  assert.equal(invoice.items[0].line_total, 120000);
  assert.equal(invoice.items[0].uom, 'hop');
  assert.equal(invoice.items[1].product_name, 'Mi goi Hao Hao');
  assert.equal(invoice.items[2].product_name, 'Dau an Neptune');
  assert.equal(invoice.total, 120000 + 135000 + 225000);
});

test('parseExcelInvoice: parses English headers', async () => {
  const { parseExcelInvoice } = await import('../../packages/common/dist/index.js');

  const buffer = await createTestExcel(
    ['Product Name', 'Quantity', 'Unit Price', 'Total', 'SKU'],
    [
      ['Rice 5kg', 20, 85000, 1700000, 'RICE-5KG'],
      ['Sugar 1kg', 15, 22000, 330000, 'SUG-1KG'],
    ]
  );

  const invoice = await parseExcelInvoice(buffer);

  assert.equal(invoice.items.length, 2);
  assert.equal(invoice.items[0].product_name, 'Rice 5kg');
  assert.equal(invoice.items[0].sku, 'RICE-5KG');
  assert.equal(invoice.items[0].quantity, 20);
  assert.equal(invoice.items[1].product_name, 'Sugar 1kg');
});

test('parseExcelInvoice: calculates line_total when column missing', async () => {
  const { parseExcelInvoice } = await import('../../packages/common/dist/index.js');

  const buffer = await createTestExcel(
    ['San pham', 'So luong', 'Don gia'],
    [
      ['Bot giat OMO', 8, 55000],
    ]
  );

  const invoice = await parseExcelInvoice(buffer);

  assert.equal(invoice.items.length, 1);
  assert.equal(invoice.items[0].line_total, 8 * 55000);
  assert.equal(invoice.total, 8 * 55000);
});

test('parseExcelInvoice: skips empty product name rows', async () => {
  const { parseExcelInvoice } = await import('../../packages/common/dist/index.js');

  const buffer = await createTestExcel(
    ['Ten SP', 'SL', 'Don gia', 'Thanh tien'],
    [
      ['Nuoc mam', 5, 25000, 125000],
      ['', 0, 0, 0],
      [null, 0, 0, 0],
      ['Muoi', 10, 5000, 50000],
    ]
  );

  const invoice = await parseExcelInvoice(buffer);

  assert.equal(invoice.items.length, 2);
  assert.equal(invoice.items[0].product_name, 'Nuoc mam');
  assert.equal(invoice.items[1].product_name, 'Muoi');
});

test('parseExcelInvoice: detects header in first 10 rows', async () => {
  const { parseExcelInvoice } = await import('../../packages/common/dist/index.js');

  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.default.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');

  sheet.addRow(['Hoa don nhap hang']);
  sheet.addRow(['Ngay: 2024-01-15']);
  sheet.addRow([]);
  sheet.addRow(['Ten SP', 'SL', 'Don gia', 'Thanh tien']);
  sheet.addRow(['Ca phe', 20, 15000, 300000]);

  const buf = await workbook.xlsx.writeBuffer();
  const invoice = await parseExcelInvoice(Buffer.from(buf));

  assert.equal(invoice.items.length, 1);
  assert.equal(invoice.items[0].product_name, 'Ca phe');
});

test('parseExcelInvoice: throws on empty buffer', async () => {
  const { parseExcelInvoice } = await import('../../packages/common/dist/index.js');

  await assert.rejects(
    () => parseExcelInvoice(Buffer.from('')),
    { message: 'excel_empty' }
  );
});

test('parseExcelInvoice: throws on invalid format', async () => {
  const { parseExcelInvoice } = await import('../../packages/common/dist/index.js');

  await assert.rejects(
    () => parseExcelInvoice(Buffer.from('not an excel file', 'utf-8')),
    { message: 'excel_invalid_format' }
  );
});

test('parseExcelInvoice: throws when header not found', async () => {
  const { parseExcelInvoice } = await import('../../packages/common/dist/index.js');

  const buffer = await createTestExcel(
    ['Col A', 'Col B', 'Col C'],
    [['x', 'y', 'z']]
  );

  await assert.rejects(
    () => parseExcelInvoice(buffer),
    { message: 'excel_header_not_found' }
  );
});

test('parseExcelInvoice: throws when no data rows', async () => {
  const { parseExcelInvoice } = await import('../../packages/common/dist/index.js');

  const buffer = await createTestExcel(
    ['Ten SP', 'SL', 'Don gia', 'Thanh tien'],
    []
  );

  await assert.rejects(
    () => parseExcelInvoice(buffer),
    { message: 'excel_no_data' }
  );
});

test('parseExcelInvoice: line_no is sequential starting from 1', async () => {
  const { parseExcelInvoice } = await import('../../packages/common/dist/index.js');

  const buffer = await createTestExcel(
    ['Ten SP', 'SL', 'Don gia'],
    [
      ['A', 1, 1000],
      ['B', 2, 2000],
      ['C', 3, 3000],
    ]
  );

  const invoice = await parseExcelInvoice(buffer);

  assert.equal(invoice.items[0].line_no, 1);
  assert.equal(invoice.items[1].line_no, 2);
  assert.equal(invoice.items[2].line_no, 3);
});
