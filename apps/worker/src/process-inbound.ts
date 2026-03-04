import { createHash } from 'node:crypto';
import { fetchUrlSafely, parseInvoiceXml, type WorkerJobEnvelope } from '../../../packages/common/dist/index.js';
import { runTenantScopedTransaction } from './db-session.js';

export interface ProcessInboundDeps {
  readonly queryOne: (sql: string) => Promise<string>;
  readonly exec: (sql: string) => Promise<void>;
  readonly enqueue: (payload: Record<string, unknown>) => Promise<void>;
  readonly now?: () => number;
  readonly xmlParseEnabled: boolean;
  readonly allowedDomains: readonly string[];
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly fetchXml?: (url: string) => Promise<string>;
}

interface InboundEventRow {
  id: string;
  tenant_id: string;
  payload: Record<string, unknown>;
  file_url: string | null;
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
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

function extractXmlUrl(event: InboundEventRow): string | null {
  if (event.file_url) return event.file_url;
  const rawAttachments = (event.payload as { attachments?: unknown }).attachments;
  if (!Array.isArray(rawAttachments)) return null;
  for (const item of rawAttachments) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { url?: unknown; type?: unknown };
    if (typeof record.url === 'string' && (!record.type || record.type === 'file')) {
      return record.url;
    }
  }
  return null;
}

function invoiceFingerprint(tenantId: string, invoice: ReturnType<typeof parseInvoiceXml>): string {
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

async function markJob(deps: ProcessInboundDeps, tenantId: string, correlationId: string, status: 'processing' | 'completed' | 'failed', errorMessage?: string) {
  const sql = `
    INSERT INTO jobs (tenant_id, type, status, payload, started_at, completed_at, error_message)
    VALUES (
      ${sqlQuote(tenantId)}::uuid,
      'PROCESS_INBOUND_EVENT',
      ${sqlQuote(status)},
      jsonb_build_object('correlation_id', ${sqlQuote(correlationId)}),
      CASE WHEN ${sqlQuote(status)} = 'processing' THEN now() ELSE NULL END,
      CASE WHEN ${sqlQuote(status)} IN ('completed','failed') THEN now() ELSE NULL END,
      ${errorMessage ? sqlQuote(errorMessage) : 'NULL'}
    );
  `;
  await deps.exec(sql);
}

export async function processInboundEventPipeline(deps: ProcessInboundDeps, job: WorkerJobEnvelope): Promise<void> {
  if (!job.tenant_id || !job.inbound_event_id) {
    throw new Error('invalid_job_payload');
  }

  await markJob(deps, job.tenant_id, job.correlation_id, 'processing');

  if (!deps.xmlParseEnabled) {
    await deps.exec(`UPDATE inbound_events SET status = 'completed', updated_at = now() WHERE id = ${sqlQuote(job.inbound_event_id)}::uuid;`);
    await deps.enqueue({ job_type: 'NOTIFY_USER', template: 'xml_skipped', correlation_id: job.correlation_id, platform_user_id: job.platform_user_id, zalo_msg_id: job.zalo_msg_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id });
    await markJob(deps, job.tenant_id, job.correlation_id, 'completed');
    return;
  }

  const rowText = await deps.queryOne(`
    SELECT json_build_object(
      'id', id::text,
      'tenant_id', tenant_id::text,
      'payload', payload,
      'file_url', file_url
    )::text
    FROM inbound_events
    WHERE id = ${sqlQuote(job.inbound_event_id)}::uuid
    LIMIT 1;
  `);
  const event = parseInboundEventJson(rowText);
  if (!event) {
    await markJob(deps, job.tenant_id, job.correlation_id, 'failed', 'inbound_event_not_found');
    throw new Error('inbound_event_not_found');
  }

  const xmlUrl = extractXmlUrl(event);
  if (!xmlUrl) {
    await deps.exec(`UPDATE inbound_events SET status = 'failed', error_message = 'xml_attachment_missing', updated_at = now() WHERE id = ${sqlQuote(event.id)}::uuid;`);
    await deps.enqueue({ job_type: 'NOTIFY_USER', template: 'xml_invalid', correlation_id: job.correlation_id, platform_user_id: job.platform_user_id, zalo_msg_id: job.zalo_msg_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id });
    await markJob(deps, job.tenant_id, job.correlation_id, 'failed', 'xml_attachment_missing');
    return;
  }

  try {
    const xmlContent = deps.fetchXml
      ? await deps.fetchXml(xmlUrl)
      : (await fetchUrlSafely(xmlUrl, {
          allowedDomains: deps.allowedDomains,
          maxBytes: deps.maxBytes,
          timeoutMs: deps.timeoutMs
        })).body.toString('utf8');

    const parsed = parseInvoiceXml(xmlContent);
    const fingerprint = invoiceFingerprint(event.tenant_id, parsed);

    await runTenantScopedTransaction({
      db: { runSql: deps.exec },
      tenantId: event.tenant_id,
      jobType: 'PROCESS_INBOUND_EVENT',
      work: async () => {
        const insertInvoiceSql = `
          INSERT INTO canonical_invoices (
            tenant_id, inbound_event_id, invoice_fingerprint, supplier_code, invoice_number,
            invoice_date, currency, subtotal, tax_total, total, raw_payload
          ) VALUES (
            ${sqlQuote(event.tenant_id)}::uuid,
            ${sqlQuote(event.id)}::uuid,
            ${sqlQuote(fingerprint)},
            ${parsed.supplier_code ? sqlQuote(parsed.supplier_code) : 'NULL'},
            ${sqlQuote(parsed.invoice_number)},
            ${sqlQuote(parsed.invoice_date)}::date,
            ${sqlQuote(parsed.currency)},
            ${parsed.subtotal},
            ${parsed.tax_total},
            ${parsed.total},
            ${sqlQuote(JSON.stringify(parsed))}::jsonb
          )
          ON CONFLICT (tenant_id, invoice_fingerprint) DO NOTHING
          RETURNING id::text;
        `;

        const invoiceIdRaw = await deps.queryOne(insertInvoiceSql);
        const invoiceId = invoiceIdRaw.trim();

        if (invoiceId) {
          for (const item of parsed.items) {
            await deps.exec(`
              INSERT INTO canonical_invoice_items (
                tenant_id, canonical_invoice_id, line_no, sku, product_name, quantity, unit_price, line_total, uom
              ) VALUES (
                ${sqlQuote(event.tenant_id)}::uuid,
                ${sqlQuote(invoiceId)}::uuid,
                ${item.line_no},
                ${item.sku ? sqlQuote(item.sku) : 'NULL'},
                ${sqlQuote(item.product_name)},
                ${item.quantity},
                ${item.unit_price},
                ${item.line_total},
                ${item.uom ? sqlQuote(item.uom) : 'NULL'}
              )
              ON CONFLICT (canonical_invoice_id, line_no) DO NOTHING;
            `);
          }
        }
      }
    });

    await deps.exec(`UPDATE inbound_events SET status = 'completed', updated_at = now() WHERE id = ${sqlQuote(event.id)}::uuid;`);
    await deps.enqueue({ job_type: 'MAP_RESOLVE', correlation_id: job.correlation_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id, platform_user_id: job.platform_user_id, zalo_msg_id: job.zalo_msg_id });
    await markJob(deps, job.tenant_id, job.correlation_id, 'completed');
  } catch (error) {
    await deps.exec(`UPDATE inbound_events SET status = 'failed', error_message = 'xml_parse_failed', updated_at = now() WHERE id = ${sqlQuote(event.id)}::uuid;`);
    await deps.enqueue({ job_type: 'NOTIFY_USER', template: 'xml_invalid', correlation_id: job.correlation_id, platform_user_id: job.platform_user_id, zalo_msg_id: job.zalo_msg_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id });
    await markJob(deps, job.tenant_id, job.correlation_id, 'failed', error instanceof Error ? error.message : 'xml_parse_failed');
  }
}
