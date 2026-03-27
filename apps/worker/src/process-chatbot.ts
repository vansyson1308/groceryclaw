import type { WorkerJobEnvelope } from '../../../packages/common/dist/index.js';

export interface ChatbotDeps {
  readonly queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
  readonly queryMany: (sql: string, params?: readonly unknown[]) => Promise<string[]>;
  readonly exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
  readonly enqueue: (payload: Record<string, unknown>) => Promise<void>;
  readonly chatbotEnabled: boolean;
  readonly openaiApiKey: string;
  readonly openaiModel: string;
  readonly maxContextProducts: number;
  readonly timeoutMs: number;
}

async function queryProductContext(deps: ChatbotDeps, tenantId: string, userQuestion: string): Promise<string> {
  // Try to find relevant products from kiotviet_product_cache (global, no RLS)
  // Use simple ILIKE search based on keywords from the user question
  const keywords = userQuestion
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 5);

  let products: string[] = [];

  if (keywords.length > 0) {
    const likeConditions = keywords.map((_, i) => `product_name ILIKE $${i + 1}`).join(' OR ');
    const likeParams = keywords.map((k) => `%${k}%`);

    try {
      const rows = await deps.queryMany(`
        SELECT json_build_object(
          'name', product_name,
          'code', product_code,
          'price', base_price,
          'cost', cost,
          'stock', inventory_quantity,
          'category', category_name,
          'barcode', barcode
        )::text
        FROM kiotviet_product_cache
        WHERE is_active = true AND (${likeConditions})
        ORDER BY product_name ASC
        LIMIT ${deps.maxContextProducts};
      `, likeParams);
      products = rows;
    } catch {
      // Table may not exist yet if n8n sync hasn't run
    }
  }

  // If no keyword matches, get a sample of products
  if (products.length === 0) {
    try {
      const rows = await deps.queryMany(`
        SELECT json_build_object(
          'name', product_name,
          'code', product_code,
          'price', base_price,
          'cost', cost,
          'stock', inventory_quantity,
          'category', category_name
        )::text
        FROM kiotviet_product_cache
        WHERE is_active = true
        ORDER BY product_name ASC
        LIMIT ${deps.maxContextProducts};
      `, []);
      products = rows;
    } catch {
      // Fall through to tenant-scoped product_cache
    }
  }

  // Also try tenant-scoped product_cache
  if (products.length === 0) {
    try {
      const rows = await deps.queryMany(`
        SELECT json_build_object(
          'name', product_name,
          'code', sku,
          'barcode', barcode
        )::text
        FROM product_cache
        WHERE tenant_id = $1::uuid AND active = true
        ORDER BY product_name ASC
        LIMIT $2;
      `, [tenantId, deps.maxContextProducts]);
      products = rows;
    } catch {
      // No product data available
    }
  }

  if (products.length === 0) {
    return 'Chưa có dữ liệu sản phẩm trong hệ thống.';
  }

  return `Danh sách sản phẩm hiện có (${products.length} sản phẩm):\n${products.join('\n')}`;
}

async function callOpenAiChat(apiKey: string, model: string, userQuestion: string, productContext: string, timeoutMs: number): Promise<string> {
  const systemPrompt = `Bạn là trợ lý ảo của cửa hàng tạp hóa. Nhiệm vụ của bạn:
- Trả lời câu hỏi về sản phẩm, giá cả, tồn kho dựa trên dữ liệu được cung cấp
- Luôn trả lời bằng tiếng Việt, ngắn gọn, thân thiện
- Nếu không có thông tin, nói rõ "Tôi không tìm thấy thông tin về sản phẩm này"
- Giá tiền hiển thị dạng VND (ví dụ: 25.000đ)
- Không bịa thông tin, chỉ dùng dữ liệu được cung cấp
- Trả lời tối đa 400 ký tự

Dữ liệu sản phẩm:
${productContext}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userQuestion }
      ],
      max_tokens: 512,
      temperature: 0.3
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

  return content.trim();
}

export async function processChatbotReply(deps: ChatbotDeps, job: WorkerJobEnvelope): Promise<void> {
  if (!job.tenant_id) {
    throw new Error('invalid_job_payload');
  }

  const userQuestion = job.message_text?.trim();
  if (!userQuestion) {
    return; // No text to process
  }

  if (!deps.chatbotEnabled) {
    await deps.enqueue({
      job_type: 'NOTIFY_USER', notification_type: 'GENERIC_INFO',
      template_vars: { message: 'Tính năng trả lời tự động chưa được bật.' },
      correlation_id: job.correlation_id, platform_user_id: job.platform_user_id,
      message_id: job.message_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id
    });
    return;
  }

  if (!deps.openaiApiKey) {
    await deps.enqueue({
      job_type: 'NOTIFY_USER', notification_type: 'PROCESSING_FAILED',
      correlation_id: job.correlation_id, platform_user_id: job.platform_user_id,
      message_id: job.message_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id
    });
    return;
  }

  try {
    const productContext = await queryProductContext(deps, job.tenant_id, userQuestion);
    const reply = await callOpenAiChat(deps.openaiApiKey, deps.openaiModel, userQuestion, productContext, deps.timeoutMs);

    await deps.enqueue({
      job_type: 'NOTIFY_USER', notification_type: 'GENERIC_INFO',
      template_vars: { message: reply },
      correlation_id: job.correlation_id, platform_user_id: job.platform_user_id,
      message_id: job.message_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id
    });
  } catch (error) {
    await deps.enqueue({
      job_type: 'NOTIFY_USER', notification_type: 'PROCESSING_FAILED',
      correlation_id: job.correlation_id, platform_user_id: job.platform_user_id,
      message_id: job.message_id, tenant_id: job.tenant_id, inbound_event_id: job.inbound_event_id
    });
    throw (error instanceof Error ? error : new Error('chatbot_failed'));
  }
}
