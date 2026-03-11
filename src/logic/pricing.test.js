const test = require('node:test');
const assert = require('node:assert/strict');
const { applyRounding, selectPricingRule, buildPriceSuggestion } = require('./pricing');

test('applyRounding respects configured rule', () => {
  assert.equal(applyRounding(1234, 'none'), 1234);
  assert.equal(applyRounding(1234, 'round_100'), 1300);
  assert.equal(applyRounding(1234, 'round_500'), 1500);
  assert.equal(applyRounding(1234, 'round_1000'), 2000);
});

test('selectPricingRule follows priority product > supplier > category > default', () => {
  const rules = [
    { rule_type: 'category', rule_key: 'Bia', margin_percent: 12, priority: 1, is_active: true },
    { rule_type: 'supplier', rule_key: 'TIEP_DUNG', margin_percent: 10, priority: 2, is_active: true },
    { rule_type: 'product', rule_key: 'SP001', margin_percent: 9, priority: 3, is_active: true },
    { rule_type: 'category', rule_key: 'DEFAULT', margin_percent: 15, priority: 0, is_active: true }
  ];

  const rule = selectPricingRule({ productCode: 'SP001', supplierCode: 'TIEP_DUNG', categoryName: 'Bia', rules });
  assert.equal(rule.rule_type, 'product');
  assert.equal(Number(rule.margin_percent), 9);
});

test('buildPriceSuggestion calculates rounded minimum price', () => {
  const suggested = buildPriceSuggestion({ cost: 10000, rule: { margin_percent: 15, rounding_rule: 'round_100' } });
  assert.equal(suggested, 11500);
});
