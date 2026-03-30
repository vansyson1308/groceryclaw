export interface InvoiceItem {
  item_id: string;
  line_no: number;
  product_name: string;
  quantity: number;
  uom: string | null;
  unit_price: number;
  status: string | null;
  resolved_sku: string | null;
  resolved_name: string | null;
  sell_price: number | null;
  base_price: number | null;
  suggested_sku: string | null;
  suggested_name: string | null;
  confidence: number | null;
}

export interface InvoiceResponse {
  invoice: {
    id: string;
    invoice_number: string;
    invoice_date: string;
    supplier_code: string | null;
    total: number;
  };
  recognized: InvoiceItem[];
  pending: InvoiceItem[];
  unrecognized: InvoiceItem[];
  skipped: InvoiceItem[];
}

export interface InvoiceQueryDeps {
  readonly queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
  readonly queryMany: (sql: string, params?: readonly unknown[]) => Promise<string[]>;
}

function parseInvoiceRow(row: string): { id: string; invoice_number: string; invoice_date: string; supplier_code: string | null; total: number } | null {
  try {
    return JSON.parse(row) as ReturnType<typeof parseInvoiceRow>;
  } catch {
    return null;
  }
}

function parseItemRow(row: string): InvoiceItem | null {
  try {
    return JSON.parse(row) as InvoiceItem;
  } catch {
    return null;
  }
}

export async function getInvoice(deps: InvoiceQueryDeps, invoiceId: string): Promise<InvoiceResponse | null> {
  // Fetch invoice header
  const headerRow = await deps.queryOne(`
    SELECT json_build_object(
      'id', ci.id::text,
      'invoice_number', ci.invoice_number,
      'invoice_date', ci.invoice_date::text,
      'supplier_code', ci.supplier_code,
      'total', ci.total
    )::text
    FROM canonical_invoices ci
    WHERE ci.id = $1::uuid;
  `, [invoiceId]);

  const invoice = parseInvoiceRow(headerRow.trim());
  if (!invoice) return null;

  // Fetch all items with resolved status + product info + pending confirmations
  const itemRows = await deps.queryMany(`
    SELECT json_build_object(
      'item_id', cii.id::text,
      'line_no', cii.line_no,
      'product_name', cii.product_name,
      'quantity', cii.quantity,
      'uom', cii.uom,
      'unit_price', cii.unit_price,
      'status', ri.status,
      'resolved_sku', ri.resolved_sku,
      'resolved_name', pc.product_name,
      'sell_price', COALESCE(ri.sell_price, pc.base_price),
      'base_price', pc.base_price,
      'suggested_sku', pconf.suggested_sku,
      'suggested_name', pconf.suggested_name,
      'confidence', pconf.confidence
    )::text
    FROM canonical_invoice_items cii
    LEFT JOIN resolved_invoice_items ri ON ri.canonical_item_id = cii.id
    LEFT JOIN product_cache pc ON pc.sku = ri.resolved_sku AND pc.tenant_id = cii.tenant_id
    LEFT JOIN pending_confirmations pconf
      ON pconf.canonical_item_id = cii.id AND pconf.status = 'pending'
    WHERE cii.canonical_invoice_id = $1::uuid
    ORDER BY cii.line_no;
  `, [invoiceId]);

  const recognized: InvoiceItem[] = [];
  const pending: InvoiceItem[] = [];
  const unrecognized: InvoiceItem[] = [];
  const skipped: InvoiceItem[] = [];

  for (const row of itemRows) {
    const item = parseItemRow(row.trim());
    if (!item) continue;

    switch (item.status) {
      case 'resolved':
        recognized.push(item);
        break;
      case 'pending_confirmation':
        pending.push(item);
        break;
      case 'skipped':
        skipped.push(item);
        break;
      default:
        unrecognized.push(item);
        break;
    }
  }

  return { invoice, recognized, pending, unrecognized, skipped };
}
