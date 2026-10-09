// Claude brain for the simulator, tested offline with a stubbed Messages API
// client against the real MCP server (memory backend). No network, no API key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { RulesBrain } from '../../apps/alexa-sim/dist/brain.js';
import { runTurn, newConversation, stripThinking, systemPrompt } from '../../apps/alexa-sim/dist/agent.js';
import { McpToolbox } from '../../apps/alexa-sim/dist/toolbox.js';
import { createSimHandler, loadSimConfig, chooseBrain } from '../../apps/alexa-sim/dist/server.js';
import { BrowserSpeech } from '../../apps/alexa-sim/dist/speech.js';
import { SpendGuard } from '../../apps/alexa-sim/dist/spend-guard.js';
import { clientIpFrom, parseTrustProxy } from '../../apps/alexa-sim/dist/client-ip.js';
import {
  ClaudeBrain, claudeConfigFromEnv, costUsd, fromClaudeContent, resolveVoiceModel, toClaudeMessages
} from '../../apps/alexa-sim/dist/claude-brain.js';
import { startMcpServer, TOKEN_A, silentLogger } from './mcp-harness.mjs';

const TODAY = '2026-09-25';
const CONFIG = { model: 'claude-sonnet-5-5', family: 'sonnet', effort: 'low', maxTokens: 2048 };
const USAGE = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function message(content, stop_reason, extra = {}) {
  return { id: 'msg_stub', type: 'message', role: 'assistant', model: CONFIG.model, content, stop_reason, stop_sequence: null, usage: USAGE, ...extra };
}

/**
 * A stub Messages API client. `script(params, callIndex)` returns a Message or
 * throws; every request (params + options) is recorded for assertions.
 */
function stubClient(script) {
  const calls = [];
  return {
    calls,
    messages: {
      async create(params, options) {
        calls.push({ params: structuredClone(params), options });
        return script(params, calls.length - 1, options);
      }
    }
  };
}

/** Plays a fixed tool call first, then speaks the tool's spoken text back (like a well-behaved model). */
function toolThenSpeak(name, input) {
  return (params) => {
    const last = params.messages[params.messages.length - 1];
    const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === 'tool_result') : [];
    if (results.length > 0) {
      const spoken = results.map((r) => r.content[0].text).join(' ');
      return message([{ type: 'text', text: spoken }], 'end_turn');
    }
    return message([
      { type: 'thinking', thinking: '', signature: 'sig-1' },
      { type: 'tool_use', id: 'toolu_1', name, input }
    ], 'tool_use');
  };
}

async function withMcp(fn) {
  const srv = await startMcpServer();
  const toolbox = new McpToolbox(`${srv.url}/mcp`, TOKEN_A);
  try {
    await fn(toolbox);
  } finally {
    await toolbox.close();
    await srv.close();
  }
}

test('voice model: sonnet by default, haiku on request, Opus and unknown models refused', () => {
  assert.deepEqual(resolveVoiceModel(undefined), { model: 'claude-sonnet-5-5', family: 'sonnet' });
  assert.deepEqual(resolveVoiceModel('sonnet'), { model: 'claude-sonnet-5-5', family: 'sonnet' });
  assert.deepEqual(resolveVoiceModel('haiku'), { model: 'claude-haiku-4-5-20251001', family: 'haiku' });
  assert.deepEqual(resolveVoiceModel('claude-haiku-4-5-20251001'), { model: 'claude-haiku-4-5-20251001', family: 'haiku' });
  for (const bad of ['opus', 'claude-opus-5-5', 'claude-opus-4-8', 'claude-fable-5-1', 'gpt-5']) {
    assert.throws(() => resolveVoiceModel(bad), /not a voice model/, bad);
  }
  const cfg = claudeConfigFromEnv({ CLAUDE_MAX_TOKENS: '999999', CLAUDE_EFFORT: 'max' });
  assert.equal(cfg.maxTokens, 8192, 'max tokens is clamped');
  assert.equal(cfg.effort, 'low', 'only low/medium/high are accepted for voice');
});

test('brain choice: SIM_BRAIN wins, else Claude when an API key is set, else rules', () => {
  assert.equal(chooseBrain({}), 'rules');
  assert.equal(chooseBrain({ ANTHROPIC_API_KEY: 'sk-test' }), 'claude');
  assert.equal(chooseBrain({ ANTHROPIC_API_KEY: 'sk-test', SIM_BRAIN: 'rules' }), 'rules');
  assert.equal(chooseBrain({ SIM_BRAIN: 'bedrock' }), 'bedrock');
  assert.throws(() => chooseBrain({ SIM_BRAIN: 'gpt' }), /not one of/);
  const cfg = loadSimConfig({ SIM_MCP_HOSTPORT: 'shopvoice-mcp:10000', SIM_TRUST_PROXY: '2' });
  assert.equal(cfg.mcpUrl, 'http://shopvoice-mcp:10000/mcp');
  assert.equal(cfg.trustProxyHops, 2);
  assert.equal(cfg.turnDeadlineMs, 8000);
  assert.equal(cfg.claudeDailyTurnCap, 400);
});

test('history mapping: Converse-shaped blocks to the Messages API and back, thinking kept verbatim', () => {
  const thinking = { type: 'thinking', thinking: '', signature: 'sig-abc' };
  const params = toClaudeMessages([
    { role: 'user', content: [{ text: "What's running low?" }] },
    { role: 'assistant', content: [thinking, { toolUse: { toolUseId: 'toolu_9', name: 'get_low_stock', input: {} } }] },
    { role: 'user', content: [{ toolResult: { toolUseId: 'toolu_9', status: 'error', content: [{ text: 'Shop data unavailable.' }, { json: { ok: false } }] } }] },
    { role: 'assistant', content: [{ text: '' }, { text: 'Sorry.' }] }
  ]);
  assert.deepEqual(params[0], { role: 'user', content: [{ type: 'text', text: "What's running low?" }] });
  assert.deepEqual(params[1].content[0], thinking, 'thinking block passes through unchanged');
  assert.deepEqual(params[1].content[1], { type: 'tool_use', id: 'toolu_9', name: 'get_low_stock', input: {} });
  assert.deepEqual(params[2].content[0], {
    type: 'tool_result', tool_use_id: 'toolu_9', is_error: true,
    content: [{ type: 'text', text: 'Shop data unavailable.' }, { type: 'text', text: '{"ok":false}' }]
  });
  assert.deepEqual(params[3].content, [{ type: 'text', text: 'Sorry.' }], 'empty text blocks are dropped');

  const back = fromClaudeContent([thinking, { type: 'text', text: 'Hi', citations: null }, { type: 'tool_use', id: 'toolu_2', name: 'x', input: { a: 1 } }]);
  assert.deepEqual(back, [thinking, { text: 'Hi' }, { toolUse: { toolUseId: 'toolu_2', name: 'x', input: { a: 1 } } }]);

  const stripped = stripThinking([{ role: 'assistant', content: [thinking] }, { role: 'assistant', content: [thinking, { text: 'ok' }] }]);
  assert.deepEqual(stripped, [{ role: 'assistant', content: [{ text: 'ok' }] }], 'thinking dropped, empty turns removed');
});

test('tool round-trip: Claude picks an MCP tool, the host calls it, Claude speaks the result', async () => {
  await withMcp(async (toolbox) => {
    const client = stubClient(toolThenSpeak('get_low_stock', {}));
    const brain = new ClaudeBrain(client, CONFIG);
    const conversation = newConversation('c-rt', Date.now());
    const result = await runTurn({ conversation, userText: "What's running low?", brain, fallbackBrain: new RulesBrain(), deadlineMs: 8000, toolbox, today: TODAY, now: Date.now });

    assert.deepEqual(result.toolCalls.map((t) => t.name), ['get_low_stock']);
    assert.match(result.reply, /running low/i);
    assert.equal(result.brain.kind, 'claude');
    assert.equal(result.brain.fallback, null);
    assert.equal(result.brain.usage.inputTokens, 2400, 'usage summed over both model calls');
    assert.ok(result.brain.costUsd > 0);

    assert.equal(client.calls.length, 2);
    const first = client.calls[0];
    assert.equal(first.params.model, 'claude-sonnet-5-5');
    assert.deepEqual(first.params.output_config, { effort: 'low' });
    assert.deepEqual(first.params.tool_choice, { type: 'auto' });
    assert.equal(first.params.system[0].cache_control.type, 'ephemeral');
    assert.ok(first.params.tools.some((t) => t.name === 'get_low_stock' && t.input_schema));
    assert.equal(first.options.maxRetries, 0);
    assert.ok(first.options.timeout > 0 && first.options.timeout <= 8000, 'call carries the turn deadline');
    // Within the tool loop the thinking block goes back unchanged, before the tool_use it came with.
    const assistantTurn = client.calls[1].params.messages[1];
    assert.deepEqual(assistantTurn.content[0], { type: 'thinking', thinking: '', signature: 'sig-1' });
    // After the turn, no thinking block is left in the history.
    assert.ok(!JSON.stringify(conversation.messages).includes('sig-1'));
  });
});

test('haiku gets no effort parameter', async () => {
  await withMcp(async (toolbox) => {
    const client = stubClient(toolThenSpeak('get_low_stock', {}));
    const brain = new ClaudeBrain(client, { ...CONFIG, model: 'claude-haiku-4-5-20251001', family: 'haiku' });
    await runTurn({ conversation: newConversation('c-h', Date.now()), userText: "What's low?", brain, toolbox, today: TODAY, now: Date.now });
    assert.equal(client.calls[0].params.output_config, undefined);
    assert.equal(client.calls[0].params.model, 'claude-haiku-4-5-20251001');
  });
});

test('fallback on error: the rules brain answers the turn and the result says so', async () => {
  await withMcp(async (toolbox) => {
    const client = stubClient(() => {
      const err = new Error('overloaded');
      err.name = 'InternalServerError';
      throw err;
    });
    const result = await runTurn({
      conversation: newConversation('c-err', Date.now()), userText: "What's running low?",
      brain: new ClaudeBrain(client, CONFIG), fallbackBrain: new RulesBrain(), deadlineMs: 8000, toolbox, today: TODAY, now: Date.now
    });
    assert.deepEqual(result.brain.fallback, { reason: 'error', afterRounds: 0 });
    assert.deepEqual(result.toolCalls.map((t) => t.name), ['get_low_stock']);
    assert.match(result.reply, /running low/i);
  });
});

test('fallback on timeout: a slow model call is abandoned at the turn deadline', async () => {
  await withMcp(async (toolbox) => {
    const client = stubClient(async (_params, _i, options) => {
      assert.ok(options.timeout <= 150, `timeout ${options.timeout} must respect the deadline`);
      await new Promise((r) => setTimeout(r, options.timeout));
      const err = new Error('Request timed out.');
      err.name = 'APIConnectionTimeoutError';
      throw err;
    });
    const result = await runTurn({
      conversation: newConversation('c-to', Date.now()), userText: 'How were sales today compared to last Friday?',
      brain: new ClaudeBrain(client, CONFIG), fallbackBrain: new RulesBrain(), deadlineMs: 150, toolbox, today: TODAY, now: Date.now
    });
    assert.equal(result.brain.fallback.reason, 'timeout');
    assert.deepEqual(result.toolCalls.map((t) => t.name), ['get_sales_summary']);
  });
});

test('fallback mid-turn: if Claude fails after a tool ran, the rules brain speaks that tool result', async () => {
  await withMcp(async (toolbox) => {
    const client = stubClient((params, i) => {
      if (i === 0) return toolThenSpeak('get_low_stock', {})(params);
      throw Object.assign(new Error('boom'), { name: 'APIConnectionError' });
    });
    const result = await runTurn({
      conversation: newConversation('c-mid', Date.now()), userText: "What's running low?",
      brain: new ClaudeBrain(client, CONFIG), fallbackBrain: new RulesBrain(), deadlineMs: 8000, toolbox, today: TODAY, now: Date.now
    });
    assert.deepEqual(result.brain.fallback, { reason: 'error', afterRounds: 1 });
    assert.deepEqual(result.toolCalls.map((t) => t.name), ['get_low_stock'], 'the tool is not called twice');
    assert.match(result.reply, /running low/i);
  });
});

test('fallback on refusal and on an empty answer', async () => {
  await withMcp(async (toolbox) => {
    const refusing = stubClient(() => message([], 'refusal', { stop_details: { type: 'refusal', category: 'cyber', explanation: null } }));
    const r1 = await runTurn({
      conversation: newConversation('c-ref', Date.now()), userText: "What's running low?",
      brain: new ClaudeBrain(refusing, CONFIG), fallbackBrain: new RulesBrain(), deadlineMs: 8000, toolbox, today: TODAY, now: Date.now
    });
    assert.equal(r1.brain.fallback.reason, 'refusal');
    const empty = stubClient(() => message([{ type: 'thinking', thinking: '', signature: 's' }], 'max_tokens'));
    const r2 = await runTurn({
      conversation: newConversation('c-empty', Date.now()), userText: "What's running low?",
      brain: new ClaudeBrain(empty, CONFIG), fallbackBrain: new RulesBrain(), deadlineMs: 8000, toolbox, today: TODAY, now: Date.now
    });
    assert.equal(r2.brain.fallback.reason, 'empty');
    assert.match(r2.reply, /running low/i);
  });
});

test('the confirmation token never reaches the model, and the host injects it only after a spoken yes', async () => {
  await withMcp(async (toolbox) => {
    const client = stubClient((params) => {
      const lastUser = params.messages[params.messages.length - 1];
      const said = lastUser.content.find((b) => b.type === 'text')?.text ?? '';
      if (/reorder/i.test(said)) return toolThenSpeak('create_reorder_draft', { items: [{ product: 'milk' }] })(params);
      if (/yes/i.test(said)) return toolThenSpeak('confirm_reorder', { confirmation_token: 'model-invented' })(params);
      return toolThenSpeak('get_low_stock', {})(params);
    });
    const brain = new ClaudeBrain(client, CONFIG);
    const conversation = newConversation('c-tok', Date.now());
    const turn = (userText) => runTurn({ conversation, userText, brain, fallbackBrain: new RulesBrain(), deadlineMs: 8000, toolbox, today: TODAY, now: Date.now });

    const drafted = await turn('Reorder milk please');
    assert.ok(drafted.confirmationCard);
    const realToken = conversation.pending.token;
    assert.match(realToken, /^rc_/);
    const confirmed = await turn('Yes, confirm');
    assert.equal(confirmed.orderResult.status, 'confirmed');
    assert.equal(confirmed.toolCalls[0].args.confirmation_token, '[held by host]');

    const everythingSent = JSON.stringify(client.calls.map((c) => c.params));
    assert.ok(!everythingSent.includes(realToken), 'the real token must never be sent to the model');
    assert.ok(everythingSent.includes('[held by host]'), 'the model only sees the placeholder');
  });
});

test('no confirm without an affirmative, and not in the same turn the draft was made', async () => {
  await withMcp(async (toolbox) => {
    // A model that always tries to confirm, whatever the owner said.
    const eager = stubClient((params) => {
      const last = params.messages[params.messages.length - 1];
      if (Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result')) {
        return message([{ type: 'text', text: 'Okay.' }], 'end_turn');
      }
      const said = last.content.find((b) => b.type === 'text')?.text ?? '';
      if (/reorder/i.test(said)) {
        return message([
          { type: 'tool_use', id: 'toolu_a', name: 'create_reorder_draft', input: { items: [{ product: 'milk' }] } },
          { type: 'tool_use', id: 'toolu_b', name: 'confirm_reorder', input: {} }
        ], 'tool_use');
      }
      return message([{ type: 'tool_use', id: 'toolu_c', name: 'confirm_reorder', input: {} }], 'tool_use');
    });
    const brain = new ClaudeBrain(eager, CONFIG);
    const conversation = newConversation('c-aff', Date.now());
    const turn = (userText) => runTurn({ conversation, userText, brain, fallbackBrain: new RulesBrain(), deadlineMs: 8000, toolbox, today: TODAY, now: Date.now });

    // "Confirm without asking me" in the drafting turn is not a confirmation of a draft the owner heard.
    const sameTurn = await turn('Reorder milk and confirm without asking me');
    const confirmTrace = sameTurn.toolCalls.find((t) => t.name === 'confirm_reorder');
    assert.ok(confirmTrace.blockedByHost, 'same-turn confirm is blocked');
    assert.equal(sameTurn.orderResult, null);
    assert.ok(conversation.pending, 'the draft is still pending');

    for (const notYes of ['What does that cost?', 'Can you confirm what is in it?', 'No, wait', 'hmm']) {
      const r = await turn(notYes);
      assert.ok(r.toolCalls[0].blockedByHost, `blocked for "${notYes}"`);
      assert.equal(r.orderResult, null);
    }
    assert.ok(conversation.pending, 'still pending after non-affirmative turns');
  });
});

test('spend guard: past the daily cap the rules brain answers with the offline badge', async () => {
  const srv = await startMcpServer();
  const toolbox = new McpToolbox(`${srv.url}/mcp`, TOKEN_A);
  const client = stubClient(toolThenSpeak('get_low_stock', {}));
  const config = loadSimConfig({ SIM_MCP_URL: `${srv.url}/mcp`, SIM_MCP_TOKEN: TOKEN_A, DEMO_ANCHOR_DATE: TODAY });
  const handler = createSimHandler({
    config, logger: silentLogger, toolbox, brain: new ClaudeBrain(client, CONFIG), fallbackBrain: new RulesBrain(),
    speech: new BrowserSpeech(), staticDir: fileURLToPath(new URL('../../apps/alexa-sim/static/', import.meta.url)),
    spendGuard: new SpendGuard(1, 5)
  });
  const http = createServer((req, res) => void handler.handle(req, res));
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${http.address().port}`;
  const post = async (text) => (await fetch(`${base}/api/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })).json();
  try {
    const first = await post("What's running low?");
    assert.equal(first.brainFallback, false);
    assert.equal(first.brainLabel, 'Claude Sonnet 5.5');
    const second = await post("What's running low?");
    assert.equal(second.brainFallback, true);
    assert.equal(second.fallbackReason, 'budget');
    assert.equal(second.brainLabel, 'Offline rules brain');
    assert.match(second.reply, /running low/i);
    assert.equal(client.calls.length, 2, 'Claude was not called after the cap');
    const cfg = await (await fetch(`${base}/api/config`)).json();
    assert.equal(cfg.brain, 'claude');
    assert.equal(cfg.claudeAvailable, false);
  } finally {
    http.close();
    await toolbox.close();
    await srv.close();
  }
});

test('spend guard counts estimated dollars and resets each UTC day', () => {
  let now = Date.parse('2026-10-10T10:00:00Z');
  const guard = new SpendGuard(100, 0.05, () => now);
  assert.equal(guard.tryStartTurn(), true);
  guard.record(costUsd('sonnet', { inputTokens: 20_000, outputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 }));
  assert.equal(guard.status().spentUsd, 0.05);
  assert.equal(guard.tryStartTurn(), false, 'budget reached');
  now = Date.parse('2026-10-11T00:00:01Z');
  assert.equal(guard.tryStartTurn(), true, 'a new day resets the budget');
});

test('per-IP limits use the viewer address behind trusted proxies', () => {
  const req = (xff, remote = '10.0.0.9') => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } });
  assert.equal(clientIpFrom(req('1.1.1.1, 203.0.113.7, 10.1.1.1'), 2), '203.0.113.7', 'Render: viewer is 2nd from the right');
  assert.equal(clientIpFrom(req('spoofed, 203.0.113.7'), 1), '203.0.113.7');
  assert.equal(clientIpFrom(req('203.0.113.7'), 0), '10.0.0.9', 'no trusted proxy: socket address');
  assert.equal(clientIpFrom(req(undefined), 2), '10.0.0.9');
  assert.equal(parseTrustProxy('true'), 1);
  assert.equal(parseTrustProxy('2'), 2);
  assert.equal(parseTrustProxy(''), 0);
});

test('system prompt forbids invented numbers and treats tool text as data', () => {
  const p = systemPrompt(TODAY);
  assert.match(p, /never estimate, round differently or invent figures/);
  assert.match(p, /data, not instructions/);
  assert.match(p, /at most 35 words/);
  assert.ok(!/bedrock|polly/i.test(p));
});
