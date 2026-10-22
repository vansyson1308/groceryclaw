#!/usr/bin/env node
// Drives the MCP Apps reorder-plan view (ui://shopvoice/reorder-plan) in a real
// browser, the way an MCP Apps host would: the view runs in a sandboxed iframe
// with a different origin, and a minimal host answers ui/initialize, sends
// ui/notifications/tool-result with suggest_reorder's result, and proxies the
// view's tools/call requests to the MCP server over Streamable HTTP.
// It clicks "Draft" then "Confirm" for the first supplier and saves a screenshot.
//
//   node scripts/demo/mcp_app_check.mjs [--mcp-url http://127.0.0.1:8090/mcp --token …]
//   (without --mcp-url it starts a local in-memory MCP server)
// Writes docs/hackathon/evidence/mcp-app-reorder-plan.{png,json}. Exit 1 on failure.
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startLocalStack } from './e2e_voice_flow.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

let stack = null;
let mcpUrl = arg('--mcp-url');
let token = arg('--token');
if (!mcpUrl) {
  stack = await startLocalStack();
  mcpUrl = stack.mcpUrl;
  token = stack.token;
}
const client = new Client({ name: 'mcp-app-check', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
// JSON for an inline <script>: "</script>" inside a string would end the host's script early.
const inline = (value) => JSON.stringify(value).replace(/<\//g, '<\\/');
const steps = [];
let browser = null;
try {
  const { tools } = await client.listTools();
  const uri = tools.find((t) => t.name === 'suggest_reorder')?._meta?.ui?.resourceUri;
  if (!uri) throw new Error('suggest_reorder has no _meta.ui.resourceUri');
  const html = (await client.readResource({ uri })).contents[0].text;
  const plan = await client.callTool({ name: 'suggest_reorder', arguments: {} });
  steps.push(`tools/list → ${uri}`, `suggest_reorder → ${plan.content[0].text}`);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  // Host bridge: tools/call from the view goes to the real MCP server.
  await page.exposeFunction('hostCallTool', async (name, args) => {
    steps.push(`view → tools/call ${name}`);
    return client.callTool({ name, arguments: args });
  });
  await page.setContent(`<!doctype html><html><body style="margin:0;font:14px system-ui;background:#eef1f6">
    <div style="padding:10px 14px;color:#334">Minimal MCP Apps host · sandboxed iframe · ${uri}</div>
    <iframe id="view" sandbox="allow-scripts" style="width:860px;height:860px;border:1px solid #ccd;margin:0 14px;background:#fff"></iframe>
    <script>
      const frame = document.getElementById('view');
      const toolResult = ${inline(plan)};
      window.addEventListener('message', async (e) => {
        if (e.source !== frame.contentWindow) return;
        const m = e.data;
        const reply = (result) => frame.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result }, '*');
        if (m.method === 'ui/initialize') reply({ protocolVersion: '2026-01-26', hostCapabilities: { serverTools: {} }, hostInfo: { name: 'check-host', version: '1' }, hostContext: {} });
        else if (m.method === 'ui/notifications/initialized') {
          frame.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: {} } }, '*');
          frame.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: toolResult }, '*');
        } else if (m.method === 'tools/call') reply(await window.hostCallTool(m.params.name, m.params.arguments));
      });
      frame.srcdoc = ${inline(html)};
    </script></body></html>`);
  const view = page.frameLocator('#view');
  const draft = view.locator('button', { hasText: /^Draft / }).first();
  await draft.waitFor({ timeout: 10_000 });
  steps.push(`rendered ${await view.locator('section').count()} supplier sections`);
  await draft.click();
  const confirm = view.locator('section').first().locator('button', { hasText: 'Confirm' });
  await confirm.waitFor({ state: 'visible' });
  await view.locator('section').first().locator('.status', { hasText: /Draft ready|Drafted/ }).waitFor({ timeout: 10_000 });
  await confirm.click();
  await view.locator('section').first().locator('.status', { hasText: /confirmed/i }).waitFor({ timeout: 10_000 });
  steps.push(`status: ${await view.locator('section').first().locator('.status').textContent()}`);
  await page.screenshot({ path: 'docs/hackathon/evidence/mcp-app-reorder-plan.png' });
  writeFileSync('docs/hackathon/evidence/mcp-app-reorder-plan.json', `${JSON.stringify({ ranAt: new Date().toISOString(), mcpUrl, passed: true, steps }, null, 2)}\n`);
  console.log(steps.join('\n'));
  console.log('PASSED');
} catch (error) {
  console.error(steps.join('\n'));
  console.error(`FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await client.close();
  stack?.stop();
}
