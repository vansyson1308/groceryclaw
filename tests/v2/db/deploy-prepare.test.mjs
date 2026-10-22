// Hosted-demo deploy scripts against a real Postgres (Kiro spec tasks 2-3):
// db_prepare on a copy of the test database (twice), the runtime role's flags, token
// scopes, the daily reseed, and the MCP server's privileged-user guard.
// Needs DATABASE_URL with a superuser that can CREATE DATABASE; skips otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import pg from 'pg';
import { prepareDatabase } from '../../../scripts/deploy/db_prepare.mjs';
import { reseedDemo } from '../../../scripts/deploy/reseed_demo.mjs';
import { DEMO_TENANT_ID } from '../../../scripts/v2/gen_demo_seed.mjs';

const dbUrl = process.env.DATABASE_URL;
const skip = !dbUrl;
const DB_NAME = `shopvoice_deploy_test_${process.pid}`;
const ROLE = `shopvoice_app_test_${process.pid}`;
const ROLE_PASSWORD = 'deploy-test-password-0123456789';
const SIM_TOKEN = 'sv_deploy_test_simulator_token_aaaaaaaaaaaaaaaaaa';
const JUDGE_TOKEN = 'sv_deploy_test_judge_read_only_token_bbbbbbbbbbbbbb';
const OTHER_TENANT = 'd0d0d0d0-0000-4000-8000-000000000019';
const sha = (v) => createHash('sha256').update(v).digest('hex');

function urlFor(base, { db, user, password } = {}) {
  const u = new URL(base);
  if (db) u.pathname = `/${db}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

const adminUrl = skip ? '' : urlFor(dbUrl, { db: DB_NAME });
const env = {
  DEPLOY_ADMIN_DATABASE_URL: adminUrl,
  MCP_DB_USER: ROLE,
  MCP_DB_PASSWORD: ROLE_PASSWORD,
  SIM_MCP_TOKEN: SIM_TOKEN,
  MCP_JUDGE_TOKEN: JUDGE_TOKEN,
  DEMO_SHOP_TIMEZONE: 'Asia/Ho_Chi_Minh'
};

async function withClient(connectionString, work) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

test.before(async () => {
  if (skip) return;
  // A copy of the migrated test database: migration files that create cluster-wide
  // roles cannot be replayed on a cluster that already has them (Render's is fresh).
  const source = new URL(dbUrl).pathname.slice(1);
  await withClient(urlFor(dbUrl, { db: 'postgres' }), async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await c.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [source]);
    await c.query(`CREATE DATABASE ${DB_NAME} TEMPLATE "${source.replace(/"/g, '')}"`);
  });
  // Remove the demo shop so the first db_prepare exercises the seeding path.
  await withClient(urlFor(dbUrl, { db: DB_NAME }), (c) => c.query('DELETE FROM shop_profiles WHERE tenant_id = $1', [DEMO_TENANT_ID]));
});

test.after(async () => {
  if (skip) return;
  await withClient(urlFor(dbUrl, { db: 'postgres' }), async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await c.query(`DROP ROLE IF EXISTS ${ROLE}`);
  });
});

test('db_prepare migrates a fresh database, creates the runtime role, seeds the demo shop and registers both tokens; a second run is a no-op', { skip }, async () => {
  const lines = [];
  await prepareDatabase({ env, log: (l) => lines.push(l) });
  assert.ok(lines.some((l) => /migrations applied: \d+/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /demo shop seeded/.test(l)));
  const second = [];
  await prepareDatabase({ env, log: (l) => second.push(l) });
  assert.ok(second.some((l) => /migrations applied: 0/.test(l)), second.join('\n'));
  assert.ok(second.some((l) => /demo shop present/.test(l)));
  const output = [...lines, ...second].join('\n');
  assert.ok(!output.includes(ROLE_PASSWORD) && !output.includes(SIM_TOKEN) && !output.includes(JUDGE_TOKEN), 'no secret printed');
});

test('the runtime role is NOSUPERUSER NOBYPASSRLS, sees no rows without tenant context, and resolves tokens with their scopes', { skip }, async () => {
  await withClient(adminUrl, async (c) => {
    const { rows } = await c.query('SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin FROM pg_roles WHERE rolname = $1', [ROLE]);
    assert.deepEqual(rows[0], { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: true });
  });
  await withClient(urlFor(adminUrl, { user: ROLE, password: ROLE_PASSWORD }), async (c) => {
    const { rows } = await c.query('SELECT count(*)::int AS n FROM stock_levels');
    assert.equal(rows[0].n, 0, 'RLS hides every row without app.current_tenant');
    const sim = await c.query('SELECT tenant_id::text AS t, scopes FROM resolve_mcp_access_token($1)', [sha(SIM_TOKEN)]);
    assert.deepEqual(sim.rows[0], { t: DEMO_TENANT_ID, scopes: 'shop.read shop.write' });
    const judge = await c.query('SELECT tenant_id::text AS t, scopes FROM resolve_mcp_access_token($1)', [sha(JUDGE_TOKEN)]);
    assert.deepEqual(judge.rows[0], { t: DEMO_TENANT_ID, scopes: 'shop.read' });
  });
});

test('reseed anchors the demo to a new day, keeps both tokens and leaves another tenant untouched', { skip }, async () => {
  await withClient(adminUrl, async (c) => {
    await c.query("INSERT INTO tenants (id, name, status, processing_mode) VALUES ($1, 'Other Deploy Shop', 'active', 'v2') ON CONFLICT (id) DO NOTHING", [OTHER_TENANT]);
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.current_tenant', $1, true)", [OTHER_TENANT]);
    await c.query("INSERT INTO sales_daily (tenant_id, sale_date, sku, qty_sold, revenue_vnd) VALUES ($1, '2026-01-01', 'OTHER-1', 3, 3000)", [OTHER_TENANT]);
    await c.query('COMMIT');
    const today = '2026-11-20';
    const tokens = await reseedDemo(c, { today, env });
    assert.equal(tokens.length, 2);
    const demo = await c.query('SELECT count(*)::int AS n FROM sales_daily WHERE tenant_id = $1 AND sale_date = $2', [DEMO_TENANT_ID, today]);
    assert.ok(demo.rows[0].n > 0, "today's sales row exists");
    const other = await c.query('SELECT count(*)::int AS n FROM sales_daily WHERE tenant_id = $1', [OTHER_TENANT]);
    assert.equal(other.rows[0].n, 1, 'other tenant untouched');
    const resolved = await c.query('SELECT scopes FROM resolve_mcp_access_token($1) UNION ALL SELECT scopes FROM resolve_mcp_access_token($2)', [sha(SIM_TOKEN), sha(JUDGE_TOKEN)]);
    assert.deepEqual(resolved.rows.map((r) => r.scopes), ['shop.read shop.write', 'shop.read']);
  });
});

async function freePort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function startMcp(dbUrlForServer, extra = {}) {
  return freePort().then((port) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['apps/mcp-server/dist/server.js'], {
      env: { PATH: process.env.PATH, MCP_PORT: String(port), MCP_HOST: '127.0.0.1', MCP_DATA_BACKEND: 'postgres', MCP_DB_URL: dbUrlForServer, ...extra },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    const done = (result) => { clearTimeout(timer); resolve({ ...result, out, child, port }); };
    child.stdout.on('data', (d) => { out += d; if (out.includes('mcp_server_listening')) done({ listening: true }); });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => done({ listening: false, code }));
    const timer = setTimeout(() => done({ listening: false, code: null }), 15_000);
  }));
}

test('the MCP server refuses to start as a superuser, and starts as the runtime role', { skip }, async () => {
  const refused = await startMcp(adminUrl);
  assert.equal(refused.listening, false);
  assert.equal(refused.code, 1);
  assert.match(refused.out, /must not be a superuser or have BYPASSRLS/);
  const ok = await startMcp(urlFor(adminUrl, { user: ROLE, password: ROLE_PASSWORD }));
  try {
    assert.equal(ok.listening, true, ok.out);
    const health = await fetch(`http://127.0.0.1:${ok.port}/readyz`);
    assert.equal(health.status, 200);
  } finally {
    ok.child.kill('SIGTERM');
  }
  const allowed = await startMcp(adminUrl, { MCP_ALLOW_PRIVILEGED_DB_USER: 'true' });
  allowed.child.kill('SIGTERM');
  assert.equal(allowed.listening, true, 'local-dev escape hatch');
});
