function applyRounding(value, roundingRule = 'none') {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;

  if (roundingRule === 'round_100') return Math.ceil(v / 100) * 100;
  if (roundingRule === 'round_500') return Math.ceil(v / 500) * 500;
  if (roundingRule === 'round_1000') return Math.ceil(v / 1000) * 1000;
  return Math.ceil(v);
}

function selectPricingRule({ productCode, supplierCode, categoryName, rules }) {
  const active = (rules || []).filter((r) => r.is_active !== false);

  const byType = (type, key) => active
    .filter((r) => r.rule_type === type && String(r.rule_key) === String(key))
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))[0];

  return (
    byType('product', productCode) ||
    byType('supplier', supplierCode) ||
    byType('category', categoryName) ||
    byType('category', 'DEFAULT') ||
    { margin_percent: 15, rounding_rule: 'none', rule_type: 'category', rule_key: 'DEFAULT' }
  );
}

function buildPriceSuggestion({ cost, rule }) {
  const margin = Number(rule.margin_percent || 0);
  const raw = Number(cost || 0) * (1 + margin / 100);
  return applyRounding(raw, rule.rounding_rule || 'none');
}

module.exports = { applyRounding, selectPricingRule, buildPriceSuggestion };
