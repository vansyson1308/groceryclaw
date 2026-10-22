// "Brain" = the model that plans tool calls. The history is Converse-shaped
// ({text}, {toolUse}, {toolResult}) so the agent loop is identical for Claude
// (claude-brain.ts, Anthropic API), the offline rules brain used in tests and
// as the per-turn fallback, and the Bedrock brain below.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { ContentBlock, Message, Tool } from '@aws-sdk/client-bedrock-runtime';

export type TextBlock = { text: string };
export type ToolUseBlock = { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } };
export type ToolResultBlock = {
  toolResult: {
    toolUseId: string;
    content: ({ json: Record<string, unknown> } | { text: string })[];
    status?: 'success' | 'error';
  };
};
export type Block = TextBlock | ToolUseBlock | ToolResultBlock | Record<string, unknown>;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface BrainUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface BrainResponse {
  content: Block[];
  stopReason: 'tool_use' | 'end_turn' | 'max_tokens' | 'other';
  latencyMs: number;
  /** Token usage and its estimated cost, for brains that bill (Claude). */
  usage?: BrainUsage;
  costUsd?: number;
}

export interface BrainCallOptions {
  /** Time left in the turn's deadline; the brain aborts its call after this. */
  readonly timeoutMs?: number;
}

export interface Brain {
  readonly kind: 'claude' | 'bedrock' | 'rules';
  readonly model: string;
  converse(input: { system: string; messages: ChatMessage[]; tools: ToolSpec[] }, opts?: BrainCallOptions): Promise<BrainResponse>;
}

export function isToolUse(block: Block): block is ToolUseBlock {
  return typeof block === 'object' && block !== null && 'toolUse' in block;
}

export function isText(block: Block): block is TextBlock {
  return typeof block === 'object' && block !== null && 'text' in block && typeof (block as TextBlock).text === 'string';
}

// Implemented, not deployed: AWS account unavailable. This Bedrock Converse
// brain (SIM_BRAIN=bedrock) has never run against a live AWS account; it is
// kept for a future AWS deployment and is not part of the demo path.
export class BedrockBrain implements Brain {
  readonly kind = 'bedrock' as const;
  private readonly client: BedrockRuntimeClient;

  constructor(readonly model: string, region: string, private readonly maxTokens = 512) {
    this.client = new BedrockRuntimeClient({ region });
  }

  async converse(input: { system: string; messages: ChatMessage[]; tools: ToolSpec[] }): Promise<BrainResponse> {
    const started = performance.now();
    const tools: Tool[] = input.tools.map((t) => ({
      toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema as never } }
    }));
    const out = await this.client.send(new ConverseCommand({
      modelId: this.model,
      system: [{ text: input.system }],
      messages: input.messages as unknown as Message[],
      toolConfig: { tools },
      inferenceConfig: { maxTokens: this.maxTokens, temperature: 0 }
    }));
    const content = (out.output?.message?.content ?? []) as ContentBlock[];
    const stop = out.stopReason;
    return {
      content: content as unknown as Block[],
      stopReason: stop === 'tool_use' ? 'tool_use' : stop === 'end_turn' ? 'end_turn' : stop === 'max_tokens' ? 'max_tokens' : 'other',
      latencyMs: performance.now() - started
    };
  }
}

// ---------------------------------------------------------------------------
// Offline rules brain: deterministic intent rules for CI, for demos without an
// Anthropic API key, and as the per-turn fallback when Claude errors, times
// out or the spend cap is reached. It only ever emits the same tool calls a
// model would, and then speaks the tool's own spoken text.
// ---------------------------------------------------------------------------

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const AFFIRMATIVE = /\b(yes|yeah|yep|yup|confirm|confirmed|go ahead|place (it|them|the orders?)|do it|sure|ok(ay)?|please do)\b/i;
export const NEGATIVE = /\b(no|nope|don't|do not|cancel|stop|wait|never ?mind)\b/i;

/** Questions are never a yes ("Can you confirm what's in the draft?"). */
const QUESTION = /\?\s*$|^\s*(why|what|how|when|where|who|which|whose|did|does|do you|can|could|is|are|was|were|should|would|will)\b/i;

// Vietnamese: "\b" does not work around letters with diacritics, so match on spaces and edges.
const VI = (alternatives: string) => new RegExp(`(?:^|[\\s,.!])(?:${alternatives})(?=$|[\\s,.!?])`, 'iu');
const AFFIRMATIVE_VI = VI('có|vâng|dạ|ừ|ừm|đồng ý|xác nhận|được|đặt đi|làm đi|ok');
const NEGATIVE_VI = VI('không|ko|hủy|huỷ|đừng|khoan|thôi|chưa');
/** Vietnamese questions end in a question particle ("… không?", "… chưa?") or use a question word. */
const QUESTION_VI = /(?:\s(?:không|chưa|à|hả|nhỉ)\s*\??\s*$)|(?:^|\s)(?:gì|bao nhiêu|nào|sao|ai|đâu|mấy|khi nào)(?=$|[\s?,.!])/iu;

export function isVietnamese(text: string): boolean {
  return /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹáàãéèíìóòõúùýđ]/iu.test(text);
}

export function isAffirmative(text: string): boolean {
  if (isVietnamese(text)) {
    return !/\?\s*$/.test(text) && !QUESTION_VI.test(text) && AFFIRMATIVE_VI.test(text) && !NEGATIVE_VI.test(text);
  }
  return !QUESTION.test(text) && AFFIRMATIVE.test(text) && !NEGATIVE.test(text);
}

function isNegative(text: string): boolean {
  return isVietnamese(text) ? NEGATIVE_VI.test(text) && !AFFIRMATIVE_VI.test(text.replace(NEGATIVE_VI, ' ')) : NEGATIVE.test(text) && !AFFIRMATIVE.test(text);
}

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    const text = m.content.filter(isText).map((b) => b.text).join(' ');
    if (text) return text;
  }
  return '';
}

function cleanProduct(phrase: string): string {
  return phrase
    .replace(/\b(some|more|a few|a couple of|please|for me|the|a|an|of|now|today|from .*|my usual supplier|usual supplier)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function periodFrom(text: string): string {
  if (/\byesterday\b/i.test(text)) return 'yesterday';
  if (/\blast week\b/i.test(text)) return 'last_week';
  if (/\bthis week\b/i.test(text)) return 'this_week';
  if (/\b(last|past) (7|seven) days\b/i.test(text)) return 'last_7_days';
  if (/\b(last|past) (30|thirty) days|this month\b/i.test(text)) return 'last_30_days';
  return 'today';
}

/** Maps an utterance to a tool call (name + args) the way a tool-use model would. */
export function planToolCall(text: string): { name: string; input: Record<string, unknown> } | null {
  return planToolCalls(text)[0] ?? null;
}

const WEEKDAYS_VI: Record<string, string> = { 'thứ hai': 'monday', 'thứ ba': 'tuesday', 'thứ tư': 'wednesday', 'thứ năm': 'thursday', 'thứ sáu': 'friday', 'thứ bảy': 'saturday', 'chủ nhật': 'sunday' };

/** Shop memory: only explicit standing rules ("always", "never more than", "don't reorder", "I usually order on"). */
export function planMemoryCall(text: string): { name: string; input: Record<string, unknown> } | null {
  const t = text.toLowerCase().trim().replace(/[.!]+$/, '');
  const words = text.trim();
  if (/\b(what do you remember|what rules|what have you remembered)\b/.test(t) || /bạn nhớ (gì|những gì)/u.test(t)) return { name: 'list_shop_rules', input: {} };
  const forget = /^(?:please\s+)?forget\s+(that|it|this|everything|all( of it| rules)?|(?:the rules? (?:about|for)\s+)?(.+))$/.exec(t);
  if (forget) {
    if (/^(everything|all)/.test(forget[1] ?? '')) return { name: 'forget_shop_rule', input: { all: true } };
    const product = forget[2] ? cleanProduct(forget[2]) : '';
    return { name: 'forget_shop_rule', input: product && !/^(that|it|this)$/.test(product) ? { product } : {} };
  }
  if (/^quên (cái đó|điều đó|đi)/u.test(t)) return { name: 'forget_shop_rule', input: {} };
  const preferred = /\balways (?:order|buy|get|reorder)\s+(?:the\s+)?(.+?)\s+from\s+(.+)$/.exec(t) ?? /luôn (?:đặt|mua)\s+(.+?)\s+(?:từ|của|ở)\s+(.+)$/u.exec(t);
  if (preferred?.[1] && preferred[2]) return { name: 'remember_shop_rule', input: { kind: 'preferred_supplier', product: cleanProduct(preferred[1]), supplier: preferred[2].trim(), owner_words: words } };
  const cap = /\bnever (?:order|buy) more than (\d+)\s+(.+)$/.exec(t) ?? /không (?:bao giờ )?đặt quá (\d+)\s+(.+)$/u.exec(t);
  if (cap?.[1] && cap[2]) return { name: 'remember_shop_rule', input: { kind: 'max_order_qty', product: cleanProduct(cap[2]), max_qty: Number(cap[1]), owner_words: words } };
  const skip = /^(?:please\s+)?(?:don't|do not|never|stop)\s+(?:re-?order(?:ing)?|order(?:ing)?|restock(?:ing)?)\s+(?:the\s+)?(.+?)(?:\s+(?:any ?more|again))?$/.exec(t);
  if (skip?.[1]) return { name: 'remember_shop_rule', input: { kind: 'skip_item', product: cleanProduct(skip[1]), owner_words: words } };
  const day = /\b(?:i|we)\s+(?:usually|always|normally)\s+order\s+on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/.exec(t);
  if (day?.[1]) return { name: 'remember_shop_rule', input: { kind: 'order_day', weekday: day[1], owner_words: words } };
  const dayVi = /(?:thường|hay) đặt hàng (?:vào )?(thứ hai|thứ ba|thứ tư|thứ năm|thứ sáu|thứ bảy|chủ nhật)/u.exec(t);
  if (dayVi?.[1]) return { name: 'remember_shop_rule', input: { kind: 'order_day', weekday: WEEKDAYS_VI[dayVi[1]], owner_words: words } };
  return null;
}

/** Vietnamese intents mapped to the same tools (spoken answers in Vietnamese need the Claude brain). */
function planVietnamese(t: string): { name: string; input: Record<string, unknown> }[] {
  if (/chào buổi sáng|tình hình (cửa hàng|tiệm|quán)|hôm nay thế nào/u.test(t)) return [{ name: 'get_daily_briefing', input: {} }, { name: 'suggest_reorder', input: {} }];
  if (/sắp hết|hết hàng|còn ít/u.test(t)) return [{ name: 'get_low_stock', input: {} }];
  if (/hóa đơn|hoá đơn/u.test(t)) return [{ name: 'get_invoice_status', input: {} }];
  if (/nên đặt (gì|những gì)|cần đặt (gì|thêm gì)/u.test(t)) return [{ name: 'suggest_reorder', input: {} }];
  const order = /(?:đặt|nhập)(?: thêm)? (.+)$/u.exec(t);
  if (order?.[1]) {
    const map: Record<string, string> = { 'sữa': 'milk', 'trứng': 'eggs', 'bánh mì': 'bread', 'nước ngọt': 'cola', 'cô ca': 'cola', 'coca': 'cola' };
    const items = order[1].split(/\s*(?:,|\svà\s)\s*/u).map((p) => map[p.trim()] ?? p.trim()).filter((p) => p.length >= 2).map((product) => ({ product }));
    if (items.length > 0) return [{ name: 'create_reorder_draft', input: { items } }];
  }
  if (/doanh (thu|số)|bán được/u.test(t)) {
    const input: Record<string, unknown> = { period: /hôm qua/u.test(t) ? 'yesterday' : /tuần trước/u.test(t) ? 'last_week' : 'today' };
    const vi = Object.keys(WEEKDAYS_VI).find((d) => t.includes(`${d} tuần trước`) || t.includes(`${d} trước`));
    if (vi) input.compare_weekday = WEEKDAYS_VI[vi];
    return [{ name: 'get_sales_summary', input }];
  }
  return [];
}

/** Maps an utterance to the tool calls a tool-use model would make (several for the morning check). */
export function planToolCalls(text: string): { name: string; input: Record<string, unknown> }[] {
  const t = text.toLowerCase().trim();
  if (!t) return [];
  if (isAffirmative(t) && t.split(/\s+/).length <= 6) return [{ name: 'confirm_reorder', input: { confirmation_token: 'held-by-host' } }];
  const memory = planMemoryCall(text);
  if (memory) return [memory];
  if (isVietnamese(t)) return planVietnamese(t);
  if (/\b(good morning|how('s| is) the shop( doing)?|morning check)\b/.test(t)) return [{ name: 'get_daily_briefing', input: {} }, { name: 'suggest_reorder', input: {} }];
  return planEnglish(t);
}

function planEnglish(t: string): { name: string; input: Record<string, unknown> }[] {
  const one = planEnglishOne(t);
  return one ? [one] : [];
}

function planEnglishOne(t: string): { name: string; input: Record<string, unknown> } | null {
  if (/\b(briefing|morning summary)\b/.test(t)) return { name: 'get_daily_briefing', input: {} };
  if (/\b(running low|low on|what'?s low|out of stock|low stock)\b/.test(t)) return { name: 'get_low_stock', input: {} };
  if (/\b(invoice|delivery|bill)\b/.test(t)) {
    const m = /(?:the|from)\s+(.+?)\s+(?:invoice|delivery|bill)/.exec(t) ?? /(?:invoice|delivery|bill)\s+from\s+(.+?)(?:\s+(?:arrive|come|get).*)?[?.!]*$/.exec(t);
    const supplier = m?.[1]?.replace(/\b(the|a)\b/g, '').trim();
    return { name: 'get_invoice_status', input: supplier ? { supplier } : {} };
  }
  if (/\b(what should i (re)?order|suggest|need to reorder)\b/.test(t)) return { name: 'suggest_reorder', input: {} };
  const reorder = /\b(?:re-?order|order|restock|buy)\s+(.+?)[?.!]*$/.exec(t);
  if (reorder?.[1]) {
    const items = reorder[1].split(/\s*(?:,|\band\b|&)\s*/).map(cleanProduct).filter((p) => p.length >= 2).map((product) => ({ product }));
    return { name: 'create_reorder_draft', input: items.length > 0 ? { items } : {} };
  }
  if (/\b(top|best|slow(est)?|worst)\b.*\b(sell|seller|product|mover|item)/.test(t)) {
    return { name: 'get_top_movers', input: { period: periodFrom(t) === 'today' && !/\btoday\b/.test(t) ? 'last_7_days' : periodFrom(t), direction: /\b(slow|worst)/.test(t) ? 'bottom' : 'top', metric: /\b(revenue|money|dollars?)\b/.test(t) ? 'revenue' : 'units' } };
  }
  if (/\b(sales|sell|sold|revenue|how did we do|how were we|takings)\b/.test(t)) {
    const input: Record<string, unknown> = { period: periodFrom(t) };
    const weekday = WEEKDAYS.find((d) => new RegExp(`\\b(last|previous)\\s+${d}\\b`).test(t));
    if (weekday) input.compare_weekday = weekday;
    return { name: 'get_sales_summary', input };
  }
  const stock = /\b(?:how many|how much|do we have|stock of|stock level for|left of)\s+(.+?)(?:\s+(?:do we have|left|in stock|are there|is there))?[?.!]*$/.exec(t);
  if (stock?.[1]) {
    const product = cleanProduct(stock[1].replace(/\b(do we have|left|in stock)\b/g, ''));
    if (product.length >= 2) return { name: 'get_stock_level', input: { product } };
  }
  return null;
}

interface ToolEvent {
  readonly name: string;
  readonly text: string;
  readonly json: Record<string, unknown> | null;
}

/** Tool calls and their results in this conversation, oldest first. */
function toolHistory(messages: ChatMessage[]): ToolEvent[] {
  const names = new Map<string, string>();
  const out: ToolEvent[] = [];
  for (const m of messages) {
    for (const b of m.content) {
      if (isToolUse(b)) names.set(b.toolUse.toolUseId, b.toolUse.name);
      else if (typeof b === 'object' && b !== null && 'toolResult' in b) {
        const r = (b as ToolResultBlock).toolResult;
        const text = r.content.filter((c): c is { text: string } => 'text' in c).map((c) => c.text).join(' ');
        const json = r.content.find((c): c is { json: Record<string, unknown> } => 'json' in c)?.json ?? null;
        out.push({ name: names.get(r.toolUseId) ?? '', text, json: r.status === 'error' ? null : json });
      }
    }
  }
  return out;
}

interface PlanSupplier { supplier_name: string; supplier_code: string; total: number }

/** Suppliers of the latest reorder plan that have not been drafted since. */
function remainingPlanSuppliers(history: ToolEvent[]): { suppliers: PlanSupplier[]; currency: string } {
  let planAt = -1;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.name === 'suggest_reorder' && Array.isArray(history[i]?.json?.suppliers)) { planAt = i; break; }
  }
  if (planAt < 0) return { suppliers: [], currency: 'USD' };
  const plan = history[planAt]?.json ?? {};
  const drafted = new Set(history.slice(planAt + 1)
    .filter((e) => e.name === 'create_reorder_draft' && e.json?.status === 'draft_created')
    .flatMap((e) => (Array.isArray(e.json?.drafts) ? e.json.drafts as { supplier_code?: string }[] : []).map((d) => d.supplier_code)));
  const suppliers = (plan.suppliers as PlanSupplier[]).filter((p) => !drafted.has(p.supplier_code));
  return { suppliers, currency: String(plan.currency ?? 'USD') };
}

function money(total: number, currency: string): string {
  return currency === 'USD' ? `$${Math.round(total)}` : `${Math.round(total).toLocaleString('en-US')} ${currency}`;
}

function sentences(text: string): string[] {
  return text.match(/[^.?!]+[.?!]+/g)?.map((x) => x.trim()) ?? (text.trim() ? [text.trim()] : []);
}

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Keeps the last sentence (the question) and drops earlier ones from the end until it fits. */
function fitWords(parts: string[], max = 35): string {
  const out = [...parts];
  while (out.length > 1 && wordCount(out.join(' ')) > max) out.splice(out.length - 2, 1);
  return out.join(' ');
}

export class RulesBrain implements Brain {
  readonly kind = 'rules' as const;
  readonly model = 'offline-rules-v1';
  private counter = 0;

  async converse(input: { system: string; messages: ChatMessage[]; tools: ToolSpec[] }): Promise<BrainResponse> {
    const started = performance.now();
    const done = (text: string): BrainResponse => ({ content: [{ text }], stopReason: 'end_turn', latencyMs: performance.now() - started });
    const last = input.messages[input.messages.length - 1];
    const results = last?.role === 'user' ? last.content.filter((b): b is ToolResultBlock => typeof b === 'object' && b !== null && 'toolResult' in b) : [];
    if (results.length > 0) return done(this.speakResults(input.messages, results.length));
    const text = lastUserText(input.messages);
    const history = toolHistory(input.messages);
    let plans = planToolCalls(text);
    if (isAffirmative(text) && plans[0]?.name === 'confirm_reorder') {
      // "Yes" right after a plan (or after confirming one supplier of it) means: draft the next supplier.
      const lastEvent = history[history.length - 1];
      const remaining = remainingPlanSuppliers(history).suppliers;
      if (lastEvent && (lastEvent.name === 'suggest_reorder' || lastEvent.name === 'confirm_reorder') && remaining[0]) {
        plans = [{ name: 'create_reorder_draft', input: { supplier: remaining[0].supplier_name } }];
      }
    } else if (isNegative(text) && plans.every((p) => p.name !== 'remember_shop_rule')) {
      return done("Okay, I won't place that order.");
    }
    plans = plans.filter((p) => input.tools.some((t) => t.name === p.name));
    if (plans.length === 0) {
      return done('I can check stock, sales, supplier invoices, draft reorders, and remember your rules. What would you like to know?');
    }
    return {
      content: plans.map((p) => {
        this.counter += 1;
        return { toolUse: { toolUseId: `rules-${this.counter}`, name: p.name, input: p.input } };
      }),
      stopReason: 'tool_use',
      latencyMs: performance.now() - started
    };
  }

  /** Speak the tools' own spoken text (content[0].text), as instructed for the real model. */
  private speakResults(messages: ChatMessage[], count: number): string {
    const history = toolHistory(messages);
    const latest = history.slice(-count);
    const briefing = latest.find((e) => e.name === 'get_daily_briefing');
    const plan = latest.find((e) => e.name === 'suggest_reorder');
    const { suppliers, currency } = remainingPlanSuppliers(history);
    if (briefing && plan) {
      const [s1 = '', s2 = ''] = sentences(briefing.text);
      const items = Number(plan.json?.item_count ?? 0);
      const first = suppliers[0];
      if (items === 0 || !first) return fitWords([s1, s2, 'Nothing needs reordering today.'].filter(Boolean));
      const all = (plan.json?.suppliers as PlanSupplier[] | undefined) ?? suppliers;
      const total = money(Number(plan.json?.total ?? 0), currency);
      const proposal = `I'd reorder ${items} ${items === 1 ? 'item' : 'items'} from ${all.length} ${all.length === 1 ? 'supplier' : 'suppliers'}, about ${total}.`;
      const asked = sentences(plan.text).find((x) => x.startsWith('As you asked')) ?? '';
      const ask = `Shall I draft ${first.supplier_name} first, about ${money(first.total, currency)}?`;
      const shortAsk = `Draft ${first.supplier_name} first?`;
      // Most to least detailed; the plan, the remembered rule and the question always stay.
      const candidates = [
        [s1, s2, proposal, asked, ask], [s1, proposal, asked, ask], [s1, proposal, asked, shortAsk],
        [proposal, asked, ask], [proposal, asked, shortAsk], [proposal, shortAsk]
      ]
        .map((parts) => parts.filter(Boolean).join(' '));
      return candidates.find((c) => wordCount(c) <= 35) ?? candidates[candidates.length - 1] ?? proposal;
    }
    const spoken = latest.map((e) => e.text).join(' ');
    const confirmed = latest.find((e) => e.name === 'confirm_reorder' && e.json?.status === 'confirmed');
    if (confirmed && suppliers[0]) {
      return fitWords([spoken, `Next: ${suppliers[0].supplier_name}, about ${money(suppliers[0].total, currency)}. Draft it?`]);
    }
    return spoken;
  }
}
