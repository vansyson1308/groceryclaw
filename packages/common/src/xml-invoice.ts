export interface CanonicalInvoiceItem {
  readonly line_no: number;
  readonly sku?: string;
  readonly product_name: string;
  readonly quantity: number;
  readonly unit_price: number;
  readonly line_total: number;
  readonly uom?: string;
}

export interface CanonicalInvoice {
  readonly supplier_code?: string;
  readonly invoice_number: string;
  readonly invoice_date: string;
  readonly currency: string;
  readonly subtotal: number;
  readonly tax_total: number;
  readonly total: number;
  readonly items: readonly CanonicalInvoiceItem[];
}

function tagValue(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const match = re.exec(xml);
  return match && match[1] ? match[1].trim() : null;
}

function parseNumber(input: string | null, fallback = 0): number {
  if (!input) return fallback;
  const n = Number(input ?? String(fallback));
  if (!Number.isFinite(n)) throw new Error('invalid_number');
  return n;
}

export function parseInvoiceXml(xml: string): CanonicalInvoice {
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new Error('xxe_disallowed');
  }

  const invoiceNumber = tagValue(xml, 'invoiceNumber');
  const invoiceDate = tagValue(xml, 'invoiceDate');
  const currency = tagValue(xml, 'currency') ?? 'VND';
  const supplierCode = tagValue(xml, 'supplierCode');

  if (!invoiceNumber || !invoiceDate) {
    throw new Error('invalid_invoice_header');
  }

  const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  if (itemMatches.length === 0) {
    throw new Error('missing_items');
  }

  const items = itemMatches.map((m, i) => {
    const itemXml = m[1] ?? '';
    const productName = tagValue(itemXml, 'name');
    if (!productName) throw new Error('invalid_item');

    const quantity = parseNumber(tagValue(itemXml, 'qty'));
    const unitPrice = parseNumber(tagValue(itemXml, 'unitPrice'));
    const lineTotal = parseNumber(tagValue(itemXml, 'lineTotal'), quantity * unitPrice);

    const sku = tagValue(itemXml, 'sku') ?? null;
    const uom = tagValue(itemXml, 'uom') ?? null;
    return {
      line_no: i + 1,
      ...(sku ? { sku } : {}),
      product_name: productName,
      quantity,
      unit_price: unitPrice,
      line_total: lineTotal,
      ...(uom ? { uom } : {})
    };
  });

  const subtotal = parseNumber(tagValue(xml, 'subtotal'), items.reduce((sum, x) => sum + x.line_total, 0));
  const taxTotal = parseNumber(tagValue(xml, 'taxTotal'), 0);
  const total = parseNumber(tagValue(xml, 'total'), subtotal + taxTotal);

  return {
    ...(supplierCode ? { supplier_code: supplierCode } : {}),
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    currency,
    subtotal,
    tax_total: taxTotal,
    total,
    items
  };
}
