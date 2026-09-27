#!/usr/bin/env node
// MCP Inspector (v2.8.0) OAuth evidence: the Inspector discovers ShopVoice's
// authorization server from the 401 challenge, registers itself (DCR), sends
// the browser to ShopVoice's sign-in page; the script signs in with the given
// account, approves the consent screen, and captures the connected Inspector,
// its tool list and a tool result. Screenshots + a JSON step log go to --out-dir.
//
// Usage: node scripts/directory/inspector_oauth_evidence.mjs --server-url https://host/mcp \
//          --email reviewer@example.com --password-file <file> [--label deployed] [--out-dir docs/directory/evidence]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const INSPECTOR = '@modelcontextprotocol/inspector@2.8.0';
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const serverUrl = arg('--server-url');
const email = arg('--email');
const passwordFile = arg('--password-file');
const label = arg('--label', 'local');
const outDir = arg('--out-dir', 'docs/directory/evidence');
if (!serverUrl || !email || !passwordFile) {
  console.error('usage: inspector_oauth_evidence.mjs --server-url <url>/mcp --email <e> --password-file <f> [--label x]');
  process.exit(2);
}
const password = readFileSync(passwordFile, 'utf8').trim();
mkdirSync(outDir, { recursive: true });
const steps = [];
const step = (name, detail = {}) => {
  steps.push({ name, at: new Date().toISOString(), ...detail });
  console.log(`- ${name}`);
};

const web = spawn('npx', ['-y', INSPECTOR, '--web', '--transport', 'http', '--server-url', serverUrl], {
  env: { ...process.env, MCP_AUTO_OPEN_ENABLED: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true
});
let uiUrl = '';
web.stdout.on('data', (chunk) => {
  const m = /http:\/\/127\.0\.0\.1:6274\?MCP_INSPECTOR_API_TOKEN=[a-f0-9]+/.exec(String(chunk));
  if (m) uiUrl = m[0];
});
for (let i = 0; i < 120 && !uiUrl; i += 1) await sleep(500);
if (!uiUrl) throw new Error('inspector web UI did not start');

const browser = await chromium.launch();
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(uiUrl);
  await page.waitForTimeout(1500);
  step('inspector started without any token', { server_url: serverUrl });
  await page.locator('.mantine-Switch-track').first().click();
  await page.waitForURL((u) => u.pathname.endsWith('/oauth/authorize'), { timeout: 30_000 });
  const authUrl = new URL(page.url());
  step('401 -> discovery -> DCR -> redirected to ShopVoice sign-in', {
    authorize_host: authUrl.host,
    client_id_prefix: (authUrl.searchParams.get('client_id') ?? '').slice(0, 4),
    redirect_uri: authUrl.searchParams.get('redirect_uri'),
    code_challenge_method: authUrl.searchParams.get('code_challenge_method'),
    scope: authUrl.searchParams.get('scope'),
    resource: authUrl.searchParams.get('resource')
  });
  await page.screenshot({ path: `${outDir}/inspector-oauth-${label}-1-signin.png`, fullPage: true });
  await page.fill('#li-email', email);
  await page.fill('#li-pw', password);
  await page.click('button[value=login]');
  await page.waitForSelector('button[value=allow]', { timeout: 15_000 });
  await page.screenshot({ path: `${outDir}/inspector-oauth-${label}-2-consent.png`, fullPage: true });
  step('signed in; consent screen shows app, redirect host, shop and scopes');
  await page.click('button[value=allow]');
  await page.getByText('Connected', { exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/inspector-oauth-${label}-3-connected.png` });
  step('code exchanged; Inspector connected with the OAuth access token');
  await page.getByText('Tools', { exact: true }).first().click();
  await page.waitForTimeout(1000);
  await page.getByText('get_low_stock', { exact: true }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/inspector-oauth-${label}-4-tools.png` });
  await page.getByRole('button', { name: 'Execute Tool' }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}/inspector-oauth-${label}-5-tool-result.png` });
  step('tools/list and tools/call get_low_stock over OAuth');
  ok = true;
} finally {
  await browser.close();
  try {
    process.kill(-(web.pid ?? 0), 'SIGTERM');
  } catch {
    web.kill('SIGTERM');
  }
  writeFileSync(`${outDir}/inspector-oauth-${label}.json`, `${JSON.stringify({ inspector: INSPECTOR, server_url: serverUrl, account: email, passed: ok, steps }, null, 2)}\n`);
}
console.log(ok ? `Inspector OAuth evidence saved to ${outDir}` : 'Inspector OAuth flow FAILED');
process.exit(ok ? 0 : 1);
