// Shared by db_prepare.mjs and reseed_demo.mjs: register the hosted demo's
// bearer tokens for the demo tenant. Only SHA-256 hashes are stored, and token
// values are never printed. Idempotent: re-registering updates the scope and
// re-activates the token.
import { DEMO_TENANT_ID } from '../v2/gen_demo_seed.mjs';
import { hashMcpToken, mcpTokenScopes } from '../v2/mcp_token_lib.mjs';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

const UPSERT = `
  INSERT INTO mcp_access_tokens (tenant_id, token_hash, label, scopes)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (token_hash) DO UPDATE
    SET scopes = EXCLUDED.scopes, label = EXCLUDED.label, status = 'active', revoked_at = NULL
  RETURNING (xmax = 0) AS inserted`;

/**
 * @param {{ query: Function }} client superuser connection
 * @param {Record<string, string | undefined>} env reads SIM_MCP_TOKEN (read-write) and MCP_JUDGE_TOKEN (read-only)
 * @returns {Promise<{ label: string, scopes: string, inserted: boolean }[]>}
 */
export async function registerDemoTokens(client, env = process.env) {
  const wanted = [
    { value: env.SIM_MCP_TOKEN, label: 'hosted-sim', readOnly: false, name: 'SIM_MCP_TOKEN' },
    { value: env.MCP_JUDGE_TOKEN, label: 'hosted-judge', readOnly: true, name: 'MCP_JUDGE_TOKEN' }
  ].filter((t) => t.value);
  if (wanted.length === 2 && wanted[0].value === wanted[1].value) {
    throw new Error('SIM_MCP_TOKEN and MCP_JUDGE_TOKEN must differ');
  }
  const done = [];
  for (const t of wanted) {
    if (!TOKEN_PATTERN.test(t.value)) throw new Error(`${t.name} must be 32-128 chars of [A-Za-z0-9_-]`);
    const scopes = mcpTokenScopes(t.readOnly);
    await client.query('BEGIN');
    try {
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [DEMO_TENANT_ID]);
      const { rows } = await client.query(UPSERT, [DEMO_TENANT_ID, hashMcpToken(t.value), t.label, scopes]);
      await client.query('COMMIT');
      done.push({ label: t.label, scopes, inserted: rows[0]?.inserted === true });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  return done;
}
