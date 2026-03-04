import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInvoiceXml } from '../../packages/common/dist/index.js';

const validXml = `<invoice><supplierCode>S1</supplierCode><invoiceNumber>INV-001</invoiceNumber><invoiceDate>2026-01-01</invoiceDate><currency>VND</currency><subtotal>100</subtotal><taxTotal>10</taxTotal><total>110</total><items><item><name>Item A</name><qty>2</qty><unitPrice>50</unitPrice><lineTotal>100</lineTotal></item></items></invoice>`;

test('parseInvoiceXml parses canonical invoice', () => {
  const parsed = parseInvoiceXml(validXml);
  assert.equal(parsed.invoice_number, 'INV-001');
  assert.equal(parsed.items.length, 1);
});

test('parseInvoiceXml rejects xxe payload', () => {
  assert.throws(() => parseInvoiceXml('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><invoice></invoice>'));
});
