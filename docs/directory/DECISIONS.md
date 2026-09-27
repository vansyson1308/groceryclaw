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
