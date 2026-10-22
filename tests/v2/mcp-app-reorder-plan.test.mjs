// MCP Apps view for suggest_reorder: advertised in tool _meta, served as a
// text/html;profile=mcp-app resource, self-contained (no external origins),
// and the text answer stays complete for hosts without MCP Apps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startMcpServer, connectClient, spoken } from './mcp-harness.mjs';

test('suggest_reorder points MCP Apps hosts at ui://shopvoice/reorder-plan', async () => {
  const srv = await startMcpServer();
  const { client } = await connectClient(srv.url);
  try {
    const { tools } = await client.listTools();
    const suggest = tools.find((t) => t.name === 'suggest_reorder');
    assert.equal(suggest._meta?.ui?.resourceUri, 'ui://shopvoice/reorder-plan');
    assert.equal(suggest._meta?.['ui/resourceUri'], 'ui://shopvoice/reorder-plan', 'legacy key for older hosts');
    const others = tools.filter((t) => t.name !== 'suggest_reorder' && t._meta?.ui);
    assert.deepEqual(others, [], 'only the plan has a view');

    const read = await client.readResource({ uri: 'ui://shopvoice/reorder-plan' });
    const [content] = read.contents;
    assert.equal(content.mimeType, 'text/html;profile=mcp-app');
    assert.match(content.text, /^<!doctype html>/i);
    for (const method of ['ui/initialize', 'ui/notifications/initialized', 'ui/notifications/tool-result', 'ui/notifications/size-changed', 'create_reorder_draft', 'confirm_reorder']) {
      assert.ok(content.text.includes(method), method);
    }
    assert.doesNotMatch(content.text, /<(script|link|img)[^>]+(src|href)=["']https?:/i, 'no external origins');

    const r = await client.callTool({ name: 'suggest_reorder', arguments: {} });
    assert.match(spoken(r), /I'd reorder/, 'the text answer stands on its own');
  } finally {
    await client.close();
    await srv.close();
  }
});
