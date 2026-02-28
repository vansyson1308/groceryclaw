function safeConversionRate(rate) {
  const parsed = Number(rate);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { conversion_rate: 1, warning: 'Invalid conversion_rate, fallback to 1' };
  }
  return { conversion_rate: parsed, warning: null };
}

function applyConversion(item, conversionRate) {
  const { conversion_rate, warning } = safeConversionRate(conversionRate);
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unit_price || 0);
  const converted_qty = quantity * conversion_rate;
  const converted_unit_price = item.is_promotion ? 0 : unitPrice / conversion_rate;

  return {
    ...item,
    conversion_rate,
    converted_qty,
    converted_unit_price,
    invariant_total_before: quantity * unitPrice,
    invariant_total_after: converted_qty * converted_unit_price,
    warning
  };
}

function buildPurchaseOrderPayload(mappedItems, meta) {
  const details = mappedItems.map((m) => ({
    productId: m.kiotviet_product_id,
    productCode: m.kiotviet_product_code,
    quantity: m.converted_qty,
    price: m.is_promotion ? 0 : m.converted_unit_price,
    discount: 0,
    description: m.is_promotion ? 'KM - Hàng tặng (Promo)' : ''
  }));

  const totalPayment = details.reduce((sum, d) => sum + (Number(d.quantity) * Number(d.price)), 0);

  return {
    branchId: Number(meta.branch_id || 1),
    supplierId: Number(meta.supplier_id || 0),
    supplierCode: String(meta.supplier_code || 'NCC_UNKNOWN'),
    purchaseOrderDetails: details,
    status: 2,
    statusValue: 'Hoàn thành',
    totalPayment,
    description: meta.description,
    payments: [
      {
        Method: 'Cash',
        Amount: totalPayment,
        AccountId: null
      }
    ]
  };
}

module.exports = {
  safeConversionRate,
  applyConversion,
  buildPurchaseOrderPayload
};
