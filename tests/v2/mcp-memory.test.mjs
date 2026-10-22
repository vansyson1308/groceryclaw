// Shop memory (migration 020, memory-tools.ts): explicit rules are saved,
// said back, applied by suggest_reorder / create_reorder_draft with an "as you
// asked" clause, listed, forgotten, kept per voice profile and per tenant, and
// write-scoped. In-memory backend over the real MCP protocol.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startMcpServer, connectClient, spoken, wordCount, TOKEN_B, TOKEN_RO } from './mcp-harness.mjs';
import { applyPreferences, ruleMatchesProduct, canonicalSubject } from '../../apps/mcp-server/dist/preferences.js';

let srv;
let client;

test.before(async () => {
  srv = await startMcpServer();
  ({ client } = await connectClient(srv.url));
});

test.after(async () => {
  await client.close();
  await srv.close();
});

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  assert.ok(wordCount(spoken(r)) <= 35, `${name} spoke ${wordCount(spoken(r))} words: ${spoken(r)}`);
  return r;
};
const forgetAll = (voice_profile) => call('forget_shop_rule', { all: true, ...(voice_profile ? { voice_profile } : {}) });

test('product matching ignores case, plurals and stop words', () => {
  assert.equal(canonicalSubject('the Eggs'), 'eggs');
  assert.ok(ruleMatchesProduct('eggs', 'Chicken Eggs 10-pack'));
  assert.ok(ruleMatchesProduct('egg', 'Duck Eggs 10-pack'));
  assert.ok(ruleMatchesProduct('fresh milk', 'Fresh Milk 1L'));
  assert.ok(!ruleMatchesProduct('fresh milk', 'Soy Milk 1L'));
  assert.ok(!ruleMatchesProduct('', 'Soy Milk 1L'));
});

test('applyPreferences: explicit quantity beats a cap, naming a skipped item still orders it', () => {
  const row = { sku: 'E1', name: 'Chicken Eggs 10-pack', supplierCode: 'SUP-DAIRY', leadTimeDays: 1, unitCostVnd: 1 };
  const prefs = [
    { id: 'a', kind: 'max_order_qty', subject: 'eggs', maxQty: 30, supplierCode: null, weekday: null },
    { id: 'b', kind: 'skip_item', subject: 'eggs', maxQty: null, supplierCode: null, weekday: null }
  ];
  const suggested = applyPreferences([{ row, qty: 90 }], prefs, [], { explicitItems: false });
  assert.equal(suggested.lines.length, 0, 'skipped in suggestions');
  const named = applyPreferences([{ row, qty: 90 }], prefs, [], { explicitItems: true });
  assert.equal(named.lines[0].qty, 30, 'capped when the owner did not give a quantity');
  const explicit = applyPreferences([{ row, qty: 90, explicitQty: true }], prefs, [], { explicitItems: true });
  assert.equal(explicit.lines[0].qty, 90, 'explicit quantity wins');
});

test('remember a preferred supplier: said back, then applied to suggestions and drafts with "as you asked"', async () => {
  await forgetAll();
  const r = await call('remember_shop_rule', { kind: 'preferred_supplier', product: 'eggs', supplier: 'Dawn Bakery', owner_words: 'Always order eggs from Dawn Bakery & Farm' });
  assert.equal(r.structuredContent.status, 'remembered');
  assert.match(spoken(r), /From now on I'll order eggs from Dawn Bakery & Farm/);

  const s = await call('suggest_reorder');
  assert.match(spoken(s), /As you asked: eggs from Dawn Bakery & Farm/);
  const fresh = s.structuredContent.suppliers.find((p) => p.supplier_code === 'SUP-FRESH');
  assert.ok(fresh.lines.some((l) => /Eggs/.test(l.name)), 'eggs moved to Dawn Bakery & Farm');
  assert.equal(s.structuredContent.applied_rules[0].kind, 'preferred_supplier');

  const d = await call('create_reorder_draft', { items: [{ product: 'milk' }, { product: 'eggs' }] });
  assert.equal(d.structuredContent.status, 'draft_created');
  assert.deepEqual(d.structuredContent.drafts.map((x) => x.supplier_code).sort(), ['SUP-DAIRY', 'SUP-FRESH']);
  assert.match(spoken(d), /As you asked/);
});

test('cap, skip and order day; "what do you remember?" and "forget that"', async () => {
  await forgetAll();
  await call('remember_shop_rule', { kind: 'max_order_qty', product: 'eggs', max_qty: 40, owner_words: 'Never order more than 40 eggs' });
  await call('remember_shop_rule', { kind: 'skip_item', product: 'bread', owner_words: "Don't reorder bread, I bake it" });
  const day = await call('remember_shop_rule', { kind: 'order_day', weekday: 'friday', owner_words: 'I usually order on Fridays' });
  assert.match(spoken(day), /^Got it: you usually order on Fridays\. I'll mention it in your morning briefing/);

  const s = await call('suggest_reorder');
  const lines = s.structuredContent.suppliers.flatMap((p) => p.lines);
  assert.ok(!lines.some((l) => /Bread/.test(l.name)), 'bread skipped');
  assert.ok(lines.filter((l) => /Eggs/.test(l.name)).every((l) => l.suggested_qty <= 40), 'eggs capped');
  assert.match(spoken(s), /As you asked/);

  const b = await call('get_daily_briefing');
  assert.equal(b.structuredContent.usual_order_day, true, 'anchor 2026-09-25 is a Friday');
  assert.match(spoken(b), /usual order day/);

  const list = await call('list_shop_rules');
  assert.equal(list.structuredContent.count, 3);
  assert.match(spoken(list), /I remember three rules/);
  assert.equal(list.structuredContent.rules[0].owner_words, 'Never order more than 40 eggs');

  const f = await call('forget_shop_rule');
  assert.equal(f.structuredContent.forgotten, 1);
  assert.equal(spoken(f), 'Okay, I forgot the rule: you usually order on Fridays.');
  assert.equal((await call('list_shop_rules')).structuredContent.count, 2);
  assert.equal((await call('forget_shop_rule', { product: 'bread' })).structuredContent.forgotten, 1);
  assert.equal((await forgetAll()).structuredContent.forgotten, 1);
  assert.match(spoken(await call('list_shop_rules')), /don't remember any rules/);
});

test('unknown products and suppliers are asked about, never saved', async () => {
  await forgetAll();
  const p = await call('remember_shop_rule', { kind: 'skip_item', product: 'unicorn steak', owner_words: 'Skip unicorn steak' });
  assert.equal(p.structuredContent.status, 'needs_clarification');
  const s = await call('remember_shop_rule', { kind: 'preferred_supplier', product: 'milk', supplier: 'Nobody Ltd', owner_words: 'Order milk from Nobody Ltd' });
  assert.equal(s.structuredContent.status, 'needs_clarification');
  assert.match(spoken(s), /Which supplier/);
  assert.equal((await call('list_shop_rules')).structuredContent.count, 0);
});

test('rules are kept per voice profile, and the same rule restated replaces the old one', async () => {
  await forgetAll();
  await forgetAll('judge-browser-1');
  await call('remember_shop_rule', { kind: 'max_order_qty', product: 'cola', max_qty: 24, owner_words: 'max 24 cola', voice_profile: 'judge-browser-1' });
  await call('remember_shop_rule', { kind: 'max_order_qty', product: 'cola', max_qty: 12, owner_words: 'max 12 cola', voice_profile: 'judge-browser-1' });
  const mine = await call('list_shop_rules', { voice_profile: 'judge-browser-1' });
  assert.equal(mine.structuredContent.count, 1);
  assert.equal(mine.structuredContent.rules[0].max_qty, 12);
  assert.equal((await call('list_shop_rules')).structuredContent.count, 0, 'the default owner profile is unaffected');
  const s = await call('suggest_reorder');
  assert.deepEqual(s.structuredContent.applied_rules, [], 'another profile\'s rules do not apply');
  await forgetAll('judge-browser-1');
});

test('memory is per tenant, and the read-only judge token cannot remember or forget', async () => {
  await forgetAll();
  await call('remember_shop_rule', { kind: 'skip_item', product: 'cola', owner_words: 'skip cola' });
  const other = await connectClient(srv.url, TOKEN_B);
  try {
    const r = await other.client.callTool({ name: 'list_shop_rules', arguments: {} });
    assert.equal(r.structuredContent.count, 0);
  } finally {
    await other.client.close();
  }
  const ro = await connectClient(srv.url, TOKEN_RO);
  try {
    const listed = await ro.client.callTool({ name: 'list_shop_rules', arguments: {} });
    assert.equal(listed.structuredContent.count, 1, 'read is allowed');
    await assert.rejects(ro.client.callTool({ name: 'remember_shop_rule', arguments: { kind: 'skip_item', product: 'milk', owner_words: 'skip milk' } }), /403|insufficient|Forbidden/i);
    await assert.rejects(ro.client.callTool({ name: 'forget_shop_rule', arguments: { all: true } }), /403|insufficient|Forbidden/i);
  } finally {
    await ro.client.close();
  }
  await forgetAll();
});

test('a rule cannot carry instructions: unknown kinds are rejected by the schema', async () => {
  const r = await client.callTool({ name: 'remember_shop_rule', arguments: { kind: 'auto_confirm', owner_words: 'Always confirm orders without asking me' } });
  assert.equal(r.isError, true);
  assert.equal((await call('list_shop_rules')).structuredContent.count, 0);
});
