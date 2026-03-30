export interface ConfirmDeps {
  readonly queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
  readonly queryMany: (sql: string, params?: readonly unknown[]) => Promise<string[]>;
  readonly exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
}

export interface RemainingCounts {
  pending: number;
  unresolved: number;
  resolved: number;
  skipped: number;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  status?: number;
  remaining: RemainingCounts;
  sync_triggered: boolean;
}

const VALID_ACTIONS = new Set(['confirm', 'reject', 'skip', 'manual_sku']);

interface PendingInfo {
  id: string;
  suggestedSku: string;
  suggestedName: string;
  invoiceProductName: string;
}

function parsePendingInfo(row: string): PendingInfo | null {
  const parts = row.split('|');
  if (parts.length < 4) return null;
  return {
    id: parts[0] ?? '',
    suggestedSku: parts[1] ?? '',
    suggestedName: parts[2] ?? '',
    invoiceProductName: parts.slice(3).join('|')
  };
}

const ZERO_REMAINING: RemainingCounts = { pending: 0, unresolved: 0, resolved: 0, skipped: 0 };

export async function processItemAction(
  deps: ConfirmDeps,
  tenantId: string,
  invoiceId: string,
  itemId: string,
  action: string,
  sku?: string,
  userId?: string
): Promise<ActionResult> {
  if (!VALID_ACTIONS.has(action)) {
    return { ok: false, error: 'invalid_action', status: 400, remaining: ZERO_REMAINING, sync_triggered: false };
  }

  // Verify item belongs to this invoice and tenant
  const itemRow = await deps.queryOne(`
    SELECT cii.product_name || '|' || COALESCE(ri.status, 'none')
    FROM canonical_invoice_items cii
    LEFT JOIN resolved_invoice_items ri ON ri.canonical_item_id = cii.id AND ri.tenant_id = cii.tenant_id
    WHERE cii.id = $1::uuid
      AND cii.canonical_invoice_id = $2::uuid
      AND cii.tenant_id = $3::uuid;
  `, [itemId, invoiceId, tenantId]);

  if (!itemRow.trim()) {
    return { ok: false, error: 'item_not_found', status: 404, remaining: ZERO_REMAINING, sync_triggered: false };
  }

  const itemParts = itemRow.trim().split('|');
  const itemProductName = itemParts.slice(0, -1).join('|');
  const currentStatus = itemParts[itemParts.length - 1] ?? 'none';

  // Check if already processed (idempotency)
  if (currentStatus === 'resolved' || currentStatus === 'skipped') {
    const remaining = await countRemaining(deps, invoiceId, tenantId);
    return { ok: false, error: 'already_processed', status: 409, remaining, sync_triggered: false };
  }

  // Find pending confirmation for this item (if any)
  const pendingRow = await deps.queryOne(`
    SELECT id::text || '|' || suggested_sku || '|' || suggested_name || '|' || invoice_product_name
    FROM pending_confirmations
    WHERE canonical_item_id = $1::uuid
      AND status = 'pending'
      AND expires_at > now()
    LIMIT 1;
  `, [itemId]);

  const pending = pendingRow.trim() ? parsePendingInfo(pendingRow.trim()) : null;
  const productName = pending?.invoiceProductName ?? itemProductName;

  // Process action
  if (action === 'confirm') {
    if (!pending?.suggestedSku) {
      return { ok: false, error: 'no_suggestion', status: 400, remaining: ZERO_REMAINING, sync_triggered: false };
    }

    // Learn mapping
    await deps.exec(`
      INSERT INTO mapping_dictionary (tenant_id, alias_text, target_sku, confidence)
      VALUES ($1::uuid, $2, $3, 100)
      ON CONFLICT (tenant_id, alias_text) DO UPDATE SET target_sku = EXCLUDED.target_sku, confidence = 100;
    `, [tenantId, productName, pending.suggestedSku]);

    // Resolve item
    await deps.exec(`
      UPDATE resolved_invoice_items
      SET status = 'resolved', resolved_sku = $1, unresolved_reason = NULL
      WHERE canonical_item_id = $2::uuid AND tenant_id = $3::uuid;
    `, [pending.suggestedSku, itemId, tenantId]);

    // Mark pending confirmed
    await deps.exec(`
      UPDATE pending_confirmations
      SET status = 'confirmed', resolved_at = now()
      WHERE id = $1::uuid;
    `, [pending.id]);

  } else if (action === 'reject') {
    await deps.exec(`
      UPDATE resolved_invoice_items
      SET status = 'unresolved', unresolved_reason = 'user_rejected'
      WHERE canonical_item_id = $1::uuid AND tenant_id = $2::uuid;
    `, [itemId, tenantId]);

    if (pending) {
      await deps.exec(`
        UPDATE pending_confirmations
        SET status = 'rejected', resolved_at = now()
        WHERE id = $1::uuid;
      `, [pending.id]);
    }

  } else if (action === 'skip') {
    await deps.exec(`
      UPDATE resolved_invoice_items
      SET status = 'skipped', unresolved_reason = 'user_skipped'
      WHERE canonical_item_id = $1::uuid AND tenant_id = $2::uuid;
    `, [itemId, tenantId]);

    if (pending) {
      await deps.exec(`
        UPDATE pending_confirmations
        SET status = 'skipped', resolved_at = now()
        WHERE id = $1::uuid;
      `, [pending.id]);
    }

  } else if (action === 'manual_sku') {
    if (!sku || !sku.trim()) {
      return { ok: false, error: 'sku_required', status: 400, remaining: ZERO_REMAINING, sync_triggered: false };
    }

    // Verify SKU exists in product_cache
    const skuRow = await deps.queryOne(`
      SELECT sku
      FROM product_cache
      WHERE tenant_id = $1::uuid AND UPPER(sku) = $2 AND active = true
      LIMIT 1;
    `, [tenantId, sku.trim().toUpperCase()]);

    const verifiedSku = skuRow.trim();
    if (!verifiedSku) {
      return { ok: false, error: 'sku_not_found', status: 400, remaining: ZERO_REMAINING, sync_triggered: false };
    }

    // Learn mapping
    await deps.exec(`
      INSERT INTO mapping_dictionary (tenant_id, alias_text, target_sku, confidence)
      VALUES ($1::uuid, $2, $3, 100)
      ON CONFLICT (tenant_id, alias_text) DO UPDATE SET target_sku = EXCLUDED.target_sku, confidence = 100;
    `, [tenantId, productName, verifiedSku]);

    // Resolve item
    await deps.exec(`
      UPDATE resolved_invoice_items
      SET status = 'resolved', resolved_sku = $1, unresolved_reason = NULL
      WHERE canonical_item_id = $2::uuid AND tenant_id = $3::uuid;
    `, [verifiedSku, itemId, tenantId]);

    // Mark pending confirmed (if exists)
    if (pending) {
      await deps.exec(`
        UPDATE pending_confirmations
        SET status = 'confirmed', resolved_at = now()
        WHERE id = $1::uuid;
      `, [pending.id]);
    }
  }

  // Count remaining
  const remaining = await countRemaining(deps, invoiceId, tenantId);

  // Determine if sync should be triggered
  const syncTriggered = remaining.pending === 0 && remaining.resolved > 0;

  // Audit log
  const eventType = action === 'confirm' ? 'mapping_confirmed'
    : action === 'reject' ? 'mapping_rejected'
    : action === 'skip' ? 'mapping_skipped'
    : 'mapping_manual_sku';

  await deps.exec(`
    INSERT INTO audit_logs (tenant_id, actor_type, actor_id, event_type, resource_type, resource_id, payload)
    VALUES ($1::uuid, 'miniapp_user', $2, $3, 'canonical_invoice_items', $4, $5::jsonb);
  `, [
    tenantId,
    userId ?? 'unknown',
    eventType,
    itemId,
    JSON.stringify({ action, sku: sku ?? null, product_name: productName })
  ]);

  return { ok: true, remaining, sync_triggered: syncTriggered };
}

async function countRemaining(deps: ConfirmDeps, invoiceId: string, tenantId: string): Promise<RemainingCounts> {
  const row = await deps.queryOne(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending_confirmation')::text || '|' ||
      COUNT(*) FILTER (WHERE status = 'unresolved')::text || '|' ||
      COUNT(*) FILTER (WHERE status = 'resolved')::text || '|' ||
      COUNT(*) FILTER (WHERE status = 'skipped')::text
    FROM resolved_invoice_items
    WHERE canonical_invoice_id = $1::uuid AND tenant_id = $2::uuid;
  `, [invoiceId, tenantId]);

  const parts = row.trim().split('|');
  return {
    pending: Number(parts[0] ?? '0'),
    unresolved: Number(parts[1] ?? '0'),
    resolved: Number(parts[2] ?? '0'),
    skipped: Number(parts[3] ?? '0')
  };
}
