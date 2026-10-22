// Migration 019: static MCP bearer tokens carry scopes. Runs as the runtime
// role through resolve_mcp_access_token, like the MCP server does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { PgShopStore } from '../../../apps/mcp-server/dist/pg-store.js';

const dbUrl = process.env.DATABASE_URL;
const skip = !dbUrl;
const TENANT = 'e1e1e1e1-0000-4000-8000-000000000019';
const TOKEN = 'sv_scope_test_token_flips_between_ro_and_rw_000000';
const sha = (v) => createHash('sha256').update(v).digest('hex');

const UPSERT = `INSERT INTO mcp_access_tokens (tenant_id, token_hash, label, scopes) VALUES ($1, $2, 'scope-test', $3)
  ON CONFLICT (token_hash) DO UPDATE SET scopes = EXCLUDED.scopes, status = 'active'`;

let client;

test.before(async () => {
  if (skip) return;
  client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  await client.query("INSERT INTO tenants (id, name, status, processing_mode) VALUES ($1, 'Scope Test Shop', 'active', 'v2') ON CONFLICT (id) DO NOTHING", [TENANT]);
});

test.after(async () => {
  if (skip) return;
  await client.query('DELETE FROM mcp_access_tokens WHERE tenant_id = $1', [TENANT]);
  await client.query('DELETE FROM tenants WHERE id = $1', [TENANT]);
  await client.end();
});

async function resolveAsRuntime() {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE groceryclaw_app_user');
    const { rows } = await client.query('SELECT tenant_id::text AS t, scopes FROM resolve_mcp_access_token($1)', [sha(TOKEN)]);
    return rows[0] ?? null;
  } finally {
    await client.query('ROLLBACK');
  }
}

test('existing tokens default to read-write; the scope column only allows the two known values', { skip }, async () => {
  await client.query("INSERT INTO mcp_access_tokens (tenant_id, token_hash, label) VALUES ($1, $2, 'scope-test') ON CONFLICT (token_hash) DO NOTHING", [TENANT, sha(TOKEN)]);
  assert.deepEqual(await resolveAsRuntime(), { t: TENANT, scopes: 'shop.read shop.write' });
  await assert.rejects(client.query('UPDATE mcp_access_tokens SET scopes = $1 WHERE token_hash = $2', ['shop.write', sha(TOKEN)]), /check constraint/);
});

test('re-registering flips the scope idempotently, and PgShopStore splits it', { skip }, async () => {
  const store = new PgShopStore(new pg.Pool({ connectionString: dbUrl, max: 1 }));
  try {
    for (const scopes of ['shop.read', 'shop.read', 'shop.read shop.write', 'shop.read']) {
      await client.query(UPSERT, [TENANT, sha(TOKEN), scopes]);
      assert.equal((await resolveAsRuntime()).scopes, scopes);
    }
    const resolved = await store.resolveTokenHash(sha(TOKEN));
    assert.equal(resolved.tenantId, TENANT);
    assert.deepEqual(resolved.scopes, ['shop.read']);
    const { rows } = await client.query('SELECT count(*)::int AS n FROM mcp_access_tokens WHERE token_hash = $1', [sha(TOKEN)]);
    assert.equal(rows[0].n, 1);
  } finally {
    await store.close();
  }
});
