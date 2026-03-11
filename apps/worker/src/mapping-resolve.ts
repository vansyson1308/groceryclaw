import type { WorkerJobEnvelope } from '../../../packages/common/dist/index.js';
import { runTenantScopedTransaction } from './db-session.js';

export interface MappingDeps {
  readonly queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
  readonly queryMany: (sql: string, params?: readonly unknown[]) => Promise<string[]>;
  readonly exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  readonly enqueue: (payload: Record<string, unknown>) => Promise<void>;
  readonly mappingEnabled: boolean;
}

interface CanonicalItem {
  id: string;
  sku: string | null;
  product_name: string;
  quantity: number;
  uom: string | null;
}

function parseItem(line: string): CanonicalItem | null {
  try {
    const parsed = JSON.parse(line) as CanonicalItem;
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

export async function processMapResolve(deps: MappingDeps, job: WorkerJobEnvelope): Promise<void> {
  if (!job.tenant_id) throw new Error('missing_tenant_id');
  if (!job.canonical_invoice_id) throw new Error('missing_canonical_invoice_id');

  if (!deps.mappingEnabled) {
    await deps.enqueue({ ...job, job_type: 'NOTIFY_USER', template: 'mapping_skipped' });
    return;
  }

  const canonicalItemsRaw = await deps.queryMany(`
    SELECT json_build_object(
      'id', cii.id::text,
      'sku', cii.sku,
      'product_name', cii.product_name,
      'quantity', cii.quantity,
      'uom', cii.uom
    )::text
    FROM canonical_invoice_items cii
    WHERE cii.canonical_invoice_id = $1::uuid
    ORDER BY cii.line_no ASC;
  `, [job.canonical_invoice_id]);

  const canonicalItems = canonicalItemsRaw.map(parseItem).filter((x): x is CanonicalItem => Boolean(x));

  const unresolved: CanonicalItem[] = [];

  await runTenantScopedTransaction({
    db: { runSql: deps.exec },
    tenantId: job.tenant_id,
    jobType: 'MAP_RESOLVE',
    work: async () => {
      for (const item of canonicalItems) {
        let resolvedSku = item.sku;
        if (!resolvedSku) {
          const aliasSku = await deps.queryOne(`
            SELECT target_sku
            FROM mapping_dictionary
            WHERE tenant_id = $1::uuid
              AND lower(alias_text) = lower($2)
            LIMIT 1;
          `, [job.tenant_id as string, item.product_name]);
          resolvedSku = aliasSku.trim() || null;
        }

        if (!resolvedSku) {
          unresolved.push(item);
          await deps.exec(`
            INSERT INTO resolved_invoice_items (
              tenant_id, canonical_invoice_id, canonical_item_id, status, quantity, unresolved_reason
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'unresolved', $4, 'mapping_not_found')
            ON CONFLICT (canonical_item_id) DO UPDATE SET status = 'unresolved', unresolved_reason = 'mapping_not_found';
          `, [job.tenant_id as string, job.canonical_invoice_id as string, item.id, item.quantity]);
          continue;
        }

        await deps.exec(`
          INSERT INTO resolved_invoice_items (
            tenant_id, canonical_invoice_id, canonical_item_id, status, resolved_sku, resolved_unit, quantity
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'resolved', $4, $5, $6)
          ON CONFLICT (canonical_item_id) DO UPDATE SET
            status = 'resolved',
            resolved_sku = EXCLUDED.resolved_sku,
            resolved_unit = EXCLUDED.resolved_unit,
            quantity = EXCLUDED.quantity,
            unresolved_reason = NULL;
        `, [job.tenant_id as string, job.canonical_invoice_id as string, item.id, resolvedSku, item.uom ?? null, item.quantity]);
      }

      await deps.exec(`
        INSERT INTO audit_logs (tenant_id, actor_type, actor_id, event_type, resource_type, resource_id, payload)
        VALUES ($1::uuid, 'system', 'worker', 'mapping_resolve', 'canonical_invoices', $2, $3::jsonb);
      `, [job.tenant_id as string, job.canonical_invoice_id as string, JSON.stringify({ unresolved_count: unresolved.length })]);
    }
  });

  if (unresolved.length > 0) {
    await deps.enqueue({ ...job, job_type: 'NOTIFY_USER', template: 'mapping_needs_input', unresolved_count: unresolved.length });
    return;
  }

  await deps.enqueue({ ...job, job_type: 'KIOTVIET_SYNC' });
}
