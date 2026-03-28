import { createHash } from 'node:crypto';
import type { WorkerJobEnvelope } from '../../../packages/common/dist/index.js';
import { runTenantScopedTransaction } from './db-session.js';
import type { TelegramOutboundAdapter } from './telegram-adapter.js';

export interface ImageInvoiceDeps {
  readonly queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
  readonly exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  readonly enqueue: (payload: Record<string, unknown>) => Promise<void>;
  readonly runInTenantTransaction?: <T>(tenantId: string, jobType: string, work: (db: {
    queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
    exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  }) => Promise<T>) => Promise<T>;
  readonly telegramAdapter: TelegramOutboundAdapter;
  readonly ocrEnabled: boolean;
  readonly openaiApiKey: string;
  readonly openaiModel: string;
  readonly maxImageBytes: number;
  readonly openaiTimeoutMs: number;
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
  const systemPrompt = `Bạn là hệ thống trích xuất dữ liệu hóa đơn Việt Nam (hóa đơn GTGT, phiếu xuất kho, phiếu giao hàng). Đọc chính xác từng dòng hàng hóa trong ảnh.

QUY TẮC:
- Đọc chính xác tên sản phẩm, KHÔNG suy luận hay thay đổi
- Số lượng, đơn giá, thành tiền phải là SỐ NGUYÊN (VND, không có phần thập phân)
- Với số có dấu chấm phân cách hàng nghìn (VD: 33.334), chuyển thành số nguyên: 33334
- Mã hàng (SKU) lấy từ cột "Mã hàng" nếu có
- Nếu không thấy mã hóa đơn, dùng format: IMG-YYYYMMDD-NNNN (ngày từ hóa đơn, NNNN là 4 số cuối random)
- Ngày tháng format YYYY-MM-DD

TRẢ VỀ JSON:
{
  "invoice_number": "số/mã hóa đơn",
  "invoice_date": "YYYY-MM-DD",
  "supplier_code": "mã NCC nếu có, null nếu không",
  "currency": "VND",
  "subtotal": tổng trước thuế (số nguyên),
  "tax_total": tổng thuế (số nguyên),
  "total": tổng thanh toán (số nguyên),
  "items": [
    {
      "line_no": 1,
      "sku": "mã hàng hoặc null",
      "product_name": "tên hàng hóa chính xác",
      "quantity": số lượng (số nguyên hoặc thập phân),
      "unit_price": đơn giá (số nguyên),
      "line_total": thành tiền (số nguyên),
      "uom": "đơn vị tính"
    }
  ]
}
CHỈ trả về JSON, không thêm text.`;

  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
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
    return;
  }

  if (!deps.openaiApiKey) {
    await deps.enqueue({
      job_type: 'NOTIFY_USER', notification_type: 'PROCESSING_FAILED',
      correlation_id: job.correlation_id, platform_user_id: job.platform_user_id,
      message_id: job.message_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id,
      telegram_chat_id: job.telegram_chat_id
    });
    throw new Error('openai_api_key_missing');
  }

  if (!job.file_id) {
    await deps.enqueue({
      job_type: 'NOTIFY_USER', notification_type: 'PROCESSING_FAILED',
      correlation_id: job.correlation_id, platform_user_id: job.platform_user_id,
      message_id: job.message_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id,
      telegram_chat_id: job.telegram_chat_id
    });
    throw new Error('image_file_id_missing');
  }

  try {
    // Download image from Telegram via file_id
    const imageBuffer = await deps.telegramAdapter.downloadFile(job.file_id);

    if (imageBuffer.length > deps.maxImageBytes) {
      throw new Error('image_too_large');
    }

    const imageBase64 = imageBuffer.toString('base64');
    const mimeType = 'image/jpeg'; // Telegram converts all photos to JPEG

    const parsed = await callOpenAiVision(deps.openaiApiKey, deps.openaiModel, imageBase64, mimeType, deps.openaiTimeoutMs);
    const fingerprint = invoiceFingerprint(job.tenant_id, parsed);

    const result = await withTenantTransaction(deps, job.tenant_id, 'PROCESS_IMAGE_INVOICE', async (db) => {
      const invoiceIdRaw = await db.queryOne(
        `INSERT INTO canonical_invoices (
          tenant_id, inbound_event_id, invoice_fingerprint, supplier_code, invoice_number,
          invoice_date, currency, subtotal, tax_total, total, raw_payload
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::date, $7, $8, $9, $10, $11::jsonb)
        ON CONFLICT (tenant_id, invoice_fingerprint) DO NOTHING
        RETURNING id::text;`,
        [
          job.tenant_id, job.inbound_event_id, fingerprint,
          parsed.supplier_code ?? null, parsed.invoice_number, parsed.invoice_date,
          parsed.currency, parsed.subtotal, parsed.tax_total, parsed.total,
          JSON.stringify(parsed)
        ]
      );

      let invoiceId = invoiceIdRaw.trim();
      let isDuplicate = false;
      if (!invoiceId) {
        const existingId = (await db.queryOne(
          `SELECT id::text FROM canonical_invoices WHERE tenant_id = $1::uuid AND invoice_fingerprint = $2 LIMIT 1;`,
          [job.tenant_id, fingerprint]
        )).trim();
        if (!existingId) throw new Error('canonical_invoice_insert_skipped');
        invoiceId = existingId;
        isDuplicate = true;
      }

      for (const item of parsed.items) {
        await db.exec(
          `INSERT INTO canonical_invoice_items (
            tenant_id, canonical_invoice_id, line_no, sku, product_name, quantity, unit_price, line_total, uom
          ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (canonical_invoice_id, line_no) DO NOTHING;`,
          [job.tenant_id, invoiceId, item.line_no, item.sku ?? null, item.product_name, item.quantity, item.unit_price, item.line_total, item.uom ?? null]
        );
      }

      await db.exec('UPDATE inbound_events SET status = $1, updated_at = now() WHERE id = $2::uuid;', ['completed', job.inbound_event_id]);
      return { invoiceId, isDuplicate };
    });

    if (result.isDuplicate) {
      await deps.enqueue({
        job_type: 'NOTIFY_USER', notification_type: 'GENERIC_INFO',
        correlation_id: job.correlation_id, platform_user_id: job.platform_user_id,
        message_id: job.message_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id,
        telegram_chat_id: job.telegram_chat_id,
        template_vars: { message: 'Hoa don nay da duoc xu ly truoc do.' }
      });
      return;
    }

    const itemCount = parsed.items.length;
    const totalStr = parsed.total.toLocaleString('vi-VN');
    await deps.enqueue({
      job_type: 'NOTIFY_USER', notification_type: 'GENERIC_INFO',
      correlation_id: job.correlation_id, platform_user_id: job.platform_user_id,
      message_id: job.message_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id,
      telegram_chat_id: job.telegram_chat_id,
      template_vars: { message: `Da nhan dien ${itemCount} san pham, tong ${totalStr} VND tu anh hoa don.` }
    });

    await deps.enqueue({
      job_type: 'MAP_RESOLVE', correlation_id: job.correlation_id,
      tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id,
      platform_user_id: job.platform_user_id, message_id: job.message_id,
      telegram_chat_id: job.telegram_chat_id,
      canonical_invoice_id: result.invoiceId
    });
  } catch (error) {
    await deps.enqueue({
      job_type: 'NOTIFY_USER', notification_type: 'PROCESSING_FAILED',
      correlation_id: job.correlation_id, platform_user_id: job.platform_user_id,
      message_id: job.message_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id,
      telegram_chat_id: job.telegram_chat_id
    });
    throw (error instanceof Error ? error : new Error('image_ocr_failed'));
  }
}
