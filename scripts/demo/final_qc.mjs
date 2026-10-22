#!/usr/bin/env node
// Final QC for the hackathon submission (M6). Checks what can be checked
// from the repo and the evidence files, and writes
// docs/hackathon/evidence/final-qc.json. Exit 1 if any check fails.
//
//   node scripts/demo/final_qc.mjs [--sim-url https://… --mcp-url https://…/mcp]
//
// With the URLs it also re-checks the hosted demo from outside: both /healthz,
// the judge token can list tools, and is refused on a write.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const JUDGE_TOKEN = 'shopvoice-public-judge-token-read-only-2026';
const checks = [];
const check = (area, name, ok, detail = '') => {
  checks.push({ area, name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${area}] ${name}${detail ? ` — ${detail}` : ''}`);
};
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const json = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

// ---- rules ----
const license = read('LICENSE');
check('rules', 'MIT license file at the repo root (GitHub detects it)', /MIT License/.test(license));
check('rules', 'simulator source is in the repo', existsSync('apps/alexa-sim/src/server.ts') && existsSync('apps/alexa-sim/static/index.html'));
check('rules', 'simulated Alexa+ experience is labelled on the page', /Simulated Alexa\+ experience/i.test(read('apps/alexa-sim/static/index.html')));
const mcpText = read('apps/mcp-server/src/http.ts') + read('apps/mcp-server/src/mcp.ts');
check('rules', 'MCP server uses StreamableHTTPServerTransport', /StreamableHTTPServerTransport/.test(mcpText));
const sdkTypes = read('node_modules/@modelcontextprotocol/sdk/dist/esm/types.js');
check('rules', 'MCP SDK negotiates 2025-11-25', /LATEST_PROTOCOL_VERSION\s*=\s*'2025-11-25'/.test(sdkTypes));
const video = json('demo/video/out/report.json');
check('rules', 'video < 3:00 (brief: ≤ 2:50), 1080p h264', video && video.duration_seconds <= 170 && video.width === 1920 && video.codec === 'h264', video ? `${video.duration_seconds} s` : 'no report.json');
check('rules', 'video has English subtitles (.srt)', existsSync('demo/video/shopvoice_demo.srt'));
check('rules', '3:2 thumbnail exists', existsSync('demo/video/thumbnail.png'));

// ---- honesty ----
const pendingFiles = ['README.md', 'docs/hackathon/DEVPOST_SUBMISSION.md', 'docs/hackathon/AWS_SERVICES.md', 'docs/hackathon/EVIDENCE.md'];
for (const f of pendingFiles) {
  const n = (read(f).match(/⟪PENDING/g) ?? []).length;
  check('honesty', `no PENDING markers in ${f}`, n === 0, n ? `${n} left` : '');
}
const devpost = read('docs/hackathon/DEVPOST_SUBMISSION.md');
const claimsAws = devpost.split('\n').filter((l) => /(bedrock|polly|cloudfront|ec2)/i.test(l) && !/not deployed|never ran|instead of|no aws|account (was )?locked|unavailable/i.test(l));
check('honesty', 'Devpost text never presents an AWS runtime service as running', claimsAws.length === 0, claimsAws.slice(0, 2).join(' | '));

// ---- evidence ----
const smoke = json('docs/hackathon/evidence/hosted-smoke-deployed.json');
check('evidence', 'hosted smoke against the public URL passed', smoke?.passed === true, smoke ? `${smoke.checks.filter((c) => c.ok).length}/${smoke.checks.length}; p95 ${smoke.latency?.p95} ms` : 'missing');
const evals = json('docs/hackathon/evidence/claude-evals-hosted.json');
check('evidence', 'Claude evals on the hosted demo: safety, e2e and number gates', evals?.passed === true, evals ? `safety ${evals.summary.safety.passed}/${evals.summary.safety.total}, numbers ${evals.summary.numbers.passed}/${evals.summary.numbers.total}, e2e ${evals.summary.e2e.passed}/${evals.summary.e2e.total}` : 'missing');
check('evidence', 'Inspector evidence against the deployed server', existsSync('docs/hackathon/evidence/inspector-cli-deployed-tools-list.json'));

// ---- secrets ----
try {
  const gl = process.env.GITLEAKS_BIN ?? 'gitleaks';
  execFileSync(gl, ['git', '--config', '.gitleaks.toml', '--no-banner', '--redact', '.'], { stdio: 'pipe' });
  const commits = execFileSync('git', ['rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim();
  const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim();
  check('secrets', 'gitleaks over the git history finds nothing', true, `${commits} commits${shallow === 'true' ? ' (shallow clone!)' : ', full history'}`);
} catch (error) {
  check('secrets', 'gitleaks over the git history finds nothing', false, error.code === 'ENOENT' ? 'gitleaks not installed (set GITLEAKS_BIN)' : 'leaks reported');
}
check('secrets', 'render.yaml has no literal secret values', !/sk-ant-|sv_[A-Za-z0-9_-]{20,}/.test(read('render.yaml')));

// ---- hosted, from outside ----
const simUrl = arg('--sim-url');
const mcpUrl = arg('--mcp-url');
if (simUrl && mcpUrl) {
  const get = async (u) => { try { return (await fetch(u, { signal: AbortSignal.timeout(30_000) })).status; } catch { return 0; } };
  check('hosted', 'simulator /healthz', (await get(`${simUrl.replace(/\/+$/, '')}/healthz`)) === 200);
  check('hosted', 'MCP /healthz', (await get(new URL('/healthz', mcpUrl).href)) === 200);
  const post = (body, session) => fetch(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${JUDGE_TOKEN}`, ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-11-25' } : {}) },
    body: JSON.stringify(body)
  });
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'final-qc', version: '1' } } });
  const session = init.headers.get('mcp-session-id');
  check('hosted', 'judge token initializes with 2025-11-25', init.status === 200 && /2025-11-25/.test(await init.text()));
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, session);
  const write = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'remember_shop_rule', arguments: { kind: 'skip_item', product: 'milk', owner_words: 'qc' } } }, session);
  check('hosted', 'judge token is refused on writes (memory included)', write.status === 403);
}

const report = { ranAt: new Date().toISOString(), passed: checks.every((c) => c.ok), checks };
writeFileSync('docs/hackathon/evidence/final-qc.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${report.passed ? 'ALL PASS' : `${checks.filter((c) => !c.ok).length} FAILING`}; wrote docs/hackathon/evidence/final-qc.json`);
process.exit(report.passed ? 0 : 1);
