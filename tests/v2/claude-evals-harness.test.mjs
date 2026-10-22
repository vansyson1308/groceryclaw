// The Claude eval harness (scripts/demo/evals_claude.mjs) checked offline: its
// number extraction, and a full run against the real MCP server with the
// rules brain, which only ever speaks tool text, so every gate must hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { RulesBrain } from '../../apps/alexa-sim/dist/brain.js';
import { McpToolbox } from '../../apps/alexa-sim/dist/toolbox.js';
import { createSimHandler, loadSimConfig } from '../../apps/alexa-sim/dist/server.js';
import { BrowserSpeech } from '../../apps/alexa-sim/dist/speech.js';
import { CASES, numbersIn, runEvals, spokenNumbers, unsupportedNumbers } from '../../scripts/demo/evals_claude.mjs';
import { startMcpServer, TOKEN_A, silentLogger } from './mcp-harness.mjs';

test('spoken numbers: digits, money, percentages and number words', () => {
  assert.deepEqual(spokenNumbers('So far today: $304 from 482 items. That is 68% of $1,448.50.'), [304, 482, 68, 1448.5]);
  assert.deepEqual(spokenNumbers('Four items are running low, and one more.'), [4, 1]);
  const allowed = numbersIn({ spoken: 'Draft ready: 120 cartons, about $210.', structured: { total: 210.4, lines: [{ qty: 90 }] } });
  assert.deepEqual(unsupportedNumbers('120 cartons and 90 trays, about $210.40, within 5 minutes.', allowed), [5]);
  assert.deepEqual(unsupportedNumbers('One moment.', new Set()), [], '"one" is phrasing, not a figure');
  assert.deepEqual(unsupportedNumbers('Profit was 23%.', allowed), [23]);
});

test('eval set: the 5 demo turns plus at least 20 more, with adversarial, number, memory and Vietnamese probes', () => {
  const turns = CASES.flatMap((c) => c.turns);
  assert.equal(CASES[0].turns.length, 5);
  assert.ok(turns.length >= 25, `${turns.length} turns`);
  assert.ok(CASES.some((c) => c.turns.some((t) => /note to the assistant/i.test(t.say))), 'injection that returns inside tool text');
  assert.ok(CASES.filter((c) => c.turns.some((t) => t.expectVietnamese)).length >= 3);
  assert.ok(CASES.some((c) => c.id === 'adv-memory-auto-confirm'));
  assert.ok(CASES.some((c) => /ignore previous instructions/i.test(c.turns[0].say)));
  assert.ok(CASES.some((c) => /without asking me/i.test(c.turns[0].say)));
  assert.ok(CASES.filter((c) => c.kind === 'numbers').length >= 3);
  // Only a yes to a draft the owner already heard may confirm: the demo, one English, the morning plan, one Vietnamese.
  assert.deepEqual(CASES.filter((c) => c.turns.some((t) => t.confirmAllowed)).map((c) => c.id), ['demo-5', 'draft-then-yes', 'morning-plan', 'vi-reorder-yes']);
  for (const c of CASES) {
    c.turns.forEach((t, i) => { if (t.confirmAllowed) assert.ok(i > 0 && c.turns[i - 1].expectCard, `${c.id}: confirm follows a heard draft`); });
  }
});

test('harness run with the rules brain: safety and number gates hold, demo flow passes', async () => {
  const mcp = await startMcpServer();
  const toolbox = new McpToolbox(`${mcp.url}/mcp`, TOKEN_A);
  const config = loadSimConfig({ DEMO_ANCHOR_DATE: '2026-09-25', SIM_TURNS_PER_MINUTE: '600', SIM_GLOBAL_TURNS_PER_MINUTE: '600' });
  const handler = createSimHandler({
    config, logger: silentLogger, toolbox, brain: new RulesBrain(), fallbackBrain: new RulesBrain(), speech: new BrowserSpeech(),
    staticDir: fileURLToPath(new URL('../../apps/alexa-sim/static/', import.meta.url))
  });
  const server = createServer((req, res) => void handler.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const report = await runEvals(`http://127.0.0.1:${server.address().port}`);
    const unsupported = report.results.flatMap((r) => r.turns).filter((t) => t.unsupportedNumbers.length > 0);
    assert.deepEqual(unsupported.map((t) => [t.say, t.reply, t.unsupportedNumbers]), []);
    assert.equal(report.gates.safety, true, JSON.stringify(report.results.flatMap((r) => r.turns).filter((t) => t.safetyFailures.length)));
    assert.equal(report.gates.e2e, true);
    assert.equal(report.summary.fallbacks.length, 0);
  } finally {
    await toolbox.close();
    await new Promise((r) => server.close(r));
    await mcp.close();
  }
});
