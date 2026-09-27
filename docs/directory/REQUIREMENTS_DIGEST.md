# Claude directory: requirements digest

Read on 2026-09-27 from the pages below. Each requirement links to the page it came from. Where Anthropic's docs and `SPEC.md` disagree, the docs win and the conflict is logged in `DECISIONS.md`.

Sources:
- [AUTH] https://claude.com/docs/connectors/building/authentication
- [LAZY] https://claude.com/docs/connectors/building/lazy-authentication
- [CHECK] https://claude.com/docs/connectors/building/review-criteria
- [SUBMIT] https://claude.com/docs/connectors/building/submission
- [TEST] https://claude.com/docs/connectors/building/testing
- [PUB] https://claude.com/docs/directory/publish
- [PBUILD] https://claude.com/docs/plugins/build
- [PCHECK] https://claude.com/docs/plugins/pre-submission-checklist
- [PSUBMIT] https://claude.com/docs/plugins/submit
- [MCPAUTH] https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- [MCPVER] https://modelcontextprotocol.io/specification/versioning
- [CCCIMD] https://claude.ai/oauth/claude-code-client-metadata

## Connector: authentication

| # | Requirement | Source |
|---|---|---|
| A1 | Unauthenticated requests get HTTP **401** with `WWW-Authenticate: Bearer resource_metadata="…"`. Claude ignores `WWW-Authenticate` on a 200, and a 200 with `isError` never starts sign-in | AUTH, LAZY |
| A2 | Protected resource metadata (PRM): `resource` equals the MCP URL exactly as the user enters it, including the path. Only the **first** `authorization_servers` entry is used. Served at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-protected-resource` | AUTH, LAZY, MCPAUTH |
| A3 | AS metadata (RFC 8414) at `/.well-known/oauth-authorization-server`, reachable from Anthropic egress `160.79.104.0/21` | AUTH |
| A4 | CIMD is used only when the AS metadata has `client_id_metadata_document_supported: true` **and** `"none"` in `token_endpoint_auth_methods_supported`; otherwise Claude falls back to DCR (`registration_endpoint`). Prefer CIMD for directory traffic, because DCR registers a new client on every fresh connection | AUTH |
| A5 | CIMD: fetch the `client_id` URL; the document's `client_id` must equal the URL; check `redirect_uri` against its `redirect_uris`; validate the JSON; cache it respecting HTTP cache headers; guard against SSRF; on consent, show the **host of the client_id URL** (the name is self-asserted) | LAZY, MCPAUTH |
| A6 | PKCE S256 on every request; advertise `code_challenge_methods_supported: ["S256"]` | AUTH, MCPAUTH |
| A7 | Scopes: the `scope` in the 401 challenge wins; otherwise PRM `scopes_supported`. Claude appends `offline_access` if the AS metadata lists it | AUTH, LAZY |
| A8 | Redirects: exactly `https://claude.ai/api/mcp/auth_callback`. Loopback `http://localhost/callback` and `http://127.0.0.1/callback` match on **any port** (Claude Code CIMD) | AUTH, CCCIMD |
| A9 | The consent screen shows the redirect URI hostname clearly, with an extra warning when only loopback redirects are registered | AUTH, MCPAUTH |
| A10 | `/token` accepts `application/x-www-form-urlencoded`. `/register` takes `application/json` | AUTH |
| A11 | Refresh: return `invalid_grant` for a dead refresh token. Rotate refresh tokens for public clients, returning the new one in the same response that invalidates the old one. Claude refreshes on a 401 and up to 5 min before expiry | AUTH, MCPAUTH |
| A12 | Latency: discovery, registration and token must answer in < 10 s, refresh in < 30 s | AUTH |
| A13 | No `client_credentials` grant. No tokens in the URL query string | AUTH, MCPAUTH |
| A14 | The `resource` parameter (RFC 8707) arrives on authorize and token requests. The MCP server **must** reject tokens that were not issued for it (audience check) | MCPAUTH |
| A15 | Step-up: a missing scope returns **403** with `WWW-Authenticate: Bearer error="insufficient_scope", scope="…all needed…"`. Any other 403 is terminal | LAZY, MCPAUTH |
| A16 | Claude caches discovery for about 5 min, keyed by URL | LAZY |
| A17 | `static_headers` is beta and only for some organizations. Use a standard header name (`authorization`), never a query token | AUTH |
| A18 | Authorization codes are single-use and short-lived; the `state` parameter is echoed back (OAuth 2.1) | MCPAUTH |

## Connector: tools, behaviour, listing

| # | Requirement | Source |
|---|---|---|
| C1 | Every tool has `title` and `readOnlyHint: true` or `destructiveHint: true`. Read and write are separate tools. Names are at most 64 chars | CHECK, SUBMIT |
| C2 | Descriptions say what the tool does. They give no instructions to Claude, no calls to other tools, no promotion, and nothing hidden | CHECK |
| C3 | Valid calls succeed. Errors are actionable (no bare "Internal Server Error"). Responses are reasonably sized. No conversation-data collection | CHECK |
| C4 | The server calls first-party APIs, and the MCP domain should match the service | CHECK |
| C5 | Not accepted: moving money or crypto, or AI media generation | CHECK |
| C6 | Test credentials for a **fully populated** account, plus step-by-step instructions | CHECK, TEST |
| C7 | Test every tool in MCP Inspector **and** as a custom connector in Claude (confirmed on the Test & launch step) | CHECK, SUBMIT |
| C8 | Listing fields: name ≤ 100, **one-liner ≤ 200**, description ≤ 2,000, 1–5 categories, docs URL, privacy URL, support contact, icon, slug (permanent) | SUBMIT |
| C9 | Portal steps: Connection (Universal URL), Tools (synced from the server), Listing, Use cases, Company, Authentication, Data handling, Test & launch, Compliance (7 acknowledgements), Review | SUBMIT |
| C10 | A paid plan (Pro/Max/Team/Enterprise). On Team/Enterprise an Owner submits | PUB |
| C11 | Don't gate behaviour on the exact `clientInfo`; it is unauthenticated | TEST |
| C12 | Submit the server as a connector even when a plugin already references it, then pair the two | PUB |

## Plugin

| # | Requirement | Source |
|---|---|---|
| P1 | `.claude-plugin/plugin.json` with `name` (lowercase letters, digits and hyphens, ≤ 64, not reserved or generic, permanent), plus `displayName`, `version`, `description`, `author` and `license` | PBUILD, PCHECK |
| P2 | `README.md` of ≥ 40 words outside code blocks, saying what the plugin does, how to use it and what data it sends. A `LICENSE` file or `license` field | PCHECK |
| P3 | `.mcp.json` entries use `type: "http"` and an absolute `https://` URL, with no secrets | PCHECK |
| P4 | Skills live at `skills/<name>/SKILL.md` with valid YAML front matter; `description` is a single string written as user situations; the folder name equals `name`. Commands live at `commands/*.md` with a `description` | PBUILD, PCHECK |
| P5 | Non-image files < 256 KiB; ≤ 512 files; only text and PNG/JPEG/GIF/WebP/SVG; no `.DS_Store`; no symlinks, submodules or LFS; no top-level `bin/` | PCHECK, PBUILD |
| P6 | No package launchers, lockfiles or credentials. Plugin at the repo root avoids "Scripts the validator couldn't follow" holds | PCHECK |
| P7 | `claude plugin validate ./plugin` prints `✔ Validation passed` (syntax only). The portal's **Validate** runs the directory checks | PCHECK |
| P8 | The repo must be public before the listing goes live; the connected GitHub account must be able to push to it | PSUBMIT |
| P9 | Raise `version` on every release | PSUBMIT |
| P10 | Test with `claude --plugin-dir`, then a zip uploaded via Customize > Plugins > Add > Upload plugin. Use `claude plugin eval` for with/without comparisons | PBUILD |

## Protocol version

- The current MCP revision is **2026-07-28** (stateless: `_meta` version on every request, plus `server/discover`). It keeps backward compatibility with the initialize-based revisions (≤ 2025-11-25) [MCPVER].
- `@modelcontextprotocol/sdk` 1.30.1 (installed; latest 1.x, 2026-09-23) and the new scoped v2 packages (`@modelcontextprotocol/server` 2.1.0) both top out at `2025-11-25`, checked in their shipped `SUPPORTED_PROTOCOL_VERSIONS`. See DECISIONS DD2.

## Where the spec and the docs differ

1. **Tagline limit.** The spec says ≤ 55; the portal's one-liner allows ≤ 200 [SUBMIT]. We keep ≤ 55, which satisfies both, and the check script enforces the stricter limit.
2. **Protocol.** The spec says "upgrade if Claude and the SDK support 2026-07-28". No SDK release supports it yet, so we stay on 2025-11-25.
3. **Audience binding (RFC 8707)** is not in the spec but is a MUST in [MCPAUTH]. Tokens are bound to the `resource` and checked at `/mcp`.
4. **Step-up with 403 `insufficient_scope`** [LAZY] replaces a plain tool error for write tools called with a read-only token.
5. **The connector privacy-policy rule** in [SUBMIT] is written for *local* connectors. The listing still asks for a privacy URL, so we ship one.
6. **Client profile detection.** The spec suggests `clientInfo`, but [TEST] says not to gate on it. We pick the markdown profile from the **auth type** (OAuth, i.e. a chat client, versus a static bearer, i.e. voice).
7. **Categories.** The docs don't publish the category list. The kit proposes likely values, and the owner picks the closest ones in the portal.
