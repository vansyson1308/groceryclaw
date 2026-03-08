import { createHash } from 'node:crypto';
import { fetchUrlSafely, parseInvoiceXml, type WorkerJobEnvelope } from '../../../packages/common/dist/index.js';
import { runTenantScopedTransaction } from './db-session.js';

export interface ProcessInboundDeps {
  readonly queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
  readonly exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  readonly enqueue: (payload: Record<string, unknown>) => Promise<void>;
  readonly runInTenantTransaction?: <T>(tenantId: string, jobType: string, work: (db: {
    queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
    exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  }) => Promise<T>) => Promise<T>;
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

async function markJob(
  deps: ProcessInboundDeps,
  tenantId: string,
  correlationId: string,
  status: 'processing' | 'completed' | 'failed',
  errorMessage?: string
) {
  const sql = `
    INSERT INTO jobs (tenant_id, type, status, payload, started_at, completed_at, error_message)
    VALUES (
      $1::uuid,
      'PROCESS_INBOUND_EVENT',
      $2,
      jsonb_build_object('correlation_id', $3::text),
      CASE WHEN $2 = 'processing' THEN now() ELSE NULL END,
      CASE WHEN $2 IN ('completed','failed') THEN now() ELSE NULL END,
      $4
    );
  `;
  const params = [tenantId, status, correlationId, errorMessage ?? null] as const;

  if (deps.runInTenantTransaction) {
    await deps.runInTenantTransaction(tenantId, 'PROCESS_INBOUND_EVENT', async (db) => {
      await db.exec(sql, params);
    });
    return;
  }

  await deps.exec(sql, params);
}

async function withTenantTransaction<T>(
  deps: ProcessInboundDeps,
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

export async function processInboundEventPipeline(deps: ProcessInboundDeps, job: WorkerJobEnvelope): Promise<void> {
  if (!job.tenant_id || !job.inbound_event_id) {
    throw new Error('invalid_job_payload');
  }

  await markJob(deps, job.tenant_id, job.correlation_id, 'processing');

  if (!deps.xmlParseEnabled) {
    await deps.exec('UPDATE inbound_events SET status = $1, updated_at = now() WHERE id = $2::uuid;', ['completed', job.inbound_event_id]);
    await deps.enqueue({ job_type: 'NOTIFY_USER', template: 'xml_skipped', correlation_id: job.correlation_id, platform_user_id: job.platform_user_id, zalo_msg_id: job.zalo_msg_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id });
    await markJob(deps, job.tenant_id, job.correlation_id, 'completed');
    return;
  }

  const rowText = await withTenantTransaction(deps, job.tenant_id, 'PROCESS_INBOUND_EVENT', async (db) => db.queryOne(`
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
    await markJob(deps, job.tenant_id, job.correlation_id, 'failed', 'inbound_event_not_found');
    throw new Error('inbound_event_not_found');
  }

  const xmlUrl = extractXmlUrl(event);
  if (!xmlUrl) {
    await deps.exec('UPDATE inbound_events SET status = $1, error_message = $2, updated_at = now() WHERE id = $3::uuid;', ['failed', 'xml_attachment_missing', event.id]);
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

    await withTenantTransaction(deps, event.tenant_id, 'PROCESS_INBOUND_EVENT', async (db) => {
      const invoiceIdRaw = await db.queryOne(
        `
          INSERT INTO canonical_invoices (
            tenant_id, inbound_event_id, invoice_fingerprint, supplier_code, invoice_number,
            invoice_date, currency, subtotal, tax_total, total, raw_payload
          ) VALUES (
            $1::uuid,
            $2::uuid,
            $3,
            $4,
            $5,
            $6::date,
            $7,
            $8,
            $9,
            $10,
            $11::jsonb
          )
          ON CONFLICT (tenant_id, invoice_fingerprint) DO NOTHING
          RETURNING id::text;
        `,
        [
          event.tenant_id,
          event.id,
          fingerprint,
          parsed.supplier_code ?? null,
          parsed.invoice_number,
          parsed.invoice_date,
          parsed.currency,
          parsed.subtotal,
          parsed.tax_total,
          parsed.total,
          JSON.stringify(parsed)
        ]
      );

      let invoiceId = invoiceIdRaw.trim();
      if (!invoiceId) {
        const existingInvoiceId = (await db.queryOne(
          `
            SELECT id::text
            FROM canonical_invoices
            WHERE tenant_id = $1::uuid
              AND invoice_fingerprint = $2
            LIMIT 1;
          `,
          [event.tenant_id, fingerprint]
        )).trim();

        if (!existingInvoiceId) {
          throw new Error('canonical_invoice_insert_skipped');
        }

        invoiceId = existingInvoiceId;
      }

      for (const item of parsed.items) {
        await db.exec(
          `
            INSERT INTO canonical_invoice_items (
              tenant_id, canonical_invoice_id, line_no, sku, product_name, quantity, unit_price, line_total, uom
            ) VALUES (
              $1::uuid,
              $2::uuid,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9
            )
            ON CONFLICT (canonical_invoice_id, line_no) DO NOTHING;
          `,
          [
            event.tenant_id,
            invoiceId,
            item.line_no,
            item.sku ?? null,
            item.product_name,
            item.quantity,
            item.unit_price,
            item.line_total,
            item.uom ?? null
          ]
        );
      }

      await db.exec('UPDATE inbound_events SET status = $1, updated_at = now() WHERE id = $2::uuid;', ['completed', event.id]);
    });

    await deps.enqueue({ job_type: 'MAP_RESOLVE', correlation_id: job.correlation_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id, platform_user_id: job.platform_user_id, zalo_msg_id: job.zalo_msg_id });
    await markJob(deps, job.tenant_id, job.correlation_id, 'completed');
  } catch (error) {
    await deps.exec('UPDATE inbound_events SET status = $1, error_message = $2, updated_at = now() WHERE id = $3::uuid;', ['failed', 'xml_parse_failed', event.id]);
    await deps.enqueue({ job_type: 'NOTIFY_USER', template: 'xml_invalid', correlation_id: job.correlation_id, platform_user_id: job.platform_user_id, zalo_msg_id: job.zalo_msg_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id });
    await markJob(deps, job.tenant_id, job.correlation_id, 'failed', error instanceof Error ? error.message : 'xml_parse_failed');
  }
}
