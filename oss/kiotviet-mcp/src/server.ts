import { createHash, randomBytes } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ProductRow, ShopSource, Snapshot } from './source.js';
import { shiftDate } from './source.js';
import { daysLeft, fitSpeech, formatMoney, formatQty, speakList } from './speech.js';

export interface ServerOptions {
  /** Supplier lead time used for reorder suggestions (days). */
  readonly leadTimeDays?: number;
  /** Extra days of cover to order on top of the lead time. */
  readonly coverDays?: number;
  /** Purchase-order confirmation window in seconds. */
  readonly confirmTtlSeconds?: number;
  readonly now?: () => number;
}

interface Draft {
  readonly lines: { sku: string; name: string; unit: string; qty: number; cost: number }[];
  readonly expiresAt: number;
  status: 'draft' | 'confirmed';
  code?: string;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

function avgDaily(s: Snapshot, sku: string, days = 14): number {
  let total = 0;
  for (let back = 1; back <= days; back += 1) total += s.sales.get(shiftDate(s.today, -back))?.get(sku)?.qty ?? 0;
  return total / days;
}

function cover(s: Snapshot, p: ProductRow): number | null {
  const a = avgDaily(s, p.sku);
  return a > 0 ? Math.round((p.onHand / a) * 10) / 10 : null;
}

function totals(s: Snapshot, from: string, to: string) {
  let qty = 0;
  let revenue = 0;
  for (const [date, day] of s.sales) {
    if (date < from || date > to) continue;
    for (const v of day.values()) {
      qty += v.qty;
      revenue += v.revenue;
    }
  }
  return { qty, revenue };
}

function match(products: readonly ProductRow[], query: string): ProductRow[] {
  const q = query.trim().toLowerCase();
  const exact = products.filter((p) => p.name.toLowerCase() === q || p.sku.toLowerCase() === q || p.barcode === query.trim());
  if (exact.length > 0) return exact;
  const words = q.split(/\s+/).filter((w) => w.length > 1).map((w) => (w.length > 3 ? w.replace(/s$/, '') : w));
  return products.filter((p) => words.every((w) => p.name.toLowerCase().includes(w)));
}

export function createKiotVietMcpServer(source: ShopSource, options: ServerOptions = {}): McpServer {
  const lead = options.leadTimeDays ?? 2;
  const extra = options.coverDays ?? 7;
  const ttl = options.confirmTtlSeconds ?? 300;
  const now = options.now ?? Date.now;
  const drafts = new Map<string, Draft>();
  const money = (v: number) => formatMoney(v, source.currency);

  const server = new McpServer(
    { name: 'kiotviet-mcp', version: '0.1.0' },
    { instructions: `Voice-first tools for ${source.shopName}. content[0].text is written to be spoken aloud (<= 35 words). Purchase orders are two-step: draft, read it back, confirm only after an explicit yes.` }
  );

  // Cover target x forecast - on hand; low items without recent sales refill to 2x the minimum.
  const suggestion = (s: Snapshot, p: ProductRow) => {
    const need = (lead + extra) * avgDaily(s, p.sku) - p.onHand;
    if (need > 0) return Math.ceil(need);
    return p.minQty > 0 && p.onHand <= p.minQty ? Math.max(0, p.minQty * 2 - p.onHand) : 0;
  };
  const lowList = (s: Snapshot) => s.products
    .filter((p) => p.minQty > 0 && p.onHand <= p.minQty)
    .sort((a, b) => (cover(s, a) ?? Infinity) - (cover(s, b) ?? Infinity));

  server.registerTool('get_low_stock', {
    title: 'What is running low',
    description: 'Products at or below their KiotViet minimum stock (minQuantity), most urgent first by days of cover.',
    inputSchema: {},
    outputSchema: { total_low: z.number(), items: z.array(z.object({ sku: z.string(), name: z.string(), unit: z.string(), on_hand: z.number(), min_qty: z.number(), days_of_cover: z.number().nullable() })) },
    annotations: READ_ONLY
  }, async () => {
    const s = await source.loadSnapshot();
    const low = lowList(s);
    const items = low.map((p) => ({ sku: p.sku, name: p.name, unit: p.unit, on_hand: p.onHand, min_qty: p.minQty, days_of_cover: cover(s, p) }));
    const lead2 = `${low.length} ${low.length === 1 ? 'item is' : 'items are'} running low`;
    const text = low.length === 0 ? 'Nothing is below its minimum stock right now.' : fitSpeech([
      `${lead2}: ${speakList(low.map((p) => `${p.name}, ${formatQty(p.onHand, p.unit)}, ${daysLeft(cover(s, p))}`))}.`,
      `${lead2}: ${speakList(low.map((p) => `${p.name}, ${daysLeft(cover(s, p))}`))}.`,
      `${lead2}, most urgently ${low[0]?.name}.`
    ]);
    return { content: [{ type: 'text', text }], structuredContent: { total_low: low.length, items } };
  });

  server.registerTool('get_stock_level', {
    title: 'Stock level for one product',
    description: 'On-hand quantity and days of cover for a product by name, product code or barcode. Asks which one if several match.',
    inputSchema: { product: z.string().trim().min(2).max(80) },
    outputSchema: { status: z.enum(['found', 'ambiguous', 'not_found']), matches: z.array(z.object({ sku: z.string(), name: z.string(), on_hand: z.number(), days_of_cover: z.number().nullable() })) },
    annotations: READ_ONLY
  }, async ({ product }) => {
    const s = await source.loadSnapshot();
    const found = match(s.products, product);
    const matches = found.slice(0, 5).map((p) => ({ sku: p.sku, name: p.name, on_hand: p.onHand, days_of_cover: cover(s, p) }));
    const first = found[0];
    if (!first) return { content: [{ type: 'text', text: `I couldn't find "${product}".` }], structuredContent: { status: 'not_found' as const, matches } };
    if (found.length > 1) {
      return { content: [{ type: 'text', text: fitSpeech([`Which one: ${speakList(found.map((p) => p.name)).replace(/; and /, ' or ')}?`]) }], structuredContent: { status: 'ambiguous' as const, matches } };
    }
    return { content: [{ type: 'text', text: `You have ${formatQty(first.onHand, first.unit)} of ${first.name}, ${daysLeft(cover(s, first))}.` }], structuredContent: { status: 'found' as const, matches } };
  });

  server.registerTool('get_sales_summary', {
    title: 'Sales summary',
    description: 'Revenue and units for today, yesterday, the last 7 days or the last 28 days, compared with the previous equal period (same weekday last week for single days).',
    inputSchema: { period: z.enum(['today', 'yesterday', 'last_7_days', 'last_28_days']).default('today') },
    outputSchema: { period: z.string(), from: z.string(), to: z.string(), revenue: z.number(), units: z.number(), previous_revenue: z.number(), change_pct: z.number().nullable() },
    annotations: READ_ONLY
  }, async ({ period }) => {
    const s = await source.loadSnapshot();
    const span = { today: [0, 0], yesterday: [1, 1], last_7_days: [7, 1], last_28_days: [28, 1] }[period] as [number, number];
    const from = shiftDate(s.today, -span[0]);
    const to = shiftDate(s.today, -span[1]);
    const shift = span[0] === span[1] ? 7 : span[0] - span[1] + 1;
    const cur = totals(s, from, to);
    const prev = totals(s, shiftDate(from, -shift), shiftDate(to, -shift));
    const pct = prev.revenue > 0 ? Math.round(((cur.revenue - prev.revenue) / prev.revenue) * 100) : null;
    const label = { today: 'So far today', yesterday: 'Yesterday', last_7_days: 'The last 7 days', last_28_days: 'The last 28 days' }[period];
    const change = pct === null ? '' : pct === 0 ? ', level with the previous period' : `, ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% on the previous period`;
    return {
      content: [{ type: 'text', text: `${label}: ${money(cur.revenue)} from ${formatQty(cur.qty, 'item')}${change}.` }],
      structuredContent: { period, from, to, revenue: cur.revenue, units: cur.qty, previous_revenue: prev.revenue, change_pct: pct }
    };
  });

  server.registerTool('get_top_movers', {
    title: 'Best and slowest sellers',
    description: 'Top or bottom products by units sold over the last N days.',
    inputSchema: { days: z.number().int().min(1).max(28).default(7), direction: z.enum(['top', 'bottom']).default('top'), limit: z.number().int().min(1).max(10).default(3) },
    outputSchema: { items: z.array(z.object({ sku: z.string(), name: z.string(), units: z.number(), revenue: z.number() })) },
    annotations: READ_ONLY
  }, async ({ days, direction, limit }) => {
    const s = await source.loadSnapshot();
    const from = shiftDate(s.today, -days);
    const to = shiftDate(s.today, -1);
    const rows = s.products.map((p) => {
      let units = 0;
      let revenue = 0;
      for (const [date, day] of s.sales) {
        if (date < from || date > to) continue;
        units += day.get(p.sku)?.qty ?? 0;
        revenue += day.get(p.sku)?.revenue ?? 0;
      }
      return { sku: p.sku, name: p.name, unit: p.unit, units, revenue };
    }).sort((a, b) => (direction === 'top' ? b.units - a.units : a.units - b.units)).slice(0, limit);
    const text = fitSpeech([`${direction === 'top' ? 'Top sellers' : 'Slowest sellers'} over the last ${days} days: ${speakList(rows.map((r) => `${r.name}, ${formatQty(r.units, r.unit)}`))}.`]);
    return { content: [{ type: 'text', text }], structuredContent: { items: rows.map(({ unit: _unit, ...r }) => r) } };
  });

  server.registerTool('suggest_reorder', {
    title: 'Suggest a reorder',
    description: `What to reorder now: items at/below minimum. Quantity = (lead time ${lead} + ${extra} days) x 14-day average daily sales - on hand. Read-only.`,
    inputSchema: {},
    outputSchema: { lines: z.array(z.object({ sku: z.string(), name: z.string(), unit: z.string(), qty: z.number(), est_cost: z.number() })), est_total: z.number() },
    annotations: READ_ONLY
  }, async () => {
    const s = await source.loadSnapshot();
    const lines = lowList(s).map((p) => ({ sku: p.sku, name: p.name, unit: p.unit, qty: suggestion(s, p), est_cost: suggestion(s, p) * p.cost })).filter((l) => l.qty > 0);
    const total = lines.reduce((n, l) => n + l.est_cost, 0);
    const text = lines.length === 0 ? 'Nothing needs reordering right now.' : fitSpeech([
      `I'd reorder ${speakList(lines.map((l) => `${formatQty(l.qty, l.unit)} of ${l.name}`))}, about ${money(total)}. Shall I draft it?`,
      `I'd reorder ${lines.length} items, about ${money(total)}. Shall I draft it?`
    ]);
    return { content: [{ type: 'text', text }], structuredContent: { lines, est_total: total } };
  });

  if (source.createPurchaseOrder) {
    const place = source.createPurchaseOrder;
    server.registerTool('create_purchase_order_draft', {
      title: 'Draft a purchase order (step 1 of 2)',
      description: 'Drafts a KiotViet purchase order from the current suggestions (or the given product codes) and returns a confirmation_token valid for 5 minutes. Nothing is sent to KiotViet until confirm_purchase_order is called after the user says yes.',
      inputSchema: { items: z.array(z.object({ sku: z.string(), qty: z.number().positive().max(100000) })).max(50).optional() },
      outputSchema: { confirmation_token: z.string().nullable(), expires_in_seconds: z.number(), lines: z.array(z.object({ sku: z.string(), name: z.string(), qty: z.number() })), est_total: z.number() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    }, async ({ items }) => {
      const s = await source.loadSnapshot();
      const bySku = new Map(s.products.map((p) => [p.sku, p]));
      const lines = (items ?? lowList(s).map((p) => ({ sku: p.sku, qty: suggestion(s, p) })))
        .map((i) => ({ p: bySku.get(i.sku), qty: Math.ceil(i.qty) }))
        .filter((l): l is { p: ProductRow; qty: number } => l.p !== undefined && l.qty > 0)
        .map(({ p, qty }) => ({ sku: p.sku, name: p.name, unit: p.unit, qty, cost: p.cost }));
      if (lines.length === 0) {
        return { content: [{ type: 'text', text: 'There is nothing to order, so I did not draft anything.' }], structuredContent: { confirmation_token: null, expires_in_seconds: 0, lines: [], est_total: 0 } };
      }
      const token = `po_${randomBytes(12).toString('base64url')}`;
      drafts.set(hash(token), { lines, expiresAt: now() + ttl * 1000, status: 'draft' });
      const total = lines.reduce((n, l) => n + l.qty * l.cost, 0);
      const text = fitSpeech([
        `Draft ready: ${speakList(lines.map((l) => `${formatQty(l.qty, l.unit)} of ${l.name}`))}, about ${money(total)}. Say confirm within ${Math.round(ttl / 60)} minutes to send it.`,
        `Draft ready: ${lines.length} items, about ${money(total)}. Say confirm within ${Math.round(ttl / 60)} minutes to send it.`
      ]);
      return { content: [{ type: 'text', text }], structuredContent: { confirmation_token: token, expires_in_seconds: ttl, lines: lines.map(({ sku, name, qty }) => ({ sku, name, qty })), est_total: total } };
    });

    server.registerTool('confirm_purchase_order', {
      title: 'Send the purchase order (step 2 of 2)',
      description: 'Sends the drafted purchase order to KiotViet (POST /purchaseorders). Requires the confirmation_token from create_purchase_order_draft; expires after 5 minutes. Call only after the user explicitly confirms.',
      inputSchema: { confirmation_token: z.string().min(8).max(64) },
      outputSchema: { status: z.enum(['sent', 'already_sent', 'expired', 'not_found']), kiotviet_code: z.string().nullable() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    }, async ({ confirmation_token }) => {
      const draft = drafts.get(hash(confirmation_token));
      if (!draft) return { content: [{ type: 'text', text: "I couldn't find that draft." }], structuredContent: { status: 'not_found' as const, kiotviet_code: null } };
      if (draft.status === 'confirmed') return { content: [{ type: 'text', text: `Already sent as ${draft.code}.` }], structuredContent: { status: 'already_sent' as const, kiotviet_code: draft.code ?? null } };
      if (draft.expiresAt <= now()) return { content: [{ type: 'text', text: 'That draft expired, so nothing was sent. Want a fresh one?' }], structuredContent: { status: 'expired' as const, kiotviet_code: null } };
      const { code } = await place(draft.lines.map((l) => ({ productCode: l.sku, quantity: l.qty, price: l.cost })), 'Created by voice via kiotviet-mcp');
      draft.status = 'confirmed';
      draft.code = code;
      return { content: [{ type: 'text', text: `Done. Purchase order ${code} is in KiotViet.` }], structuredContent: { status: 'sent' as const, kiotviet_code: code } };
    });
  }

  server.registerResource('shop-profile', 'shop://profile', { title: 'Shop profile', mimeType: 'application/json' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ shop_name: source.shopName, currency: source.currency, timezone: source.timezone }) }]
  }));

  return server;
}
