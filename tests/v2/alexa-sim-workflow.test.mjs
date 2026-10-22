// P1 differentiators in the simulator, end to end over MCP (memory backend,
// offline rules brain): the morning check chains briefing -> plan and drafts
// supplier by supplier; shop memory is said back and applied, scoped to the
// speaker's voice profile, which the model never sees; Vietnamese yes/no.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RulesBrain, isAffirmative, planToolCalls } from '../../apps/alexa-sim/dist/brain.js';
import { runTurn, newConversation } from '../../apps/alexa-sim/dist/agent.js';
import { McpToolbox } from '../../apps/alexa-sim/dist/toolbox.js';
import { startMcpServer, TOKEN_A } from './mcp-harness.mjs';

const words = (t) => t.trim().split(/\s+/).length;

async function session(fn) {
  const srv = await startMcpServer();
  const toolbox = new McpToolbox(`${srv.url}/mcp`, TOKEN_A);
  try {
    await fn({ srv, toolbox });
  } finally {
    await toolbox.close();
    await srv.close();
  }
}

const say = (toolbox, conversation, userText, voiceProfile) =>
  runTurn({ conversation, userText, brain: new RulesBrain(), toolbox, today: '2026-09-25', now: Date.now, ...(voiceProfile ? { voiceProfile } : {}) });

test('morning check: briefing + plan in one answer, then draft and confirm supplier by supplier', async () => {
  await session(async ({ srv, toolbox }) => {
    const c = newConversation('m1', Date.now());
    const morning = await say(toolbox, c, 'Good morning, how is the shop?');
    assert.deepEqual(morning.toolCalls.map((t) => t.name), ['get_daily_briefing', 'suggest_reorder']);
    assert.ok(words(morning.reply) <= 35, morning.reply);
    assert.match(morning.reply, /Yesterday you sold/);
    assert.match(morning.reply, /I'd reorder \d+ items from \d+ suppliers, about \$\d+\./);
    assert.match(morning.reply, /Shall I draft .+ first, about \$\d+\?$/);
    assert.equal(morning.confirmationCard, null, 'nothing drafted without a yes');

    const first = await say(toolbox, c, 'Yes');
    assert.deepEqual(first.toolCalls.map((t) => t.name), ['create_reorder_draft']);
    assert.ok(first.toolCalls[0].args.supplier, 'drafts one supplier');
    assert.equal(first.confirmationCard.drafts.length, 1);
    assert.equal(srv.store.drafts.filter((d) => d.status === 'confirmed').length, 0);

    const confirmed = await say(toolbox, c, 'Yes, confirm');
    assert.equal(confirmed.orderResult.status, 'confirmed');
    assert.match(confirmed.reply, /Next: .+, about \$\d+\. Draft it\?$/);

    const second = await say(toolbox, c, 'Yes');
    assert.deepEqual(second.toolCalls.map((t) => t.name), ['create_reorder_draft']);
    assert.notEqual(second.toolCalls[0].args.supplier, first.toolCalls[0].args.supplier, 'the next supplier of the plan');
    assert.equal(srv.store.drafts.filter((d) => d.status === 'confirmed').length, 1, 'the second draft waits for its own yes');
  });
});

test('shop memory through the simulator: said back, applied with "as you asked", scoped per voice profile', async () => {
  await session(async ({ toolbox }) => {
    const tools = await toolbox.listTools();
    const remember = tools.find((t) => t.name === 'remember_shop_rule');
    assert.ok(remember, 'memory tools are offered to voice clients');
    assert.ok(!('voice_profile' in remember.inputSchema.properties), 'the model never sees voice_profile');
    assert.ok(toolbox.voiceProfileTools().has('suggest_reorder'));

    const c = newConversation('mem1', Date.now());
    const saved = await say(toolbox, c, 'Always order eggs from Dawn Bakery & Farm', 'browser-a');
    assert.equal(saved.toolCalls[0].name, 'remember_shop_rule');
    assert.ok(!('voice_profile' in saved.toolCalls[0].args), 'not shown in the tool panel');
    assert.match(saved.reply, /From now on I'll order eggs from Dawn Bakery & Farm/);

    const plan = await say(toolbox, newConversation('mem2', Date.now()), 'What should I reorder this week?', 'browser-a');
    assert.match(plan.reply, /As you asked: eggs from Dawn Bakery & Farm/);
    const otherJudge = await say(toolbox, newConversation('mem3', Date.now()), 'What should I reorder this week?', 'browser-b');
    assert.doesNotMatch(otherJudge.reply, /As you asked/, "another visitor's rules do not apply");

    const listed = await say(toolbox, c, 'What do you remember about my shop?', 'browser-a');
    assert.match(listed.reply, /I remember one rule: order eggs from Dawn Bakery & Farm/);
    const skip = await say(toolbox, c, "Don't reorder bread", 'browser-a');
    assert.equal(skip.toolCalls[0].args.kind, 'skip_item');
    const forgot = await say(toolbox, c, 'Forget that', 'browser-a');
    assert.match(forgot.reply, /forgot the rule: skip bread in reorders/);
  });
});

test('memory phrases are explicit only; ordinary requests and refusals are not rules', () => {
  assert.equal(planToolCalls('Reorder milk')[0].name, 'create_reorder_draft');
  assert.equal(planToolCalls('No, cancel that')[0]?.name, undefined);
  assert.equal(planToolCalls('Never order more than 40 eggs')[0].input.max_qty, 40);
  assert.equal(planToolCalls('I usually order on Mondays')[0].input.weekday, 'monday');
  assert.equal(planToolCalls('Forget everything')[0].input.all, true);
});

test('Vietnamese: yes/no and questions for the host guard, intents for the fallback brain', () => {
  assert.equal(isAffirmative('Có, xác nhận đi'), true);
  assert.equal(isAffirmative('Đồng ý'), true);
  assert.equal(isAffirmative('Không, hủy đi'), false);
  assert.equal(isAffirmative('Có đơn nào chưa?'), false, 'a question is never a yes');
  assert.equal(isAffirmative('Xác nhận đơn này được không'), false, '"… được không" is a question');
  assert.deepEqual(planToolCalls('Chào buổi sáng, tình hình cửa hàng thế nào?').map((p) => p.name), ['get_daily_briefing', 'suggest_reorder']);
  assert.equal(planToolCalls('Mặt hàng nào sắp hết?')[0].name, 'get_low_stock');
  assert.deepEqual(planToolCalls('Đặt thêm sữa và trứng')[0].input.items, [{ product: 'milk' }, { product: 'eggs' }]);
});
