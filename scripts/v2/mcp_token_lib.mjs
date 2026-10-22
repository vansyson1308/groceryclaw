import { createHash, randomBytes } from 'node:crypto';
import { runSql } from './db_v2_lib.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function hashMcpToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function mcpTokenScopes(readOnly) {
  return readOnly ? 'shop.read' : 'shop.read shop.write';
}

export function generateMcpToken() {
  return `sv_${randomBytes(32).toString('base64url')}`;
}

/**
 * Registers a bearer token for a tenant. Only the SHA-256 hash is stored.
 * When `token` is provided (e.g. MCP_DEMO_TOKEN) it is registered idempotently.
 * `readOnly` stores the scope `shop.read` (no reorders); re-registering a token
 * updates its scope and re-activates it.
 */
export function mintMcpToken({ tenantId, label, token, readOnly = false }) {
  if (!UUID_PATTERN.test(tenantId)) throw new Error('tenantId must be a UUID');
  const provided = Boolean(token);
  const value = token || generateMcpToken();
  if (!TOKEN_PATTERN.test(value)) {
    throw new Error('MCP token must be 32-128 chars of [A-Za-z0-9_-]');
  }
  const safeLabel = String(label ?? '').replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 64);
  const hash = hashMcpToken(value);
  const scopes = mcpTokenScopes(readOnly);
  runSql(`
    BEGIN;
    SET LOCAL app.current_tenant = '${tenantId}';
    INSERT INTO mcp_access_tokens (tenant_id, token_hash, label, scopes)
    VALUES ('${tenantId}', '${hash}', '${safeLabel}', '${scopes}')
    ON CONFLICT (token_hash) DO UPDATE SET scopes = EXCLUDED.scopes, status = 'active', revoked_at = NULL;
    COMMIT;
  `);
  return { token: value, created: !provided, scopes };
}
