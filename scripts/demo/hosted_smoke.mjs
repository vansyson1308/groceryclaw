#!/usr/bin/env node
// Smoke test of the hosted demo from outside (M3 / FINAL_QC evidence):
//   1. cold start: time until the simulator's and the MCP server's /healthz answer;
//   2. the 5-utterance voice flow through the simulator (POST /api/turn);
//   3. the judge token over MCP Streamable HTTP: initialize negotiates 2025-11-25,
//      tools/list, a read tool works, create_reorder_draft and confirm_reorder get 403 insufficient_scope;
//   4. read-tool latency p50/p95 with the judge token (client-observed, over the internet).
//
//   node scripts/demo/hosted_smoke.mjs --sim-url https://shopvoice-xxxx.onrender.com \
//     --mcp-url https://shopvoice-mcp-xxxx.onrender.com/mcp --judge-token sv_... [--rounds 10] [--label deployed]
// Writes docs/hackathon/evidence/hosted-smoke-<label>.json (+ .md). Exit 1 if any check fails.
import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { runVoiceFlow } from './e2e_voice_flow.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]);
};

async function timeUntilHealthy(url, timeoutMs = 180_000) {
  const started = performance.now();
  let attempts = 0;
  while (performance.now() - started < timeoutMs) {
    attempts += 1;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) return { ok: true, ms: Math.round(performance.now() - started), attempts, body: await res.json().catch(() => null) };
    } catch {
      // still waking up
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return { ok: false, ms: Math.round(performance.now() - started), attempts };
}

async function rawCall(mcpUrl, token, sessionId, body) {
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`,
      ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' } : {})
    },
    body: JSON.stringify(body)
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

const READ_CALLS = [
  ['get_low_stock', {}],
  ['get_stock_level', { product: 'fresh milk 1l' }],
  ['get_sales_summary', { period: 'today', compare_weekday: 'friday' }],
  ['get_top_movers', {}],
  ['get_invoice_status', { supplier: 'Sunrise Beverages' }],
  ['suggest_reorder', {}],
  ['get_daily_briefing', {}]
];

async function main() {
  const simUrl = arg('--sim-url')?.replace(/\/+$/, '');
  const mcpUrl = arg('--mcp-url');
  const judgeToken = arg('--judge-token', process.env.MCP_JUDGE_TOKEN);
  const rounds = Number(arg('--rounds', '10'));
  const label = arg('--label', 'deployed');
  if (!simUrl || !mcpUrl || !judgeToken) throw new Error('--sim-url, --mcp-url and --judge-token are required');
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

  const simHealth = await timeUntilHealthy(`${simUrl}/healthz`);
  const mcpHealth = await timeUntilHealthy(new URL('/healthz', mcpUrl).href);
  check('simulator /healthz', simHealth.ok, `${simHealth.ms} ms to first 200 (${simHealth.attempts} attempt(s))`);
  check('MCP server /healthz', mcpHealth.ok, `${mcpHealth.ms} ms to first 200`);

  const flow = await runVoiceFlow(simUrl, { accessCode: arg('--access-code') });
  check(`voice flow 5/5 (brain ${flow.brain}, ${flow.model})`, flow.passed, flow.turns.map((t) => `${t.ok ? 'ok' : 'FAIL'} ${t.turnLatencyMs} ms`).join(', '));

  const init = await rawCall(mcpUrl, judgeToken, null, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'hosted-smoke', version: '1.0.0' } }
  });
  const sessionId = init.headers.get('mcp-session-id');
  const negotiated = /"protocolVersion":"([^"]+)"/.exec(init.text)?.[1];
  check('judge token: initialize negotiates 2025-11-25', init.status === 200 && negotiated === '2025-11-25', `HTTP ${init.status}, ${negotiated}`);
  await rawCall(mcpUrl, judgeToken, sessionId, { jsonrpc: '2.0', method: 'notifications/initialized' });
  for (const [name, args] of [['create_reorder_draft', { items: [{ product: 'milk' }] }], ['confirm_reorder', { confirmation_token: 'rc_not_a_real_token_x' }]]) {
    const res = await rawCall(mcpUrl, judgeToken, sessionId, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } });
    check(`judge token is read-only: ${name} refused`, res.status === 403 && /insufficient_scope/.test(res.headers.get('www-authenticate') ?? ''), `HTTP ${res.status}`);
  }

  const client = new Client({ name: 'hosted-smoke', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { authorization: `Bearer ${judgeToken}` } } });
  await client.connect(transport);
  const { tools } = await client.listTools();
  check('judge token: tools/list', tools.length >= 9, `${tools.length} tools`);
  const samples = [];
  for (let r = 0; r <= rounds; r += 1) {
    for (const [name, args] of READ_CALLS) {
      const t0 = performance.now();
      const res = await client.callTool({ name, arguments: args });
      if (res.isError) check(`${name}`, false, res.content?.[0]?.text);
      if (r > 0) samples.push(performance.now() - t0);
      // Stay well under the per-token rate limit (120/min).
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  await client.close();
  const latency = { n: samples.length, p50: percentile(samples, 50), p95: percentile(samples, 95), max: percentile(samples, 100) };
  check('read-tool latency p95 < 800 ms', latency.p95 !== null && latency.p95 < 800, `p50 ${latency.p50} ms, p95 ${latency.p95} ms, n=${latency.n}`);

  const report = {
    measuredAt: new Date().toISOString(), simUrl, mcpUrl, label,
    coldStart: { simulator: simHealth, mcp: mcpHealth },
    voiceFlow: flow, latency, toolsListed: tools.map((t) => t.name),
    checks, passed: checks.every((c) => c.ok)
  };
  const base = `docs/hackathon/evidence/hosted-smoke-${label}`;
  writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`${base}.md`, [
    `# Hosted smoke (${label})`, '',
    `Measured ${report.measuredAt} from outside Render with \`node scripts/demo/hosted_smoke.mjs\`.`, '',
    `- Simulator: ${simUrl}`, `- MCP endpoint: ${mcpUrl}`, '',
    '| Check | Result | Detail |', '|---|---|---|',
    ...checks.map((c) => `| ${c.name} | ${c.ok ? 'PASS' : 'FAIL'} | ${c.detail ?? ''} |`), '',
    '## Voice flow', '',
    ...flow.turns.map((t) => `- "${t.utterance}" → [${t.tools.join(', ')}] in ${t.turnLatencyMs} ms: ${t.reply}`), ''
  ].join('\n'));
  console.log(`\n${report.passed ? 'PASSED' : 'FAILED'}; wrote ${base}.json and .md`);
  process.exit(report.passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
