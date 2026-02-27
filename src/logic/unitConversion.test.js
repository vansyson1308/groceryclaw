const test = require('node:test');
const assert = require('node:assert/strict');
const { applyConversion, buildPurchaseOrderPayload } = require('./unitConversion');

test('applies thung->lon conversion invariantly (2 thung @240k, rate 24 => 48 lon @10k)', () => {
  const converted = applyConversion(
    { quantity: 2, unit_price: 240000, is_promotion: false },
    24
  );

  assert.equal(converted.converted_qty, 48);
  assert.equal(converted.converted_unit_price, 10000);
  assert.equal(converted.invariant_total_before, 480000);
  assert.equal(converted.invariant_total_after, 480000);
});

test('fallback conversion_rate <= 0 to 1', () => {
  const converted = applyConversion(
    { quantity: 2, unit_price: 240000, is_promotion: false },
    0
  );

  assert.equal(converted.conversion_rate, 1);
  assert.match(converted.warning, /fallback to 1/i);
});

test('builds completed PO payload with paid=100%', () => {
  const payload = buildPurchaseOrderPayload(
    [
      {
        kiotviet_product_id: 12345,
        kiotviet_product_code: 'SP00123',
        converted_qty: 48,
        converted_unit_price: 10000,
        is_promotion: false
      }
    ],
    {
      branch_id: 1,
      supplier_id: 5001,
      supplier_code: 'NCC_TIEP_DUNG',
      description: 'Auto-import via KiotViet-Taphoa Bot | Source: XML'
    }
  );

  assert.equal(payload.status, 2);
  assert.equal(payload.totalPayment, 480000);
  assert.equal(payload.payments[0].Amount, 480000);
});
