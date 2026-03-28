import type { WorkerJobEnvelope } from '../../../packages/common/dist/index.js';

export interface MappingDeps {
  readonly queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
  readonly queryMany: (sql: string, params?: readonly unknown[]) => Promise<string[]>;
  readonly exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  readonly enqueue: (payload: Record<string, unknown>) => Promise<void>;
  readonly mappingEnabled: boolean;
  readonly openaiApiKey?: string;
  readonly openaiModel?: string;
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
- Nếu không chắc chắn (< 70% confident), trả null
- confidence: 0-100

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

export async function processMapResolve(deps: MappingDeps, job: WorkerJobEnvelope): Promise<void> {
  if (!job.tenant_id) throw new Error('missing_tenant_id');
  if (!job.canonical_invoice_id) throw new Error('missing_canonical_invoice_id');

  if (!deps.mappingEnabled) {
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

  // Tier 1: Exact match from mapping_dictionary or verified SKU in product_cache
  for (const item of canonicalItems) {
    let resolvedSku: string | null = null;

    // First check mapping_dictionary (handles aliases from previous AI matches)
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

    // If no alias match but invoice has SKU, verify it exists in product_cache
    if (!resolvedSku && item.sku) {
      const verified = await deps.queryOne(`
        SELECT sku FROM product_cache
        WHERE tenant_id = $1::uuid AND sku = $2 AND active = true
        LIMIT 1;
      `, [job.tenant_id as string, item.sku]);
      if (verified.trim()) {
        resolvedSku = verified.trim();
      }
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
  }

  // Tier 2: AI matching against product_cache
  if (unresolved.length > 0 && deps.openaiApiKey) {
    const catalogRows = await deps.queryMany(`
      SELECT sku || '|' || product_name
      FROM product_cache
      WHERE tenant_id = $1::uuid AND active = true
      ORDER BY product_name ASC
      LIMIT 500;
    `, [job.tenant_id as string]);

    const catalog = catalogRows
      .map((row) => { const [code, ...rest] = row.split('|'); return { code: code ?? '', name: rest.join('|') }; })
      .filter((p) => p.code.length > 0);

    if (catalog.length > 0) {
      const unresolvedNames = unresolved.map((u) => u.product_name);
      const matches = await aiMatchProducts(
        deps.openaiApiKey,
        deps.openaiModel ?? 'gpt-4o-mini',
        unresolvedNames,
        catalog
      );

      const stillUnresolved: CanonicalItem[] = [];

      for (const item of unresolved) {
        const match = matches.find((m) =>
          m.invoice_product.toLowerCase() === item.product_name.toLowerCase() &&
          m.matched_code &&
          m.confidence >= 70
        );

        if (match && match.matched_code) {
          // Auto-insert into mapping_dictionary for future Tier 1 hits
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
        } else {
          stillUnresolved.push(item);
        }
      }

      // Mark remaining as unresolved
      for (const item of stillUnresolved) {
        await deps.exec(`
          INSERT INTO resolved_invoice_items (
            tenant_id, canonical_invoice_id, canonical_item_id, status, quantity, unresolved_reason
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'unresolved', $4, 'mapping_not_found')
          ON CONFLICT (canonical_item_id) DO UPDATE SET status = 'unresolved', unresolved_reason = 'mapping_not_found';
        `, [job.tenant_id as string, job.canonical_invoice_id as string, item.id, item.quantity]);
      }

      // Replace unresolved list
      unresolved.length = 0;
      unresolved.push(...stillUnresolved);
    } else {
      // No product cache — mark all as unresolved
      for (const item of unresolved) {
        await deps.exec(`
          INSERT INTO resolved_invoice_items (
            tenant_id, canonical_invoice_id, canonical_item_id, status, quantity, unresolved_reason
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'unresolved', $4, 'no_product_cache')
          ON CONFLICT (canonical_item_id) DO UPDATE SET status = 'unresolved', unresolved_reason = 'no_product_cache';
        `, [job.tenant_id as string, job.canonical_invoice_id as string, item.id, item.quantity]);
      }
    }
  } else if (unresolved.length > 0) {
    // No AI key — mark as unresolved
    for (const item of unresolved) {
      await deps.exec(`
        INSERT INTO resolved_invoice_items (
          tenant_id, canonical_invoice_id, canonical_item_id, status, quantity, unresolved_reason
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'unresolved', $4, 'mapping_not_found')
        ON CONFLICT (canonical_item_id) DO UPDATE SET status = 'unresolved', unresolved_reason = 'mapping_not_found';
      `, [job.tenant_id as string, job.canonical_invoice_id as string, item.id, item.quantity]);
    }
  }

  await deps.exec(`
    INSERT INTO audit_logs (tenant_id, actor_type, actor_id, event_type, resource_type, resource_id, payload)
    VALUES ($1::uuid, 'system', 'worker', 'mapping_resolve', 'canonical_invoices', $2, $3::jsonb);
  `, [job.tenant_id as string, job.canonical_invoice_id as string, JSON.stringify({ unresolved_count: unresolved.length })]);

  if (unresolved.length > 0) {
    await deps.enqueue({
      job_type: 'NOTIFY_USER',
      notification_type: 'GENERIC_INFO',
      correlation_id: job.correlation_id,
      tenant_id: job.tenant_id,
      platform_user_id: job.platform_user_id,
      message_id: job.message_id,
      telegram_chat_id: job.telegram_chat_id,
      template_vars: { message: `${unresolved.length} san pham chua the doi chieu voi kho KiotViet. Vui long kiem tra lai ma hang.` }
    });
    return;
  }

  await deps.enqueue({ ...job, job_type: 'KIOTVIET_SYNC' });
}
