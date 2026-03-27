import { createHash } from 'node:crypto';
import { fetchUrlSafely, type WorkerJobEnvelope } from '../../../packages/common/dist/index.js';
import { runTenantScopedTransaction } from './db-session.js';

export interface ImageInvoiceDeps {
  readonly queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
  readonly exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  readonly enqueue: (payload: Record<string, unknown>) => Promise<void>;
  readonly runInTenantTransaction?: <T>(tenantId: string, jobType: string, work: (db: {
    queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
    exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  }) => Promise<T>) => Promise<T>;
  readonly ocrEnabled: boolean;
  readonly openaiApiKey: string;
  readonly openaiModel: string;
  readonly allowedDomains: readonly string[];
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

interface InboundEventRow {
  id: string;
  tenant_id: string;
  payload: Record<string, unknown>;
  file_url: string | null;
}

interface ParsedInvoice {
  invoice_number: string;
  invoice_date: string;
  supplier_code?: string;
  currency: string;
  subtotal: number;
  tax_total: number;
  total: number;
  items: Array<{
    line_no: number;
    sku?: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    uom?: string;
  }>;
}

function parseInboundEventJson(rowText: string): InboundEventRow | null {
  try {
    const parsed = JSON.parse(rowText) as InboundEventRow;
    if (!parsed || !parsed.id || !parsed.tenant_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function extractImageUrl(event: InboundEventRow): string | null {
  const rawAttachments = (event.payload as { attachments?: unknown }).attachments;
  if (!Array.isArray(rawAttachments)) return null;
  for (const item of rawAttachments) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { url?: unknown; type?: unknown };
    if (typeof record.url === 'string' && record.type === 'image') {
      return record.url;
    }
  }
  if (event.file_url) return event.file_url;
  return null;
}

function invoiceFingerprint(tenantId: string, invoice: ParsedInvoice): string {
  const stable = JSON.stringify({
    tenant_id: tenantId,
    invoice_number: invoice.invoice_number,
    invoice_date: invoice.invoice_date,
    supplier_code: invoice.supplier_code ?? null,
    total: invoice.total,
    items: invoice.items.map((x) => ({
      sku: x.sku ?? null,
      product_name: x.product_name,
      quantity: x.quantity,
      unit_price: x.unit_price,
      line_total: x.line_total
    }))
  });
  return createHash('sha256').update(stable).digest('hex');
}

async function callOpenAiVision(apiKey: string, model: string, imageBase64: string, mimeType: string, timeoutMs: number): Promise<ParsedInvoice> {
  const systemPrompt = `Bạn là một hệ thống trích xuất dữ liệu hóa đơn. Phân tích ảnh hóa đơn và trả về JSON với cấu trúc chính xác sau:
{
  "invoice_number": "mã hóa đơn (nếu không thấy, tạo dạng IMG-YYYYMMDD-XXXX)",
  "invoice_date": "ngày hóa đơn dạng YYYY-MM-DD",
  "supplier_code": "mã nhà cung cấp nếu có",
  "currency": "VND",
  "subtotal": 0,
  "tax_total": 0,
  "total": tổng tiền,
  "items": [
    {
      "line_no": 1,
      "product_name": "tên sản phẩm",
      "quantity": số lượng,
      "unit_price": đơn giá,
      "line_total": thành tiền,
      "uom": "đơn vị tính"
    }
  ]
}
Luôn trả về JSON hợp lệ. Nếu không đọc được thông tin nào, dùng giá trị mặc định hợp lý. Số tiền dùng số nguyên (VND).`;

  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: dataUrl } }
        ]}
      ],
      max_tokens: 4096
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`openai_api_error:${response.status}:${errorText.slice(0, 200)}`);
  }

  const result = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = result.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('openai_empty_response');
  }

  const parsed = JSON.parse(content) as ParsedInvoice;
  if (!parsed.invoice_number || !parsed.invoice_date || !Array.isArray(parsed.items)) {
    throw new Error('openai_invalid_invoice_structure');
  }

  // Ensure defaults
  parsed.currency = parsed.currency || 'VND';
  parsed.subtotal = parsed.subtotal || 0;
  parsed.tax_total = parsed.tax_total || 0;
  parsed.total = parsed.total || 0;
  for (let i = 0; i < parsed.items.length; i++) {
    const item = parsed.items[i]!;
    item.line_no = item.line_no || (i + 1);
    item.quantity = item.quantity || 0;
    item.unit_price = item.unit_price || 0;
    item.line_total = item.line_total || 0;
  }

  return parsed;
}

async function withTenantTransaction<T>(
  deps: ImageInvoiceDeps,
  tenantId: string,
  jobType: string,
  work: (db: { queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>; exec: (sql: string, params?: readonly unknown[]) => Promise<void> }) => Promise<T>
): Promise<T> {
  if (deps.runInTenantTransaction) {
    return deps.runInTenantTransaction(tenantId, jobType, work);
  }
  return runTenantScopedTransaction({
    db: { runSql: (sql) => deps.exec(sql) },
    tenantId,
    jobType,
    work: async () => work({ queryOne: deps.queryOne, exec: deps.exec })
  });
}

export async function processImageInvoice(deps: ImageInvoiceDeps, job: WorkerJobEnvelope): Promise<void> {
  if (!job.tenant_id || !job.inbound_event_id) {
    throw new Error('invalid_job_payload');
  }

  if (!deps.ocrEnabled) {
    await deps.exec('UPDATE inbound_events SET status = $1, updated_at = now() WHERE id = $2::uuid;', ['completed', job.inbound_event_id]);
    return;
  }

  if (!deps.openaiApiKey) {
    await deps.enqueue({
      job_type: 'NOTIFY_USER', notification_type: 'PROCESSING_FAILED',
      correlation_id: job.correlation_id, platform_user_id: job.platform_user_id,
      message_id: job.message_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id
    });
    throw new Error('openai_api_key_missing');
  }

  const rowText = await withTenantTransaction(deps, job.tenant_id, 'PROCESS_IMAGE_INVOICE', async (db) => db.queryOne(`
    SELECT json_build_object(
      'id', id::text,
      'tenant_id', tenant_id::text,
      'payload', payload,
      'file_url', file_url
    )::text
    FROM inbound_events
    WHERE id = $1::uuid
    LIMIT 1;
  `, [job.inbound_event_id]));

  const event = parseInboundEventJson(rowText);
  if (!event) {
    throw new Error('inbound_event_not_found');
  }

  const imageUrl = extractImageUrl(event);
  if (!imageUrl) {
    await deps.exec('UPDATE inbound_events SET status = $1, error_message = $2, updated_at = now() WHERE id = $3::uuid;', ['failed', 'image_attachment_missing', event.id]);
    await deps.enqueue({
      job_type: 'NOTIFY_USER', notification_type: 'PROCESSING_FAILED',
      correlation_id: job.correlation_id, platform_user_id: job.platform_user_id,
      message_id: job.message_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id
    });
    return;
  }

  try {
    // Download image as bytes (Zalo URLs may be short-lived)
    const downloaded = await fetchUrlSafely(imageUrl, {
      allowedDomains: deps.allowedDomains,
      allowHttpDomains: [],
      maxBytes: deps.maxBytes,
      timeoutMs: deps.timeoutMs
    });

    const imageBase64 = downloaded.body.toString('base64');
    const mimeType = imageUrl.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg';

    const parsed = await callOpenAiVision(deps.openaiApiKey, deps.openaiModel, imageBase64, mimeType, deps.timeoutMs);
    const fingerprint = invoiceFingerprint(event.tenant_id, parsed);

    await withTenantTransaction(deps, event.tenant_id, 'PROCESS_IMAGE_INVOICE', async (db) => {
      const invoiceIdRaw = await db.queryOne(
        `INSERT INTO canonical_invoices (
          tenant_id, inbound_event_id, invoice_fingerprint, supplier_code, invoice_number,
          invoice_date, currency, subtotal, tax_total, total, raw_payload
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::date, $7, $8, $9, $10, $11::jsonb)
        ON CONFLICT (tenant_id, invoice_fingerprint) DO NOTHING
        RETURNING id::text;`,
        [
          event.tenant_id, event.id, fingerprint,
          parsed.supplier_code ?? null, parsed.invoice_number, parsed.invoice_date,
          parsed.currency, parsed.subtotal, parsed.tax_total, parsed.total,
          JSON.stringify(parsed)
        ]
      );

      let invoiceId = invoiceIdRaw.trim();
      if (!invoiceId) {
        const existingId = (await db.queryOne(
          `SELECT id::text FROM canonical_invoices WHERE tenant_id = $1::uuid AND invoice_fingerprint = $2 LIMIT 1;`,
          [event.tenant_id, fingerprint]
        )).trim();
        if (!existingId) throw new Error('canonical_invoice_insert_skipped');
        invoiceId = existingId;
      }

      for (const item of parsed.items) {
        await db.exec(
          `INSERT INTO canonical_invoice_items (
            tenant_id, canonical_invoice_id, line_no, sku, product_name, quantity, unit_price, line_total, uom
          ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (canonical_invoice_id, line_no) DO NOTHING;`,
          [event.tenant_id, invoiceId, item.line_no, item.sku ?? null, item.product_name, item.quantity, item.unit_price, item.line_total, item.uom ?? null]
        );
      }

      await db.exec('UPDATE inbound_events SET status = $1, updated_at = now() WHERE id = $2::uuid;', ['completed', event.id]);
    });

    await deps.enqueue({
      job_type: 'MAP_RESOLVE', correlation_id: job.correlation_id,
      tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id,
      platform_user_id: job.platform_user_id, message_id: job.message_id
    });
  } catch (error) {
    await deps.exec('UPDATE inbound_events SET status = $1, error_message = $2, updated_at = now() WHERE id = $3::uuid;',
      ['failed', 'image_ocr_failed', event.id]);
    await deps.enqueue({
      job_type: 'NOTIFY_USER', notification_type: 'PROCESSING_FAILED',
      correlation_id: job.correlation_id, platform_user_id: job.platform_user_id,
      message_id: job.message_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id
    });
    throw (error instanceof Error ? error : new Error('image_ocr_failed'));
  }
}
