#!/usr/bin/env node
// Screenshots of the public pages and the OAuth sign-in / consent / account
// screens, from an in-process ShopVoice server (memory backend, no network).
// Usage: npm run build && node scripts/directory/screenshot_pages.mjs [outDir]
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createMcpHttpHandler } from '../../apps/mcp-server/dist/http.js';
import { loadMcpServerConfig } from '../../apps/mcp-server/dist/config.js';
import { MemoryShopStore } from '../../apps/mcp-server/dist/memory-store.js';
import { MemoryOAuthStore } from '../../apps/mcp-server/dist/oauth/store.js';
import { buildDemoDataset, buildSandboxTenantData, SANDBOX_PROFILES } from '../v2/gen_demo_seed.mjs';

const out = process.argv[2] ?? 'docs/directory/evidence/pages';
mkdirSync(out, { recursive: true });
const shop = new MemoryShopStore(buildDemoDataset({ tokens: {} }));
const oauthStore = new MemoryOAuthStore({
  provision: (tenantId, locale) => { shop.addTenant(tenantId, buildSandboxTenantData(locale)); return SANDBOX_PROFILES[locale].shop_name; },
  remove: (tenantId) => shop.removeTenant(tenantId)
});
const server = createServer((req, res) => { void handler.handle(req, res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://localhost:${server.address().port}`;
const config = loadMcpServerConfig({
  MCP_DATA_BACKEND: 'memory', PUBLIC_BASE_URL: base, OAUTH_COOKIE_SECRET: randomBytes(32).toString('hex'),
  SUPPORT_EMAIL: process.env.SUPPORT_EMAIL ?? 'support@example.com'
});
const handler = createMcpHttpHandler({ store: shop, config, logger: { debug() {}, info() {}, warn() {}, error() {} }, oauth: { store: oauthStore } });

const reg = await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }) })).json();
const challenge = createHash('sha256').update(randomBytes(32).toString('base64url')).digest('base64url');
const authorize = `${base}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: challenge, code_challenge_method: 'S256', state: 'demo', scope: 'shop.read shop.write offline_access' })}`;

const browser = await chromium.launch();
for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, colorScheme: 'light' });
  const page = await ctx.newPage();
  for (const p of ['docs', 'privacy', 'terms', 'support', 'docs?lang=vi']) {
    await page.goto(`${base}/${p}`);
    await page.screenshot({ path: `${out}/${label}-${p.replace('?lang=', '-')}.png`, fullPage: label === 'desktop' && p === 'docs' });
  }
  await page.goto(authorize);
  await page.screenshot({ path: `${out}/${label}-signin.png`, fullPage: true });
  await page.fill('#su-email', `${label}@example.com`);
  await page.fill('#su-pw', 'correct horse battery');
  await page.fill('#su-pw2', 'correct horse battery');
  await page.check('input[name=accept_terms]');
  await page.click('button[value=signup]');
  await page.screenshot({ path: `${out}/${label}-consent.png`, fullPage: true });
  await page.goto(`${base}/account`);
  await page.screenshot({ path: `${out}/${label}-account.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
server.close();
console.log(`screenshots in ${out}`);
