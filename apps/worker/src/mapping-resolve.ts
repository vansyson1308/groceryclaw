import type { WorkerJobEnvelope } from '../../../packages/common/dist/index.js';
import type { TelegramOutboundAdapter } from './telegram-adapter.js';

export interface MappingDeps {
  readonly queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
  readonly queryMany: (sql: string, params?: readonly unknown[]) => Promise<string[]>;
  readonly exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  readonly enqueue: (payload: Record<string, unknown>) => Promise<void>;
  readonly adapter: TelegramOutboundAdapter;
  readonly mappingEnabled: boolean;
  readonly openaiApiKey?: string;
  readonly openaiModel?: string;
  readonly miniappEnabled?: boolean;
  readonly miniappDomain?: string;
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

interface AiMatchResult {
  invoice_product: string;
  matched_code: string | null;
  matched_name: string | null;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Keyword search helpers
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'kg', 'g', 'gr', 'ml', 'l', 'lon', 'chai', 'goi', 'hop', 'bich', 'cai',
  'vi', 'bao', 'thung', 'loc', 'cay', 'gói', 'hộp', 'chai', 'bịch', 'cây',
  'túi', 'tui', 'hũ', 'hu', 'vỉ', 'vi', 'lốc', 'loc', 'thùng', 'thung',
]);

/**
 * Extract distinctive keywords from a product name for ILIKE search.
 * Strips numbers, UOM tokens, and short words.
 */
function extractSearchKeywords(name: string): string[] {
  return name
    .replace(/[0-9.,]+/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 3);
}

/**
 * Search product_cache for candidate products matching ANY keyword from
 * unresolved invoice items. Returns deduplicated results (max 200).
 */
async function searchCandidateProducts(
  deps: MappingDeps,
  tenantId: string,
  items: CanonicalItem[]
): Promise<{ code: string; name: string }[]> {
  const allKeywords = new Set<string>();
  for (const item of items) {
    for (const kw of extractSearchKeywords(item.product_name)) {
      allKeywords.add(kw);
    }
  }

  const kwArray = [...allKeywords];
  if (kwArray.length === 0) return [];

  // Build parameterized ILIKE conditions: $2, $3, ...
  const conditions = kwArray.map((_, i) => `product_name ILIKE $${i + 2}`);
  const params: unknown[] = [tenantId, ...kwArray.map((kw) => `%${kw}%`)];

  const rows = await deps.queryMany(`
    SELECT DISTINCT sku || '|' || product_name
    FROM product_cache
    WHERE tenant_id = $1::uuid AND active = true
      AND (${conditions.join(' OR ')})
    LIMIT 200;
  `, params);

  return rows
    .map((row) => {
      const [code, ...rest] = row.split('|');
      return { code: code ?? '', name: rest.join('|') };
    })
    .filter((p) => p.code.length > 0);
}

// ---------------------------------------------------------------------------
// OpenAI AI matching
// ---------------------------------------------------------------------------

async function aiMatchProducts(
  apiKey: string,
  model: string,
  unresolvedNames: string[],
  productCatalog: { code: string; name: string }[]
): Promise<AiMatchResult[]> {
  if (productCatalog.length === 0 || unresolvedNames.length === 0) return [];

  const catalogStr = productCatalog.map((p) => `${p.code}: ${p.name}`).join('\n');

  const prompt = `Bạn là hệ thống đối chiếu sản phẩm. So khớp tên sản phẩm từ hóa đơn với danh mục kho hàng.

DANH MỤC KHO (mã: tên):
${catalogStr}

SẢN PHẨM CẦN ĐỐI CHIẾU:
${unresolvedNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}

QUY TẮC:
- Match dựa trên tên sản phẩm, bỏ qua viết tắt, hoa thường, khoảng trắng
- VD: "BB nhân khoai môn" = "Bánh bao nhân khoai môn"
- VD: "LX Đông Phương 500gr" = "Lạp xưởng Đông Phương 500g"
- VD: "COCKTAIL 250gr" = "Xúc xích Cocktail 250g"
- Trả matched_code + matched_name cho MỌI sản phẩm bạn tìm được match, kể cả khi không chắc chắn
- confidence: 0-100 (phản ánh mức độ chắc chắn thực sự)

TRẢ VỀ JSON array:
[
  { "invoice_product": "tên từ hóa đơn", "matched_code": "mã kho hoặc null", "matched_name": "tên kho hoặc null", "confidence": 0-100 }
]`;

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
        { role: 'system', content: 'Trả về JSON object có key "matches" chứa array kết quả. Chỉ JSON, không text.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 2048
    }),
    signal: AbortSignal.timeout(30_000)
  });

  if (!response.ok) return [];

  const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = result.choices?.[0]?.message?.content;
  if (!content) return [];

  try {
    const parsed = JSON.parse(content) as { matches?: AiMatchResult[] } | AiMatchResult[];
    const matches = Array.isArray(parsed) ? parsed : (parsed.matches ?? []);
    return matches.filter((m) => m && typeof m.invoice_product === 'string');
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main MAP_RESOLVE processor
// ---------------------------------------------------------------------------

export async function processMapResolve(deps: MappingDeps, job: WorkerJobEnvelope): Promise<void> {
  if (!job.tenant_id) throw new Error('missing_tenant_id');
  if (!job.canonical_invoice_id) throw new Error('missing_canonical_invoice_id');

  if (!deps.mappingEnabled) {
    return;
  }

  // Fetch all canonical invoice items for this invoice
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
  let resolvedCount = 0;

  // -----------------------------------------------------------------------
  // Tier 1: Exact match from mapping_dictionary or verified SKU
  // -----------------------------------------------------------------------
  for (const item of canonicalItems) {
    let resolvedSku: string | null = null;

    // 1a. Check mapping_dictionary (aliases learned from previous AI matches)
    const aliasSku = await deps.queryOne(`
      SELECT target_sku
      FROM mapping_dictionary
      WHERE tenant_id = $1::uuid
        AND lower(alias_text) = lower($2)
      LIMIT 1;
    `, [job.tenant_id as string, item.product_name]);
    if (aliasSku.trim()) {
      resolvedSku = aliasSku.trim();
    }

    // 1b. If invoice has SKU, verify it exists in KiotViet product_cache
    if (!resolvedSku && item.sku) {
      const verified = await deps.queryOne(`
        SELECT sku FROM product_cache
        WHERE tenant_id = $1::uuid AND sku = $2 AND active = true
        LIMIT 1;
      `, [job.tenant_id as string, item.sku]);
      if (verified.trim()) {
        resolvedSku = verified.trim();
      }
      // If SKU not in product_cache, it's a supplier code — fall through to AI
    }

    if (!resolvedSku) {
      unresolved.push(item);
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
    resolvedCount += 1;
  }

  // -----------------------------------------------------------------------
  // Tier 2: AI matching with keyword-based catalog search
  // 3 confidence tiers: >=70 auto-resolve, 40-69 pending confirmation, <40 unresolved
  // -----------------------------------------------------------------------
  const pendingItems: CanonicalItem[] = [];
  const stillUnresolved: CanonicalItem[] = [];

  if (unresolved.length > 0 && deps.openaiApiKey) {
    const catalog = await searchCandidateProducts(deps, job.tenant_id, unresolved);

    if (catalog.length > 0) {
      const unresolvedNames = unresolved.map((u) => u.product_name);
      const matches = await aiMatchProducts(
        deps.openaiApiKey,
        deps.openaiModel ?? 'gpt-4o-mini',
        unresolvedNames,
        catalog
      );

      for (const item of unresolved) {
        const match = matches.find((m) =>
          m.invoice_product.toLowerCase() === item.product_name.toLowerCase() &&
          m.matched_code
        );

        if (match && match.matched_code && match.confidence >= 70) {
          // Tier 2a: High confidence — auto-resolve
          await deps.exec(`
            INSERT INTO mapping_dictionary (tenant_id, alias_text, target_sku, confidence)
            VALUES ($1::uuid, $2, $3, $4)
            ON CONFLICT (tenant_id, alias_text) DO UPDATE SET target_sku = EXCLUDED.target_sku, confidence = EXCLUDED.confidence;
          `, [job.tenant_id as string, item.product_name, match.matched_code, match.confidence]);

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
          `, [job.tenant_id as string, job.canonical_invoice_id as string, item.id, match.matched_code, item.uom ?? null, item.quantity]);
          resolvedCount += 1;

        } else if (match && match.matched_code && match.matched_name && match.confidence >= 40) {
          // Tier 2b: Medium confidence — pending confirmation via Telegram
          const chatId = job.telegram_chat_id;
          if (chatId) {
            await deps.exec(`
              INSERT INTO resolved_invoice_items (
                tenant_id, canonical_invoice_id, canonical_item_id, status, resolved_sku, resolved_unit, quantity
              ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'pending_confirmation', $4, $5, $6)
              ON CONFLICT (canonical_item_id) DO UPDATE SET
                status = 'pending_confirmation',
                resolved_sku = EXCLUDED.resolved_sku,
                resolved_unit = EXCLUDED.resolved_unit,
                quantity = EXCLUDED.quantity,
                unresolved_reason = NULL;
            `, [job.tenant_id as string, job.canonical_invoice_id as string, item.id, match.matched_code, item.uom ?? null, item.quantity]);

            // Send confirmation question directly via adapter (need message_id synchronously)
            const confirmText = `SP "${item.product_name}" co phai la "${match.matched_name}" (${match.matched_code}) khong?\nReply 1=Dung, 2=Sai, 3=Bo qua (KM)`;
            const sendResult = await deps.adapter.sendText(chatId, confirmText);

            await deps.exec(`
              INSERT INTO pending_confirmations (
                tenant_id, canonical_invoice_id, canonical_item_id,
                platform_user_id, telegram_chat_id, sent_message_id,
                invoice_product_name, suggested_sku, suggested_name, confidence
              ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10);
            `, [
              job.tenant_id as string, job.canonical_invoice_id as string, item.id,
              job.platform_user_id, chatId, sendResult.message_id,
              item.product_name, match.matched_code, match.matched_name, match.confidence
            ]);

            pendingItems.push(item);
          } else {
            stillUnresolved.push(item);
          }

        } else {
          // Tier 2c: Low confidence or no match — interactive question
          const chatIdC = job.telegram_chat_id;
          if (chatIdC) {
            await deps.exec(`
              INSERT INTO resolved_invoice_items (
                tenant_id, canonical_invoice_id, canonical_item_id, status, quantity, unresolved_reason
              ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'pending_confirmation', $4, 'mapping_not_found')
              ON CONFLICT (canonical_item_id) DO UPDATE SET status = 'pending_confirmation', unresolved_reason = 'mapping_not_found';
            `, [job.tenant_id as string, job.canonical_invoice_id as string, item.id, item.quantity]);

            const questionText = `SP "${item.product_name}" khong tim thay trong kho.\nReply 3=Bo qua (KM), hoac gui ma SKU de ghep thu cong.`;
            const sendResultC = await deps.adapter.sendText(chatIdC, questionText);

            await deps.exec(`
              INSERT INTO pending_confirmations (
                tenant_id, canonical_invoice_id, canonical_item_id,
                platform_user_id, telegram_chat_id, sent_message_id,
                invoice_product_name, suggested_sku, suggested_name, confidence
              ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10);
            `, [
              job.tenant_id as string, job.canonical_invoice_id as string, item.id,
              job.platform_user_id, chatIdC, sendResultC.message_id,
              item.product_name, '', '', 0
            ]);

            pendingItems.push(item);
          } else {
            stillUnresolved.push(item);
          }
        }
      }

      // Mark truly unresolved items
      for (const item of stillUnresolved) {
        await deps.exec(`
          INSERT INTO resolved_invoice_items (
            tenant_id, canonical_invoice_id, canonical_item_id, status, quantity, unresolved_reason
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'unresolved', $4, 'mapping_not_found')
          ON CONFLICT (canonical_item_id) DO UPDATE SET status = 'unresolved', unresolved_reason = 'mapping_not_found';
        `, [job.tenant_id as string, job.canonical_invoice_id as string, item.id, item.quantity]);
      }
    } else {
      // No product cache results — send interactive questions
      for (const item of unresolved) {
        const chatIdNpc = job.telegram_chat_id;
        if (chatIdNpc) {
          await deps.exec(`
            INSERT INTO resolved_invoice_items (
              tenant_id, canonical_invoice_id, canonical_item_id, status, quantity, unresolved_reason
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'pending_confirmation', $4, 'no_product_cache')
            ON CONFLICT (canonical_item_id) DO UPDATE SET status = 'pending_confirmation', unresolved_reason = 'no_product_cache';
          `, [job.tenant_id as string, job.canonical_invoice_id as string, item.id, item.quantity]);

          const questionText = `SP "${item.product_name}" khong tim thay trong kho.\nReply 3=Bo qua (KM), hoac gui ma SKU de ghep thu cong.`;
          const sendResultNpc = await deps.adapter.sendText(chatIdNpc, questionText);

          await deps.exec(`
            INSERT INTO pending_confirmations (
              tenant_id, canonical_invoice_id, canonical_item_id,
              platform_user_id, telegram_chat_id, sent_message_id,
              invoice_product_name, suggested_sku, suggested_name, confidence
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10);
          `, [
            job.tenant_id as string, job.canonical_invoice_id as string, item.id,
            job.platform_user_id, chatIdNpc, sendResultNpc.message_id,
            item.product_name, '', '', 0
          ]);

          pendingItems.push(item);
        } else {
          await deps.exec(`
            INSERT INTO resolved_invoice_items (
              tenant_id, canonical_invoice_id, canonical_item_id, status, quantity, unresolved_reason
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'unresolved', $4, 'no_product_cache')
            ON CONFLICT (canonical_item_id) DO UPDATE SET status = 'unresolved', unresolved_reason = 'no_product_cache';
          `, [job.tenant_id as string, job.canonical_invoice_id as string, item.id, item.quantity]);
          stillUnresolved.push(item);
        }
      }
    }
  } else if (unresolved.length > 0) {
    // No AI key — send interactive questions
    for (const item of unresolved) {
      const chatIdNoAi = job.telegram_chat_id;
      if (chatIdNoAi) {
        await deps.exec(`
          INSERT INTO resolved_invoice_items (
            tenant_id, canonical_invoice_id, canonical_item_id, status, quantity, unresolved_reason
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'pending_confirmation', $4, 'mapping_not_found')
          ON CONFLICT (canonical_item_id) DO UPDATE SET status = 'pending_confirmation', unresolved_reason = 'mapping_not_found';
        `, [job.tenant_id as string, job.canonical_invoice_id as string, item.id, item.quantity]);

        const questionText = `SP "${item.product_name}" khong tim thay trong kho.\nReply 3=Bo qua (KM), hoac gui ma SKU de ghep thu cong.`;
        const sendResultNoAi = await deps.adapter.sendText(chatIdNoAi, questionText);

        await deps.exec(`
          INSERT INTO pending_confirmations (
            tenant_id, canonical_invoice_id, canonical_item_id,
            platform_user_id, telegram_chat_id, sent_message_id,
            invoice_product_name, suggested_sku, suggested_name, confidence
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10);
        `, [
          job.tenant_id as string, job.canonical_invoice_id as string, item.id,
          job.platform_user_id, chatIdNoAi, sendResultNoAi.message_id,
          item.product_name, '', '', 0
        ]);

        pendingItems.push(item);
      } else {
        await deps.exec(`
          INSERT INTO resolved_invoice_items (
            tenant_id, canonical_invoice_id, canonical_item_id, status, quantity, unresolved_reason
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'unresolved', $4, 'mapping_not_found')
          ON CONFLICT (canonical_item_id) DO UPDATE SET status = 'unresolved', unresolved_reason = 'mapping_not_found';
        `, [job.tenant_id as string, job.canonical_invoice_id as string, item.id, item.quantity]);
        stillUnresolved.push(item);
      }
    }
  }

  // Audit log
  await deps.exec(`
    INSERT INTO audit_logs (tenant_id, actor_type, actor_id, event_type, resource_type, resource_id, payload)
    VALUES ($1::uuid, 'system', 'worker', 'mapping_resolve', 'canonical_invoices', $2, $3::jsonb);
  `, [job.tenant_id as string, job.canonical_invoice_id as string, JSON.stringify({
    total: canonicalItems.length,
    resolved: resolvedCount,
    pending_confirmation: pendingItems.length,
    unresolved: stillUnresolved.length
  })]);

  // -----------------------------------------------------------------------
  // Summary notification — tell user what happened
  // -----------------------------------------------------------------------
  const total = canonicalItems.length;
  const parts: string[] = [];
  if (resolvedCount > 0) parts.push(`${resolvedCount} SP da doi chieu`);
  if (pendingItems.length > 0) parts.push(`${pendingItems.length} SP cho xac nhan`);
  if (stillUnresolved.length > 0) {
    const names = stillUnresolved.map((u) => u.product_name).slice(0, 3).join(', ');
    parts.push(`${stillUnresolved.length} SP chua nhan dien (${names})`);
  }

  if (parts.length > 0) {
    let summary = `Hoa don ${total} SP: ${parts.join(', ')}.`;
    if (pendingItems.length > 0) {
      summary += ' Vui long tra loi cac cau hoi ben tren de xac nhan.';
    }

    const chatId = job.telegram_chat_id;
    if (deps.miniappEnabled && deps.miniappDomain && chatId) {
      // Send summary with Web App button
      const miniAppUrl = `https://${deps.miniappDomain}/?invoice=${job.canonical_invoice_id}`;
      await deps.adapter.sendMessageWithMarkup(chatId, summary, {
        inline_keyboard: [[{
          text: '\ud83d\udccb Xem hoa don',
          web_app: { url: miniAppUrl }
        }]]
      });
    } else {
      await deps.enqueue({
        job_type: 'NOTIFY_USER',
        notification_type: 'GENERIC_INFO',
        correlation_id: job.correlation_id,
        tenant_id: job.tenant_id,
        platform_user_id: job.platform_user_id,
        message_id: job.message_id,
        inbound_event_id: job.inbound_event_id,
        telegram_chat_id: job.telegram_chat_id,
        template_vars: { message: summary }
      });
    }
  }

  // Proceed to KiotViet sync only if items resolved AND nothing pending
  if (resolvedCount > 0 && pendingItems.length === 0) {
    await deps.enqueue({
      job_type: 'KIOTVIET_SYNC',
      tenant_id: job.tenant_id,
      canonical_invoice_id: job.canonical_invoice_id,
      correlation_id: job.correlation_id,
      platform_user_id: job.platform_user_id,
      message_id: job.message_id,
      inbound_event_id: job.inbound_event_id,
      telegram_chat_id: job.telegram_chat_id
    });
  }
}
