# ShopVoice on the Claude directory: decisions

Each entry gives the date, the decision and the reason. Anthropic's docs outrank `SPEC.md` (see `REQUIREMENTS_DIGEST.md`); every deviation from the spec is recorded here.

## 2026-09-27

**DD1. Branch `feat/claude-directory`, created from `main` at `260487e`.**
The owner's brief names this branch.

**DD2. Protocol: keep MCP `2025-11-25` on `@modelcontextprotocol/sdk` 1.30.1. No upgrade to `2026-07-28` for now.**
`2026-07-28` is the current MCP revision and is stateless. Neither SDK line can serve it yet: the 1.x `SUPPORTED_PROTOCOL_VERSIONS` and the new scoped v2 packages (`@modelcontextprotocol/core` 2.1.0, inspected from the npm tarball) both stop at `2025-11-25`. That revision's versioning page keeps backward compatibility with initialize-based revisions, and Claude still connects to `2025-11-25` servers; the Devpost Inspector evidence uses it too. The server stays stateful, with sessions bound to the principal, on a single instance. We revisit when the SDK ships `2026-07-28`.

**DD3. The OAuth authorization server lives inside `apps/mcp-server`, under `src/oauth/`.**
This gives one deployment, one origin and one issuer: `issuer` = `PUBLIC_BASE_URL` and `resource` = `PUBLIC_BASE_URL/mcp`. `/.well-known/*`, `/oauth/*` and `/account` are served by the same `node:http` handler. There are no new runtime dependencies: `node:crypto` provides scrypt, SHA-256, HMAC and random values.

**DD4. The client profile is chosen by auth type, not by `clientInfo`.**
The Claude testing docs say `clientInfo` is unauthenticated and varies between surfaces. OAuth sessions (Claude and other chat clients) get a markdown summary in `content`. Static-bearer sessions (the Alexa simulator and the Devpost scripts) keep the ≤ 35-word spoken sentence unchanged. `structuredContent` is identical for both.

**DD5. Tokens are bound to the audience (RFC 8707).**
Authorization codes and tokens store the requested `resource`. `/mcp` accepts an OAuth access token only when its `resource` equals the canonical MCP URL. A missing `resource` defaults to the canonical MCP URL, because this issuer protects only that one resource.

**DD6. Write tools missing `shop.write` get a 403 `insufficient_scope` at the HTTP layer.**
The Claude lazy-auth doc says only an HTTP-level 401/403 starts sign-in or step-up. A tool error inside a 200 never does. `/mcp` therefore reads the JSON-RPC body before the SDK does. A `tools/call` for `create_reorder_draft` or `confirm_reorder` without `shop.write` gets `403` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="shop.read shop.write", resource_metadata=…`.

**DD7. The tagline is kept at ≤ 55 characters.**
The spec says ≤ 55 and the portal allows ≤ 200. `scripts/directory/check_kit.mjs` enforces the stricter limit.

**DD8. Every piece of OAuth state lives in Postgres, reachable only through SECURITY DEFINER functions (migration 018).**
The runtime role has no grants on `web_accounts`, `oauth_clients`, `oauth_codes`, `oauth_tokens` or `sandbox_shops`, and RLS on them is forced with no policy. This is the pattern `resolve_mcp_access_token` already uses. Tokens, codes and client secrets are stored as SHA-256 digests. Passwords are scrypt hashes computed in the app. A token resolves to its tenant through the account at request time, so linking a real shop cannot leave a token pointing at a stale tenant. Linking also revokes all of the account's tokens.

**DD9. Sandbox shops are re-seeded once a day.**
Every sign-up gets its own copy of the deterministic demo catalogue: 60 products, 5 suppliers, 91 days of sales and 3 invoices, about 130 ms to create. `sandbox_refresh()` re-seeds it the first time the account is used on a new day (Asia/Ho_Chi_Minh), so "yesterday" always has sales, including for a reviewer weeks later. Drafts in a sandbox therefore reset daily; `/docs` says so. Vietnamese sign-ups get a VND shop with Vietnamese names.

**DD10. Invite linking reuses `consume_invite_code` with a separate platform user id, `web-link:<account>`.**
This keeps its lockout and one-user-one-tenant rules. The sandbox owner row uses `web:<account>`, and both carry the `telegram` platform value because migration 012's CHECK and the function hard-code it; the prefixes make collisions with numeric Telegram ids impossible. Linking needs `INVITE_PEPPER_B64` on the MCP server; without it the account page says linking is off.

**DD11. Rate limits take into account that all of Claude's traffic comes from Anthropic's shared egress range (`160.79.104.0/21`).**
- The per-IP auth-failure limiter on `/mcp` no longer counts requests with no token, or with an OAuth `svat_` token. A missing token is the normal start of sign-in, and an expired OAuth token is the normal cue for Claude to refresh.
- DCR from the Anthropic range uses one shared bucket, 100× the per-IP limit. Claude is expected to prefer CIMD anyway, because we advertise it.

**DD12. Tool descriptions were rewritten to be neutral (connector review, prompt-injection rules).**
- Removed: "ONLY after they explicitly say yes", "read the spoken summary to the user" and "Good for an Alexa+ morning routine".
- `confirm_reorder` now says exactly what it does: it changes the draft status only, never contacts suppliers and never pays.
- The confirmation step is now carried by `destructiveHint: true`, which makes Claude ask the user, and on the voice path by the Alexa simulator host, which still holds the token outside the model.
- A test lints every description for instruction-like patterns.

**DD13. The Claude reorder path passes the confirmation token through the model.**
Claude has no host that can hold the token. `create_reorder_draft` therefore returns it in `structuredContent` and in the markdown. It is a single-use reference, bound to the tenant and hashed at rest, and valid for only 5 minutes. It can only confirm drafts that already exist in that shop, it moves no money, and `confirm_reorder` still needs the user's approval (`destructiveHint`).
