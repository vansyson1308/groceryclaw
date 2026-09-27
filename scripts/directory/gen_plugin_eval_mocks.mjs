#!/usr/bin/env node
// Writes plugins/shopvoice/evals/mocks/shopvoice/*: one mock per ShopVoice tool,
// with the exact chat-profile output the real server gives for the demo shop
// on a fixed date, plus _tools.json (the real tools/list) so eval runs see the
// real tool names, descriptions and schemas. Re-run after changing tools.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createShopVoiceServer } from '../../apps/mcp-server/dist/mcp.js';
import { MemoryShopStore } from '../../apps/mcp-server/dist/memory-store.js';
import { buildSandboxTenantData } from '../v2/gen_demo_seed.mjs';

const OUT = 'plugins/shopvoice/evals/mocks/shopvoice';
const TOKEN = 'rc_EVALTOKEN12345';
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const store = new MemoryShopStore({ tenants: { eval: buildSandboxTenantData('en', '2026-09-25') }, tokens: {} });
const server = createShopVoiceServer({ store, tenantId: 'eval', logger, confirmTtlSeconds: 300, profile: 'chat' });
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(b);
const client = new Client({ name: 'mock-gen', version: '1' });
await client.connect(a);
mkdirSync(OUT, { recursive: true });

const list = await client.listTools();
writeFileSync(`${OUT}/_tools.json`, `${JSON.stringify(list, null, 2)}\n`);

const calls = {
  get_daily_briefing: {},
  get_low_stock: {},
  get_stock_level: { product: 'fresh milk 1l' },
  get_sales_summary: { period: 'yesterday' },
  get_top_movers: { period: 'last_7_days', metric: 'revenue', direction: 'bottom', limit: 5 },
  get_invoice_status: {},
  suggest_reorder: { supplier: 'Green Valley Dairy & Eggs' },
  create_reorder_draft: { items: [{ product: 'fresh milk 1l' }, { product: 'eggs' }] }
};
const header = (expect) => (expect ? `---\nexpect:\n${expect}\n---\n\n` : '');
for (const [name, args] of Object.entries(calls)) {
  const res = await client.callTool({ name, arguments: args });
  let text = res.content[0].text;
  if (name === 'create_reorder_draft') {
    text = text.replace(/`rc_[^`]+`/, `\`${TOKEN}\``).replace(/\(expires [^)]+\)/, '(expires in 5 minutes)');
  }
  writeFileSync(`${OUT}/${name}.md`, `${header(null)}${text}\n`);
}
const confirm = await (async () => {
  const draft = await client.callTool({ name: 'create_reorder_draft', arguments: calls.create_reorder_draft });
  return client.callTool({ name: 'confirm_reorder', arguments: { confirmation_token: draft.structuredContent.confirmation_token } });
})();
writeFileSync(`${OUT}/confirm_reorder.md`, `${header(`  confirmation_token: "${TOKEN}"`)}${confirm.content[0].text}\n`);
await client.close();
console.log(`wrote ${Object.keys(calls).length + 2} files to ${OUT}`);
