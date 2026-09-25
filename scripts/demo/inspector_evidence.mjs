#!/usr/bin/env node
// Protocol-conformance evidence with the official MCP Inspector (v2.8.0):
// launches the Inspector web UI against a ShopVoice MCP URL, connects,
// and saves screenshots (connected + negotiated protocol, tools list,
// tool result) plus CLI JSON (tools/list, tools/call, resources/read,
// prompts/get) into docs/hackathon/evidence/.
//
// Usage: node scripts/demo/inspector_evidence.mjs --server-url https://xxx.cloudfront.net/mcp --token <bearer> [--label deployed]
// Requires: npx access to @modelcontextprotocol/inspector@2.8.0 and Playwright's Chromium.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const INSPECTOR = '@modelcontextprotocol/inspector@2.8.0';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const serverUrl = arg('--server-url');
const token = arg('--token', process.env.MCP_DEMO_TOKEN);
const label = arg('--label', 'local');
const outDir = arg('--out-dir', 'docs/hackathon/evidence');
if (!serverUrl || !token) {
  console.error('usage: inspector_evidence.mjs --server-url <url>/mcp --token <bearer> [--label deployed]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const header = `Authorization: Bearer ${token}`;
const redact = (text) => text.split(token).join('[redacted]');

// 1) CLI evidence (JSON).
const cli = (file, ...args) => {
  const out = execFileSync('npx', ['-y', INSPECTOR, '--cli', serverUrl, '--transport', 'http', '--header', header, ...args], { encoding: 'utf8', timeout: 120_000 });
  writeFileSync(`${outDir}/inspector-cli-${label}-${file}.json`, redact(out));
  return out;
};
cli('tools-list', '--method', 'tools/list');
cli('get_low_stock', '--method', 'tools/call', '--tool-name', 'get_low_stock');
cli('get_sales_summary', '--method', 'tools/call', '--tool-name', 'get_sales_summary', '--tool-arg', 'period=today', 'compare_weekday=friday');
cli('shop-profile', '--method', 'resources/read', '--uri', 'shop://profile');
cli('morning_briefing', '--method', 'prompts/get', '--prompt-name', 'morning_briefing');

// 2) Web UI screenshots.
const web = spawn('npx', ['-y', INSPECTOR, '--web', '--transport', 'http', '--server-url', serverUrl, '--header', header], {
  env: { ...process.env, MCP_AUTO_OPEN_ENABLED: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true
});
let uiUrl = '';
web.stdout.on('data', (chunk) => {
  const m = /http:\/\/127\.0\.0\.1:6274\?MCP_INSPECTOR_API_TOKEN=[a-f0-9]+/.exec(String(chunk));
  if (m) uiUrl = m[0];
});
for (let i = 0; i < 60 && !uiUrl; i += 1) await sleep(500);
if (!uiUrl) throw new Error('inspector web UI did not start');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(uiUrl);
  await page.waitForTimeout(1500);
  await page.locator('.mantine-Switch-track').first().click();
  await page.getByText('Connected', { exact: true }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/inspector-${label}-connected.png` });
  await page.getByText('Tools', { exact: true }).first().click();
  await page.waitForTimeout(1000);
  await page.getByText('get_low_stock', { exact: true }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/inspector-${label}-tools.png` });
  await page.getByRole('button', { name: 'Execute Tool' }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}/inspector-${label}-tool-result.png` });
  console.log(`saved Inspector evidence (${label}) to ${outDir}`);
} finally {
  await browser.close();
  // npx spawns the Inspector as a child; kill the whole process group.
  try {
    process.kill(-(web.pid ?? 0), 'SIGTERM');
  } catch {
    web.kill('SIGTERM');
  }
}
