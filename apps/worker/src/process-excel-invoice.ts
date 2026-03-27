import { createHash } from 'node:crypto';
import { parseExcelInvoice, type WorkerJobEnvelope, type CanonicalInvoiceItem } from '../../../packages/common/dist/index.js';
import { runTenantScopedTransaction } from './db-session.js';
import type { TelegramOutboundAdapter } from './telegram-adapter.js';

export interface ExcelInvoiceDeps {
  readonly queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
  readonly exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  readonly enqueue: (payload: Record<string, unknown>) => Promise<void>;
  readonly runInTenantTransaction?: <T>(tenantId: string, jobType: string, work: (db: {
    queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
    exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  }) => Promise<T>) => Promise<T>;
  readonly telegramAdapter: TelegramOutboundAdapter;
  readonly permissionCheckEnabled?: boolean;
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function filterByEmployeePermissions(
  deps: ExcelInvoiceDeps,
  tenantId: string,
  platformUserId: string,
  items: readonly CanonicalInvoiceItem[]
): Promise<CanonicalInvoiceItem[]> {
  // Look up the tenant_user for this platform_user_id
  const tuOut = await deps.queryOne(`
    SELECT tu.id::text
    FROM platform_users pu
    JOIN tenant_users tu ON tu.user_id = pu.id
    WHERE pu.platform_user_id = ${sqlQuote(platformUserId)}
      AND tu.tenant_id = ${sqlQuote(tenantId)}::uuid
      AND tu.status = 'active'
    LIMIT 1;
  `);

  const tenantUserId = tuOut.split('\n').map(l => l.trim()).find(l => /^[0-9a-f-]{36}$/i.test(l));
  if (!tenantUserId) return [...items]; // user not found -> allow all (safety)

  // Check if user has 'all' permission
  const allOut = await deps.queryOne(`
    SELECT COUNT(*)::text
    FROM employee_permissions
    WHERE tenant_id = ${sqlQuote(tenantId)}::uuid
      AND tenant_user_id = ${sqlQuote(tenantUserId)}::uuid
      AND permission_type = 'all';
  `);
  const allCount = Number(allOut.trim()) || 0;
  if (allCount > 0) return [...items];

  // Get specific permissions
  const permOut = await deps.queryOne(`
    SELECT string_agg(permission_type || ':' || permission_value, '|')
    FROM employee_permissions
    WHERE tenant_id = ${sqlQuote(tenantId)}::uuid
      AND tenant_user_id = ${sqlQuote(tenantUserId)}::uuid;
  `);

  const permString = permOut.trim();
  if (!permString) return [...items]; // no permissions defined -> allow all (open access default)

  const allowedCodes = new Set<string>();
  const allowedCategories = new Set<string>();
  for (const entry of permString.split('|')) {
    const [type, value] = entry.split(':');
    if (type === 'product_code' && value) allowedCodes.add(value.toLowerCase());
    if (type === 'category' && value) allowedCategories.add(value.toLowerCase());
  }

  return items.filter(item => {
    if (item.sku && allowedCodes.has(item.sku.toLowerCase())) return true;
    if (item.product_name && allowedCategories.has(item.product_name.toLowerCase())) return true;
    // If permissions are defined but item doesn't match, filter it out
    return false;
  });
}

export async function processExcelInvoice(deps: ExcelInvoiceDeps, job: WorkerJobEnvelope): Promise<void> {
  if (!job.tenant_id || !job.inbound_event_id) {
    throw new Error('excel_invoice_missing_context');
  }

  if (!job.file_id) {
    throw new Error('excel_invoice_missing_file_id');
  }

  const tenantId = job.tenant_id;
  const fileId = job.file_id;

  const buffer = await deps.telegramAdapter.downloadFile(fileId);

  const rawInvoice = await parseExcelInvoice(buffer);

  // Filter items by employee permissions if enabled
  let filteredItems: readonly CanonicalInvoiceItem[] = rawInvoice.items;
  if (deps.permissionCheckEnabled) {
    filteredItems = await filterByEmployeePermissions(deps, tenantId, job.platform_user_id, rawInvoice.items);
  }

  const invoice = {
    ...rawInvoice,
    items: filteredItems,
    subtotal: filteredItems.reduce((sum, i) => sum + i.line_total, 0),
    total: filteredItems.reduce((sum, i) => sum + i.line_total, 0),
    tax_total: 0
  };

  if (invoice.items.length === 0) {
    if (job.telegram_chat_id) {
      await deps.enqueue({
        job_type: 'NOTIFY_USER',
        notification_type: 'GENERIC_INFO',
        correlation_id: job.correlation_id,
        tenant_id: tenantId,
        inbound_event_id: job.inbound_event_id,
        platform_user_id: job.platform_user_id,
        message_id: job.message_id,
        telegram_chat_id: job.telegram_chat_id,
        template_vars: { message: 'Khong co san pham nao trong quyen xu ly cua ban.' }
      });
    }
    return;
  }

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({
      invoice_number: invoice.invoice_number,
      items: invoice.items.map(i => `${i.product_name}:${i.quantity}:${i.unit_price}`)
    }))
    .digest('hex')
    .slice(0, 32);

  const work = async (db: {
    queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
    exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  }) => {
    const existingOut = await db.queryOne(`
      SELECT id::text FROM canonical_invoices
      WHERE tenant_id = ${sqlQuote(tenantId)}::uuid
        AND invoice_fingerprint = ${sqlQuote(fingerprint)}
      LIMIT 1;
    `);

    if (existingOut.trim()) {
      return existingOut.trim();
    }

    const insertOut = await db.queryOne(`
      INSERT INTO canonical_invoices (
        tenant_id, inbound_event_id, invoice_fingerprint,
        supplier_code, invoice_number, invoice_date,
        currency, subtotal, tax_total, total, raw_payload
      ) VALUES (
        ${sqlQuote(tenantId)}::uuid,
        ${sqlQuote(job.inbound_event_id!)}::uuid,
        ${sqlQuote(fingerprint)},
        ${invoice.supplier_code ? sqlQuote(invoice.supplier_code) : 'NULL'},
        ${sqlQuote(invoice.invoice_number)},
        ${sqlQuote(invoice.invoice_date)}::date,
        ${sqlQuote(invoice.currency)},
        ${invoice.subtotal},
        ${invoice.tax_total},
        ${invoice.total},
        ${sqlQuote(JSON.stringify({ source: 'excel', file_id: fileId }))}::jsonb
      )
      ON CONFLICT (tenant_id, invoice_fingerprint) DO NOTHING
      RETURNING id::text;
    `);

    const canonicalInvoiceId = insertOut.split('\n').map(l => l.trim()).find(l => /^[0-9a-f-]{36}$/i.test(l));
    if (!canonicalInvoiceId) {
      return null;
    }

    for (const item of invoice.items) {
      await db.exec(`
        INSERT INTO canonical_invoice_items (
          tenant_id, canonical_invoice_id, line_no,
          sku, product_name, quantity, unit_price, line_total, uom
        ) VALUES (
          ${sqlQuote(tenantId)}::uuid,
          ${sqlQuote(canonicalInvoiceId)}::uuid,
          ${item.line_no},
          ${item.sku ? sqlQuote(item.sku) : 'NULL'},
          ${sqlQuote(item.product_name)},
          ${item.quantity},
          ${item.unit_price},
          ${item.line_total},
          ${item.uom ? sqlQuote(item.uom) : 'NULL'}
        );
      `);
    }

    return canonicalInvoiceId;
  };

  let canonicalInvoiceId: string | null;

  if (deps.runInTenantTransaction) {
    canonicalInvoiceId = await deps.runInTenantTransaction(tenantId, 'PROCESS_EXCEL_INVOICE', work);
  } else {
    canonicalInvoiceId = await work({ queryOne: deps.queryOne, exec: deps.exec });
  }

  if (canonicalInvoiceId) {
    await deps.enqueue({
      job_type: 'MAP_RESOLVE',
      correlation_id: job.correlation_id,
      tenant_id: tenantId,
      inbound_event_id: job.inbound_event_id,
      platform_user_id: job.platform_user_id,
      message_id: job.message_id,
      canonical_invoice_id: canonicalInvoiceId,
      ...(job.telegram_chat_id ? { telegram_chat_id: job.telegram_chat_id } : {})
    });
  }

  if (job.telegram_chat_id) {
    await deps.enqueue({
      job_type: 'NOTIFY_USER',
      notification_type: 'INVOICE_PROCESSED',
      correlation_id: job.correlation_id,
      tenant_id: tenantId,
      inbound_event_id: job.inbound_event_id,
      platform_user_id: job.platform_user_id,
      message_id: job.message_id,
      telegram_chat_id: job.telegram_chat_id,
      template_vars: {
        item_count: invoice.items.length,
        total: invoice.total,
        currency: invoice.currency
      }
    });
  }
}
