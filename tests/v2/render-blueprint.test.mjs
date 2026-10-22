// Text checks on render.yaml (Kiro spec task 6): secrets are never literal,
// health checks are set, the reseed runs at 00:05 Vietnam time, and the
// simulator reaches the MCP server over Render's private network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const yaml = readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8');
const SECRET_KEYS = ['POSTGRES_PASSWORD', 'MCP_DB_PASSWORD', 'SIM_MCP_TOKEN', 'MCP_JUDGE_TOKEN', 'ANTHROPIC_API_KEY'];

/** Top-level `- type:` service blocks, split on two-space-indented list items under services:. */
function services() {
  const body = yaml.slice(yaml.indexOf('\nservices:'));
  return body.split(/\n  - type: /).slice(1).map((block) => {
    const type = block.split('\n')[0].trim();
    const name = /\n {4}name: (\S+)/.exec(block)?.[1];
    return { type, name, block };
  });
}

test('every secret uses generateValue: true or sync: false, never a literal value', () => {
  for (const key of SECRET_KEYS) {
    const pattern = new RegExp(`- key: ${key}\\n(\\s+)(\\S[^\\n]*)`, 'g');
    const hits = [...yaml.matchAll(pattern)];
    assert.ok(hits.length > 0, `${key} is declared`);
    for (const [, , next] of hits) assert.match(next, /^(generateValue: true|sync: false)$/, `${key}: ${next}`);
  }
  assert.doesNotMatch(yaml, /sv_[A-Za-z0-9_-]{20,}|sk-ant-/, 'no token-shaped literal');
});

test('both web services have healthCheckPath /healthz; the MCP service runs db_prepare before each deploy', () => {
  const byName = Object.fromEntries(services().map((s) => [s.name, s]));
  for (const name of ['shopvoice', 'shopvoice-mcp']) {
    assert.equal(byName[name]?.type, 'web', name);
    assert.match(byName[name].block, /\n {4}healthCheckPath: \/healthz\n/, name);
  }
  assert.match(byName['shopvoice-mcp'].block, /preDeployCommand: node scripts\/deploy\/db_prepare\.mjs/);
  assert.equal(byName['shopvoice-db']?.type, 'pserv');
  assert.match(byName['shopvoice-db'].block, /sizeGB: 1/);
});

test('the reseed cron runs reseed_demo.mjs at 00:05 Asia/Ho_Chi_Minh (17:05 UTC)', () => {
  const cron = services().find((s) => s.type === 'cron');
  assert.ok(cron);
  assert.match(cron.block, /schedule: "5 17 \* \* \*"/);
  assert.match(cron.block, /dockerCommand: node scripts\/deploy\/reseed_demo\.mjs/);
});

test('the simulator reaches the MCP server over the private network and trusts 2 proxy hops', () => {
  const sim = services().find((s) => s.name === 'shopvoice');
  assert.match(sim.block, /- key: SIM_MCP_HOSTPORT\n\s+fromService:\n\s+type: web\n\s+name: shopvoice-mcp\n\s+property: hostport/);
  assert.match(sim.block, /- key: SIM_TRUST_PROXY\n\s+value: "2"/);
  const mcp = services().find((s) => s.name === 'shopvoice-mcp');
  assert.match(mcp.block, /- key: MCP_TRUST_PROXY\n\s+value: "2"/);
});

test('the MCP image carries the deploy scripts, migrations and seed it runs', () => {
  const dockerfile = readFileSync(new URL('../../apps/mcp-server/Dockerfile', import.meta.url), 'utf8');
  for (const path of ['scripts/deploy', 'db/v2', 'scripts/v2/remote_migrate.mjs', 'scripts/v2/mcp_token_lib.mjs', 'scripts/v2/db_v2_lib.mjs', 'scripts/v2/gen_demo_seed.mjs']) {
    assert.ok(dockerfile.includes(path), path);
  }
  for (const file of ['scripts/deploy/db_prepare.mjs', 'scripts/deploy/reseed_demo.mjs', 'scripts/deploy/demo_tokens.mjs', 'db/v2/seed/002_demo_shop_seed.sql']) {
    assert.ok(existsSync(new URL(`../../${file}`, import.meta.url)), file);
  }
});
