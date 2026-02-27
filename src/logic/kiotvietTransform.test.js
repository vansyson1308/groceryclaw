const test = require('node:test');
const assert = require('node:assert/strict');
const { mapKiotVietProductToCacheRow } = require('./kiotvietTransform');

test('maps KiotViet product payload to cache row', () => {
  const input = {
    id: 12345,
    code: 'SP00123',
    name: 'Bia Budweiser Chai 330ml',
    barCode: '893123456789',
    categoryId: 101,
    categoryName: 'Bia',
    basePrice: 14000,
    cost: 10000,
    inventories: [{ onHand: 48 }],
    isActive: true
  };

  assert.deepEqual(mapKiotVietProductToCacheRow(input), {
    kiotviet_product_id: 12345,
    product_code: 'SP00123',
    product_name: 'Bia Budweiser Chai 330ml',
    barcode: '893123456789',
    category_id: 101,
    category_name: 'Bia',
    base_price: 14000,
    cost: 10000,
    inventory_quantity: 48,
    is_active: true
  });
});

test('handles missing inventory and optional fields', () => {
  const input = { id: 1, code: 'A1', inventories: [] };
  assert.equal(mapKiotVietProductToCacheRow(input).inventory_quantity, 0);
});
