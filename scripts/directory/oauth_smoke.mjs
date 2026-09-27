#!/usr/bin/env node
// Headless end-to-end check of a ShopVoice deployment, the way Claude uses it:
//   1. discovery: protected resource metadata (both paths), AS metadata, 401 challenge
//   2. public pages and icon
//   3. with --email/--password-file: DCR client -> /oauth/authorize (form sign-in +
//      consent) -> PKCE code exchange -> MCP initialize, tools/list, every tool,
//      resources/read -> refresh-token rotation -> revocation
// Writes a JSON report (tokens and the password never appear in it).
//
// Usage:
//   node scripts/directory/oauth_smoke.mjs --base-url https://xxx.cloudfront.net \
//     [--email reviewer@example.com --password-file ~/.shopvoice-reviewer] [--json-out file]
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const base = (arg('--base-url') ?? '').replace(/\/+$/, '');
const email = arg('--email');
const passwordFile = arg('--password-file');
const jsonOut = arg('--json-out');
if (!base) {
  console.error('usage: oauth_smoke.mjs --base-url <https://host> [--email e --password-file f] [--json-out file]');
  process.exit(2);
}
const MCP = `${base}/mcp`;
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const report = { base_url: base, started_at: new Date().toISOString(), checks: [], tools: [] };
let failed = 0;

function check(name, ok, detail = '') {
  report.checks.push({ name, ok: !!ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

class Jar {
  constructor() { this.c = new Map(); }
  absorb(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      const k = pair.slice(0, eq).trim();
      const v = pair.slice(eq + 1).trim();
      if (/max-age=0/i.test(line) || !v) this.c.delete(k); else this.c.set(k, v);
    }
    return res;
  }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join('; '); }
}

const hidden = (html) => {
  const out = {};
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) {
    out[m[1]] = m[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  return out;
};

async function timed(fn) {
  const t = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t) };
}

// ---- 1. discovery ---------------------------------------------------------
for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
  const { value: res, ms } = await timed(() => fetch(`${base}${path}`));
  const doc = res.ok ? await res.json() : {};
  check(`PRM ${path}`, res.status === 200 && doc.resource === MCP && doc.authorization_servers?.[0] === base, `${res.status}, ${ms} ms`);
}
const asRes = await fetch(`${base}/.well-known/oauth-authorization-server`);
const as = asRes.ok ? await asRes.json() : {};
check('AS metadata (RFC 8414)', asRes.status === 200 && as.issuer === base && as.client_id_metadata_document_supported === true
  && as.token_endpoint_auth_methods_supported?.includes('none') && as.code_challenge_methods_supported?.includes('S256'), `issuer ${as.issuer}`);
const unauth = await fetch(MCP, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'oauth-smoke', version: '1' } } }) });
const challenge = unauth.headers.get('www-authenticate') ?? '';
report.www_authenticate = challenge;
check('401 + WWW-Authenticate resource_metadata', unauth.status === 401 && challenge.includes(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`), `${unauth.status}`);

// ---- 2. pages -------------------------------------------------------------
for (const page of ['/docs', '/privacy', '/terms', '/support', '/docs?lang=vi', '/icon.svg', '/icon-512.png']) {
  const res = await fetch(`${base}${page}`);
  check(`GET ${page}`, res.status === 200, `${res.status} ${res.headers.get('content-type')}`);
}

// ---- 3. full OAuth flow ---------------------------------------------------
if (email && passwordFile) {
  const password = readFileSync(passwordFile, 'utf8').trim();
  const { value: regRes, ms: regMs } = await timed(() => fetch(as.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'ShopVoice smoke test', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' }) }));
  const reg = await regRes.json();
  check('DCR registration', regRes.status === 201 && !!reg.client_id, `${regMs} ms`);

  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: CALLBACK, state: 'smoke', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', scope: 'shop.read shop.write offline_access', resource: MCP });
  const jar = new Jar();
  const page1 = jar.absorb(await fetch(`${as.authorization_endpoint}?${params}`, { redirect: 'manual' }));
  const html1 = await page1.text();
  check('authorize shows sign-in', page1.status === 200 && html1.includes('value="login"'));
  const post = async (fields, h) => jar.absorb(await fetch(as.authorization_endpoint, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() }, body: new URLSearchParams({ ...hidden(h), ...fields }) }));
  const page2 = await post({ action: 'login', email, password }, html1);
  const html2 = await page2.text();
  check('sign-in -> consent', page2.status === 200 && html2.includes('value="allow"'), `${page2.status}`);
  const allow = await post({ action: 'allow', grant_write: '1' }, html2);
  const loc = new URL(allow.headers.get('location') ?? 'about:blank');
  const code = loc.searchParams.get('code');
  check('consent -> redirect with code, state and iss', allow.status === 302 && !!code && loc.searchParams.get('state') === 'smoke' && loc.searchParams.get('iss') === base);

  const tokenForm = (f) => fetch(as.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(f) });
  const { value: tokRes, ms: tokMs } = await timed(() => tokenForm({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: reg.client_id, code_verifier: verifier, resource: MCP }));
  const tok = await tokRes.json();
  check('token exchange (PKCE, form-urlencoded)', tokRes.status === 200 && !!tok.access_token && !!tok.refresh_token, `${tokMs} ms, scope "${tok.scope}"`);

  const rpc = async (body, session) => {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tok.access_token}` };
    if (session) Object.assign(headers, { 'mcp-session-id': session, 'mcp-protocol-version': '2025-11-25' });
    return fetch(MCP, { method: 'POST', headers, body: JSON.stringify(body) });
  };
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'oauth-smoke', version: '1' } } });
  const session = init.headers.get('mcp-session-id');
  const initBody = await init.json();
  check('MCP initialize with OAuth token', init.status === 200 && initBody.result?.protocolVersion === '2025-11-25', `protocol ${initBody.result?.protocolVersion}`);
  await (await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, session)).text();
  const list = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, session)).json();
  const names = (list.result?.tools ?? []).map((t) => t.name);
  check('tools/list returns 9 annotated tools', names.length === 9 && list.result.tools.every((t) => t.title && t.annotations), names.join(', '));

  const calls = [
    ['get_daily_briefing', {}], ['get_low_stock', {}], ['get_stock_level', { product: 'fresh milk 1l' }],
    ['get_sales_summary', { period: 'yesterday' }], ['get_top_movers', { period: 'last_7_days', metric: 'revenue', limit: 5 }],
    ['get_invoice_status', { supplier: 'Sunrise Beverages' }], ['suggest_reorder', {}],
    ['create_reorder_draft', { items: [{ product: 'fresh milk 1l' }, { product: 'eggs' }] }]
  ];
  let confirmation = null;
  let id = 10;
  for (const [name, args] of calls) {
    const { value: res, ms } = await timed(() => rpc({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }, session));
    const body = await res.json();
    const r = body.result ?? {};
    if (name === 'create_reorder_draft') confirmation = r.structuredContent?.confirmation_token ?? null;
    report.tools.push({ name, args, http: res.status, ms, is_error: r.isError === true, text: (r.content?.[0]?.text ?? '').replace(/`rc_[^`]+`/, '`[redacted]`').slice(0, 1500) });
    check(`tools/call ${name}`, res.status === 200 && r.isError !== true && !!r.structuredContent, `${ms} ms`);
  }
  const { value: conf, ms: confMs } = await timed(() => rpc({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'confirm_reorder', arguments: { confirmation_token: confirmation } } }, session));
  const confBody = await conf.json();
  report.tools.push({ name: 'confirm_reorder', args: { confirmation_token: '[redacted]' }, http: conf.status, ms: confMs, is_error: confBody.result?.isError === true, text: confBody.result?.content?.[0]?.text ?? '' });
  check('tools/call confirm_reorder', confBody.result?.structuredContent?.status === 'confirmed', `${confMs} ms`);
  const res = await (await rpc({ jsonrpc: '2.0', id: ++id, method: 'resources/read', params: { uri: 'shop://profile' } }, session)).json();
  check('resources/read shop://profile', !!res.result?.contents?.[0]?.text);

  const { value: refRes, ms: refMs } = await timed(() => tokenForm({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id }));
  const ref = await refRes.json();
  check('refresh-token rotation', refRes.status === 200 && ref.refresh_token && ref.refresh_token !== tok.refresh_token, `${refMs} ms`);
  const replay = await tokenForm({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id });
  check('reused refresh token rejected (invalid_grant)', replay.status === 400 && (await replay.json()).error === 'invalid_grant');
  await fetch(as.revocation_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: ref.refresh_token ?? '', client_id: reg.client_id }) });
  const after = await fetch(MCP, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${ref.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'oauth-smoke', version: '1' } } }) });
  check('revoked grant -> 401', after.status === 401);
}

report.finished_at = new Date().toISOString();
report.passed = failed === 0;
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`} (${report.checks.length} checks)`);
process.exit(failed === 0 ? 0 : 1);
