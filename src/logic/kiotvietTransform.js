/**
 * Transform a KiotViet product payload into kiotviet_product_cache DB row shape.
 * Pure mapping for unit tests and workflow reuse.
 */
function mapKiotVietProductToCacheRow(product) {
  const firstInventory = Array.isArray(product?.inventories) && product.inventories.length > 0
    ? product.inventories[0]
    : null;

  return {
    kiotviet_product_id: product?.id ?? null,
    product_code: product?.code ?? null,
    product_name: product?.name ?? null,
    barcode: product?.barCode ?? null,
    category_id: product?.categoryId ?? null,
    category_name: product?.categoryName ?? null,
    base_price: product?.basePrice ?? null,
    cost: product?.cost ?? null,
    inventory_quantity: firstInventory?.onHand ?? 0,
    is_active: product?.isActive ?? true
  };
}

module.exports = {
  mapKiotVietProductToCacheRow
};
