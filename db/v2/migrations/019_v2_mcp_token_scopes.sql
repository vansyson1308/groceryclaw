-- migrate:up
-- Migration 019: scopes on static MCP bearer tokens.
-- 'shop.read' tokens (the hosted demo's judge token) can call every read tool,
-- resource and prompt; the MCP server refuses create_reorder_draft and
-- confirm_reorder for them with insufficient_scope. Existing tokens default to
-- read-write, so nothing changes for them.
BEGIN;

ALTER TABLE mcp_access_tokens
  ADD COLUMN IF NOT EXISTS scopes TEXT NOT NULL DEFAULT 'shop.read shop.write'
  CONSTRAINT mcp_access_tokens_scopes_check CHECK (scopes IN ('shop.read', 'shop.read shop.write'));

DROP FUNCTION IF EXISTS resolve_mcp_access_token(TEXT);
CREATE FUNCTION resolve_mcp_access_token(p_token_hash TEXT)
RETURNS TABLE (tenant_id UUID, token_id UUID, scopes TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  UPDATE mcp_access_tokens t
     SET last_used_at = now()
    FROM tenants tn
   WHERE t.token_hash = p_token_hash
     AND t.status = 'active'
     AND tn.id = t.tenant_id
     AND tn.status = 'active'
  RETURNING t.tenant_id, t.id, t.scopes;
END;
$$;

ALTER FUNCTION resolve_mcp_access_token(TEXT) OWNER TO groceryclaw_bootstrap_owner;
REVOKE ALL ON FUNCTION resolve_mcp_access_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_mcp_access_token(TEXT) TO groceryclaw_app_user;

COMMIT;

-- migrate:down
BEGIN;

DROP FUNCTION IF EXISTS resolve_mcp_access_token(TEXT);
CREATE FUNCTION resolve_mcp_access_token(p_token_hash TEXT)
RETURNS TABLE (tenant_id UUID, token_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  UPDATE mcp_access_tokens t
     SET last_used_at = now()
    FROM tenants tn
   WHERE t.token_hash = p_token_hash
     AND t.status = 'active'
     AND tn.id = t.tenant_id
     AND tn.status = 'active'
  RETURNING t.tenant_id, t.id;
END;
$$;

ALTER FUNCTION resolve_mcp_access_token(TEXT) OWNER TO groceryclaw_bootstrap_owner;
REVOKE ALL ON FUNCTION resolve_mcp_access_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_mcp_access_token(TEXT) TO groceryclaw_app_user;

ALTER TABLE mcp_access_tokens DROP COLUMN IF EXISTS scopes;

COMMIT;
