import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { KiotVietClient, KiotVietSource, DemoSource, createKiotVietMcpServer, countWords } from '../dist/index.js';

async function connect(source, options) {
  const server = createKiotVietMcpServer(source, options);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(b);
  return client;
}

/** Fake KiotViet API: token endpoint + paged /products + /invoices + /purchaseorders. */
function fakeKiotViet({ today }) {
  const calls = [];
  const products = Array.from({ length: 130 }, (_, i) => ({
    id: i + 1, code: `SP${String(i + 1).padStart(3, '0')}`, name: i === 0 ? 'Fresh Milk 1L' : `Item ${i + 1}`, unit: i === 0 ? 'carton' : 'pack',
    basePrice: 10000, isActive: true, inventories: [{ branchId: 1, onHand: i === 0 ? 5 : 100, reserved: 0, cost: 8000, minQuantity: i === 0 ? 20 : 10 }]
  }));
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, method: init.method ?? 'GET', headers: init.headers ?? {}, query: Object.fromEntries(u.searchParams) });
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u.hostname === 'id.kiotviet.vn') return json({ access_token: 'tok-123', expires_in: 3600 });
    if (u.pathname === '/products') {
      const start = Number(u.searchParams.get('currentItem'));
      return json({ total: products.length, data: products.slice(start, start + 100) });
    }
    if (u.pathname === '/invoices') {
      return json({ total: 1, data: [{ id: 1, code: 'HD1', purchaseDate: `${today}T03:00:00Z`, status: 1, invoiceDetails: [{ productCode: 'SP001', quantity: 14, price: 32000, subTotal: 448000 }] }] });
    }
    if (u.pathname === '/purchaseorders' && init.method === 'POST') return json({ id: 99, code: 'PN000099' });
    return json({}, 404);
  };
  return { calls, fetchImpl };
}

test('KiotVietClient: token exchange once, Retailer header, pagination with includeInventory', async () => {
  const fake = fakeKiotViet({ today: '2026-09-25' });
  const client = new KiotVietClient({ clientId: 'id', clientSecret: 'secret', retailer: 'myshop', fetch: fake.fetchImpl });
  const products = await client.listProducts();
  assert.equal(products.length, 130);
  const tokenCalls = fake.calls.filter((c) => c.path === '/connect/token');
  assert.equal(tokenCalls.length, 1, 'token cached across pages');
  const pages = fake.calls.filter((c) => c.path === '/products');
  assert.deepEqual(pages.map((p) => p.query.currentItem), ['0', '100']);
  assert.equal(pages[0].query.includeInventory, 'true');
  assert.equal(pages[0].headers.retailer, 'myshop');
  assert.equal(pages[0].headers.authorization, 'Bearer tok-123');
});

test('demo source: every tool answers in <= 35 spoken words', async () => {
  const client = await connect(new DemoSource('2026-09-25'));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['confirm_purchase_order', 'create_purchase_order_draft', 'get_low_stock', 'get_sales_summary', 'get_stock_level', 'get_top_movers', 'suggest_reorder']);
  for (const [name, args] of [['get_low_stock', {}], ['get_stock_level', { product: 'milk' }], ['get_sales_summary', { period: 'yesterday' }], ['get_top_movers', {}], ['suggest_reorder', {}]]) {
    const r = await client.callTool({ name, arguments: args });
    assert.ok(!r.isError, `${name}: ${r.content[0].text}`);
    assert.ok(countWords(r.content[0].text) <= 35, `${name}: ${r.content[0].text}`);
    assert.ok(r.structuredContent);
  }
  const low = await client.callTool({ name: 'get_low_stock', arguments: {} });
  assert.deepEqual(low.structuredContent.items.map((i) => i.sku).sort(), ['SP001', 'SP002', 'SP005']);
});

test('two-step purchase order: nothing is sent to KiotViet before confirm; token expires', async () => {
  let now = Date.parse('2026-09-25T09:00:00Z');
  const fake = fakeKiotViet({ today: '2026-09-25' });
  const kv = new KiotVietClient({ clientId: 'id', clientSecret: 'secret', retailer: 'myshop', fetch: fake.fetchImpl });
  const client = await connect(new KiotVietSource(kv, 'Test Shop'), { now: () => now });
  const draft = await client.callTool({ name: 'create_purchase_order_draft', arguments: {} });
  const token = draft.structuredContent.confirmation_token;
  assert.match(token, /^po_/);
  assert.deepEqual(draft.structuredContent.lines.map((l) => l.sku), ['SP001']);
  assert.equal(fake.calls.filter((c) => c.path === '/purchaseorders').length, 0, 'draft does not call KiotViet');

  const sent = await client.callTool({ name: 'confirm_purchase_order', arguments: { confirmation_token: token } });
  assert.equal(sent.structuredContent.status, 'sent');
  assert.equal(sent.structuredContent.kiotviet_code, 'PN000099');
  assert.equal(fake.calls.filter((c) => c.path === '/purchaseorders').length, 1);
  const again = await client.callTool({ name: 'confirm_purchase_order', arguments: { confirmation_token: token } });
  assert.equal(again.structuredContent.status, 'already_sent');
  assert.equal(fake.calls.filter((c) => c.path === '/purchaseorders').length, 1, 'idempotent');

  const second = await client.callTool({ name: 'create_purchase_order_draft', arguments: { items: [{ sku: 'SP002', qty: 10 }] } });
  now += 301_000;
  const late = await client.callTool({ name: 'confirm_purchase_order', arguments: { confirmation_token: second.structuredContent.confirmation_token } });
  assert.equal(late.structuredContent.status, 'expired');
});

test('read-only mode does not expose purchase-order tools', async () => {
  const fake = fakeKiotViet({ today: '2026-09-25' });
  const kv = new KiotVietClient({ clientId: 'id', clientSecret: 'secret', retailer: 'myshop', fetch: fake.fetchImpl });
  const client = await connect(new KiotVietSource(kv, 'Test Shop', 'Asia/Ho_Chi_Minh', 'VND', 60, true));
  const { tools } = await client.listTools();
  assert.ok(!tools.some((t) => t.name.includes('purchase_order')));
});
