import type { WorkerJobEnvelope } from '../../../packages/common/dist/index.js';

export interface ConfirmMappingDeps {
  readonly queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
  readonly queryMany: (sql: string, params?: readonly unknown[]) => Promise<string[]>;
  readonly exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  readonly enqueue: (payload: Record<string, unknown>) => Promise<void>;
}

interface PendingRow {
  id: string;
  canonicalInvoiceId: string;
  canonicalItemId: string;
  suggestedSku: string;
  suggestedName: string;
  invoiceProductName: string;
}

function parsePendingRow(line: string): PendingRow | null {
  const parts = line.split('|');
  if (parts.length < 6) return null;
  return {
    id: parts[0] ?? '',
    canonicalInvoiceId: parts[1] ?? '',
    canonicalItemId: parts[2] ?? '',
    suggestedSku: parts[3] ?? '',
    suggestedName: parts[4] ?? '',
    invoiceProductName: parts.slice(5).join('|')
  };
}

function notifyEnvelope(job: WorkerJobEnvelope, message: string): Record<string, unknown> {
  return {
    job_type: 'NOTIFY_USER',
    notification_type: 'GENERIC_INFO',
    tenant_id: job.tenant_id,
    platform_user_id: job.platform_user_id,
    telegram_chat_id: job.telegram_chat_id,
    correlation_id: job.correlation_id,
    message_id: job.message_id,
    inbound_event_id: job.inbound_event_id,
    template_vars: { message }
  };
}

const SELECT_COLS = `id::text || '|' || canonical_invoice_id::text || '|' || canonical_item_id::text || '|' || suggested_sku || '|' || suggested_name || '|' || invoice_product_name`;

export async function processConfirmMapping(deps: ConfirmMappingDeps, job: WorkerJobEnvelope): Promise<void> {
  if (!job.tenant_id) throw new Error('confirm_mapping_missing_tenant');

  const text = (job.message_text ?? '').trim().toLowerCase();
  const isConfirm = text === '1' || text === 'dung' || text === 'đúng';
  const isReject = text === '2' || text === 'sai';
  const isSkip = text === '3' || text === 'bo qua' || text === 'bỏ qua';

  // -----------------------------------------------------------------------
  // Manual SKU input: reply to a pending confirmation with arbitrary text
  // -----------------------------------------------------------------------
  if (!isConfirm && !isReject && !isSkip) {
    if (job.reply_to_message_id && job.telegram_chat_id) {
      const row = await deps.queryOne(`
        SELECT ${SELECT_COLS}
        FROM pending_confirmations
        WHERE telegram_chat_id = $1
          AND sent_message_id = $2
          AND status = 'pending'
          AND expires_at > now()
        LIMIT 1;
      `, [job.telegram_chat_id, String(job.reply_to_message_id)]);

      if (row.trim()) {
        const manualPending = parsePendingRow(row.trim());
        if (manualPending) {
          await processManualSku(deps, job, manualPending, text);
          return;
        }
      }
    }

    // Not a valid confirmation response — forward to chatbot
    await deps.enqueue({
      job_type: 'CHATBOT_REPLY',
      tenant_id: job.tenant_id,
      platform_user_id: job.platform_user_id,
      message_id: job.message_id,
      correlation_id: job.correlation_id,
      inbound_event_id: job.inbound_event_id,
      telegram_chat_id: job.telegram_chat_id,
      message_text: job.message_text
    });
    return;
  }

  // -----------------------------------------------------------------------
  // Find the pending confirmation
  // -----------------------------------------------------------------------
  let pending: PendingRow | null = null;

  // Primary: lookup by reply_to_message_id
  if (job.reply_to_message_id && job.telegram_chat_id) {
    const row = await deps.queryOne(`
      SELECT ${SELECT_COLS}
      FROM pending_confirmations
      WHERE telegram_chat_id = $1
        AND sent_message_id = $2
        AND status = 'pending'
        AND expires_at > now()
      LIMIT 1;
    `, [job.telegram_chat_id, String(job.reply_to_message_id)]);
    if (row.trim()) {
      pending = parsePendingRow(row.trim());
    }
  }

  // Fallback: find by user's active pendings
  if (!pending) {
    const rows = await deps.queryMany(`
      SELECT ${SELECT_COLS}
      FROM pending_confirmations
      WHERE tenant_id = $1::uuid
        AND platform_user_id = $2
        AND status = 'pending'
        AND expires_at > now()
      ORDER BY created_at ASC;
    `, [job.tenant_id, job.platform_user_id]);

    if (rows.length === 0) {
      // No pending confirmations — forward to chatbot
      await deps.enqueue({
        job_type: 'CHATBOT_REPLY',
        tenant_id: job.tenant_id,
        platform_user_id: job.platform_user_id,
        message_id: job.message_id,
        correlation_id: job.correlation_id,
        inbound_event_id: job.inbound_event_id,
        telegram_chat_id: job.telegram_chat_id,
        message_text: job.message_text
      });
      return;
    }

    if (rows.length === 1) {
      pending = parsePendingRow(rows[0]!.trim());
    } else {
      // Multiple pending — ask user to reply to specific message
      await deps.enqueue(notifyEnvelope(job,
        `Ban co ${rows.length} SP dang cho xac nhan. Vui long reply truc tiep vao tin nhan can tra loi.`));
      return;
    }
  }

  if (!pending || !pending.id) {
    await deps.enqueue(notifyEnvelope(job, 'Khong tim thay SP can xac nhan. Co the da het han.'));
    return;
  }

  // -----------------------------------------------------------------------
  // Process confirmation, rejection, or skip
  // -----------------------------------------------------------------------
  if (isConfirm) {
    if (!pending.suggestedSku) {
      // Unresolved item without suggestion — cannot confirm, ask for SKU
      await deps.enqueue(notifyEnvelope(job,
        `SP "${pending.invoiceProductName}" chua co goi y. Vui long gui ma SKU hoac reply 3=Bo qua.`));
      return;
    }

    // a. Insert into mapping_dictionary (learning for future Tier 1 hits)
    await deps.exec(`
      INSERT INTO mapping_dictionary (tenant_id, alias_text, target_sku, confidence)
      VALUES ($1::uuid, $2, $3, 100)
      ON CONFLICT (tenant_id, alias_text) DO UPDATE SET target_sku = EXCLUDED.target_sku, confidence = 100;
    `, [job.tenant_id as string, pending.invoiceProductName, pending.suggestedSku]);

    // b. Update resolved_invoice_items to 'resolved'
    await deps.exec(`
      UPDATE resolved_invoice_items
      SET status = 'resolved', resolved_sku = $1, unresolved_reason = NULL
      WHERE canonical_item_id = $2::uuid AND tenant_id = $3::uuid;
    `, [pending.suggestedSku, pending.canonicalItemId, job.tenant_id as string]);

    // c. Mark pending_confirmation as confirmed
    await deps.exec(`
      UPDATE pending_confirmations
      SET status = 'confirmed', resolved_at = now()
      WHERE id = $1::uuid;
    `, [pending.id]);

  } else if (isReject) {
    await deps.exec(`
      UPDATE resolved_invoice_items
      SET status = 'unresolved', unresolved_reason = 'user_rejected'
      WHERE canonical_item_id = $1::uuid AND tenant_id = $2::uuid;
    `, [pending.canonicalItemId, job.tenant_id as string]);

    await deps.exec(`
      UPDATE pending_confirmations
      SET status = 'rejected', resolved_at = now()
      WHERE id = $1::uuid;
    `, [pending.id]);

  } else {
    // Skip (promotional/gift item)
    await deps.exec(`
      UPDATE resolved_invoice_items
      SET status = 'skipped', unresolved_reason = 'user_skipped'
      WHERE canonical_item_id = $1::uuid AND tenant_id = $2::uuid;
    `, [pending.canonicalItemId, job.tenant_id as string]);

    await deps.exec(`
      UPDATE pending_confirmations
      SET status = 'skipped', resolved_at = now()
      WHERE id = $1::uuid;
    `, [pending.id]);
  }

  // -----------------------------------------------------------------------
  // Check remaining status + trigger sync if ready
  // -----------------------------------------------------------------------
  const eventType = isConfirm ? 'mapping_confirmed' : isReject ? 'mapping_rejected' : 'mapping_skipped';
  await checkRemainingAndNotify(deps, job, pending, isConfirm, isReject, isSkip, eventType);
}

// ---------------------------------------------------------------------------
// Manual SKU: user replies with a SKU code to map an unresolved item
// ---------------------------------------------------------------------------
async function processManualSku(
  deps: ConfirmMappingDeps,
  job: WorkerJobEnvelope,
  pending: PendingRow,
  rawText: string
): Promise<void> {
  const manualSku = rawText.toUpperCase().trim();

  // Verify SKU exists in product_cache
  const skuRow = await deps.queryOne(`
    SELECT sku || '|' || product_name
    FROM product_cache
    WHERE tenant_id = $1::uuid AND UPPER(sku) = $2 AND active = true
    LIMIT 1;
  `, [job.tenant_id as string, manualSku]);

  if (!skuRow.trim()) {
    await deps.enqueue(notifyEnvelope(job,
      `Ma "${manualSku}" khong co trong kho. Vui long kiem tra lai, hoac reply 3=Bo qua.`));
    return;
  }

  const [verifiedSku] = skuRow.trim().split('|');
  const sku = verifiedSku ?? manualSku;

  // Learn mapping
  await deps.exec(`
    INSERT INTO mapping_dictionary (tenant_id, alias_text, target_sku, confidence)
    VALUES ($1::uuid, $2, $3, 100)
    ON CONFLICT (tenant_id, alias_text) DO UPDATE SET target_sku = EXCLUDED.target_sku, confidence = 100;
  `, [job.tenant_id as string, pending.invoiceProductName, sku]);

  // Resolve the item
  await deps.exec(`
    UPDATE resolved_invoice_items
    SET status = 'resolved', resolved_sku = $1, unresolved_reason = NULL
    WHERE canonical_item_id = $2::uuid AND tenant_id = $3::uuid;
  `, [sku, pending.canonicalItemId, job.tenant_id as string]);

  // Mark pending as confirmed
  await deps.exec(`
    UPDATE pending_confirmations
    SET status = 'confirmed', resolved_at = now()
    WHERE id = $1::uuid;
  `, [pending.id]);

  await checkRemainingAndNotify(deps, job, pending, true, false, false, 'mapping_manual_sku');
}

// ---------------------------------------------------------------------------
// Shared: check remaining items, build status message, trigger sync if ready
// ---------------------------------------------------------------------------
async function checkRemainingAndNotify(
  deps: ConfirmMappingDeps,
  job: WorkerJobEnvelope,
  pending: PendingRow,
  isConfirm: boolean,
  isReject: boolean,
  isSkip: boolean,
  eventType: string
): Promise<void> {
  const remainingRow = await deps.queryOne(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending_confirmation')::text || '|' ||
      COUNT(*) FILTER (WHERE status = 'unresolved')::text || '|' ||
      COUNT(*) FILTER (WHERE status = 'resolved')::text || '|' ||
      COUNT(*) FILTER (WHERE status = 'skipped')::text
    FROM resolved_invoice_items
    WHERE canonical_invoice_id = $1::uuid AND tenant_id = $2::uuid;
  `, [pending.canonicalInvoiceId, job.tenant_id as string]);

  const parts = remainingRow.trim().split('|');
  const remainingPending = Number(parts[0] ?? '0');
  const remainingUnresolved = Number(parts[1] ?? '0');
  const resolvedNow = Number(parts[2] ?? '0');
  const skippedNow = Number(parts[3] ?? '0');

  // Build status message
  let statusMsg: string;
  if (isConfirm) {
    const displayName = pending.suggestedName || pending.suggestedSku;
    statusMsg = `Da xac nhan: "${pending.invoiceProductName}" = "${displayName}". He thong se tu dong nhan dien lan sau.`;
  } else if (isReject) {
    statusMsg = `Da ghi nhan: "${pending.invoiceProductName}" khong phai la "${pending.suggestedName}".`;
  } else {
    statusMsg = `Da bo qua: "${pending.invoiceProductName}" (hang KM/khong can nhap).`;
  }

  // Append remaining status
  const statusParts: string[] = [];
  if (remainingPending > 0) statusParts.push(`${remainingPending} SP cho xac nhan`);
  if (remainingUnresolved > 0) statusParts.push(`${remainingUnresolved} SP chua nhan dien`);
  if (skippedNow > 0) statusParts.push(`${skippedNow} SP da bo qua`);
  if (statusParts.length > 0) {
    statusMsg += ` Con ${statusParts.join(', ')}.`;
  }

  // Check if all items decided — trigger sync if any resolved
  if (remainingPending === 0) {
    if (resolvedNow > 0) {
      if (remainingUnresolved === 0) {
        statusMsg += ' Tat ca SP da doi chieu, dang tao phieu nhap...';
      } else {
        statusMsg += ` ${resolvedNow} SP da doi chieu, dang tao phieu nhap...`;
      }

      await deps.enqueue({
        job_type: 'KIOTVIET_SYNC',
        tenant_id: job.tenant_id,
        canonical_invoice_id: pending.canonicalInvoiceId,
        correlation_id: job.correlation_id,
        platform_user_id: job.platform_user_id,
        message_id: job.message_id,
        inbound_event_id: job.inbound_event_id,
        telegram_chat_id: job.telegram_chat_id
      });
    } else if (resolvedNow === 0 && skippedNow > 0) {
      statusMsg += ' Tat ca SP da bo qua, khong tao phieu nhap.';
    }
  }

  await deps.enqueue(notifyEnvelope(job, statusMsg));

  // Audit log
  await deps.exec(`
    INSERT INTO audit_logs (tenant_id, actor_type, actor_id, event_type, resource_type, resource_id, payload)
    VALUES ($1::uuid, 'user', $2, $3, 'pending_confirmations', $4, $5::jsonb);
  `, [
    job.tenant_id as string,
    job.platform_user_id,
    eventType,
    pending.id,
    JSON.stringify({ invoice_product: pending.invoiceProductName, suggested_sku: pending.suggestedSku })
  ]);
}
