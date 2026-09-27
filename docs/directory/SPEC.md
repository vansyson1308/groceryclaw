# SPEC 04: ShopVoice on the Claude Directory (MCP connector + plugin bundle)

| | |
|---|---|
| Goal | List **ShopVoice** in Anthropic's Claude directory as (1) a remote **MCP connector** and (2) a paired **plugin bundle**, so any Claude user (claude.ai web/desktop/mobile, Cowork, Claude Code) can run a small shop's inventory, sales and reorders from a conversation |
| Base repo | https://github.com/vansyson1308/groceryclaw (public, MIT). ShopVoice already exists in `apps/mcp-server` (Streamable HTTP, 9 tools with annotations, per-tenant bearer auth, RLS, audit log, tests) and `apps/alexa-sim` |
| Submission portal | https://claude.ai/directory/manage (owner submits; agent prepares everything) |
| Docs this spec is based on (read them again, they are the source of truth) | Publish: https://claude.com/docs/directory/publish · Connector checklist: https://claude.com/docs/connectors/building/review-criteria · Connector submission fields: https://claude.com/docs/connectors/building/submission · Auth: https://claude.com/docs/connectors/building/authentication · Lazy auth: https://claude.com/docs/connectors/building/lazy-authentication · Testing: https://claude.com/docs/connectors/building/testing · Plugin structure: https://claude.com/docs/plugins/build · Plugin checklist: https://claude.com/docs/plugins/pre-submission-checklist · Plugin submit: https://claude.com/docs/plugins/submit · Manifest reference: https://code.claude.com/docs/en/plugins/manifest-reference |
| Deadlines | Directory submission ready by **Oct 12, 2026**. Must not break the Amazon Devpost entry (deadline **Oct 24, 02:00 Vietnam time**); the deployment built here also unblocks that entry |

---

## 0. Owner actions (Việc anh Sơn phải tự làm)

1. **AWS**: tạo IAM user `shopvoice-deploy` (không dùng Root), cấp quyền đủ cho CDK deploy (CloudFormation, EC2, ECR, CloudFront, SSM, IAM role, CloudWatch Logs) và Bedrock/Polly; tạo access key → đưa agent qua biến môi trường. Credit $150 đã nạp.
2. **Tên miền (khuyến nghị mạnh)**: mua một domain ~$10/năm (ví dụ `shopvoice.app` hoặc tương tự), trỏ DNS theo hướng dẫn agent để lại. Anthropic yêu cầu domain của MCP server "khớp với dịch vụ của bạn"; dùng domain mặc định của CloudFront/Railway dễ bị đánh giá thấp. Nếu chưa mua, agent vẫn làm được trên domain CloudFront rồi đổi sau.
3. **Email hỗ trợ**: chọn một địa chỉ để làm "support contact" (ví dụ sonnv.hd34@gmail.com hoặc support@<domain>).
4. **Repo plugin**: tạo repo public rỗng `vansyson1308/shopvoice-plugin` trên GitHub (agent sẽ đẩy nội dung vào, giống cách đã làm với `kiotviet-mcp`).
5. **Kiểm tra quyền nộp**: mở https://claude.ai/directory/manage xem có nút **Submit new** không (cần gói trả phí; nếu cổng yêu cầu Team/Enterprise thì báo lại).
6. **Nộp bài** theo `docs/directory/SUBMISSION_KIT.md` mà agent chuẩn bị: 2 lần nộp (MCP connector trước, plugin bundle sau), rồi bấm Publish khi Approved.

---

## 1. Current state (verified 2026-09-27) and the gaps

| Directory requirement | ShopVoice today | Gap |
|---|---|---|
| Public `https://` remote MCP, Streamable HTTP | Server exists, verified locally; AWS CDK synthesised, **not deployed** (no AWS creds) | Deploy (§5) |
| **OAuth 2.0 for authenticated services** (DCR and/or CIMD, PKCE S256, `https://claude.ai/api/mcp/auth_callback`, loopback redirects for Claude Code) | Static per-tenant bearer tokens only | **Build an OAuth 2.1 authorization server** (§3). Keep bearer tokens for Alexa-sim and as `static_headers` fallback |
| Every tool has `title` + `readOnlyHint` / `destructiveHint`; read and write tools separated | Done (READ_ONLY on read tools; `create_reorder_draft` = write, non-destructive; `confirm_reorder` = `destructiveHint: true`) | None (keep) |
| Actionable errors, reasonable response sizes, no conversation-data collection | Mostly (spoken safe errors) | Review for Claude (not voice) clients (§4) |
| Test credentials for a **fully populated account** | Demo seed "Corner Mart" exists | Reviewer account on the public deployment (§6) |
| Public documentation, privacy policy, support contact, icon | Missing | Build docs site pages (§6) |
| Origin validation must not block Claude | Already allows requests with no `Origin` | Add a regression test for server-to-server calls; document Anthropic egress `160.79.104.0/21` |
| Plugin bundle: `.claude-plugin/plugin.json`, skills, `.mcp.json` (URL only, no secrets), README ≥ 40 words, LICENSE, public repo | Missing | Build `plugins/shopvoice/` → push to `vansyson1308/shopvoice-plugin` (§7) |

Product positioning: ShopVoice is **GroceryClaw's first-party API** for independent grocery / convenience stores (inventory, sales, supplier invoices, reorders). The server calls only GroceryClaw's own database and APIs (the directory's API-ownership rule). The KiotViet integration is optional background sync and **must not** be the connector's tool surface.

## 2. Target architecture

```
Claude (web/desktop/mobile/Cowork/Code) ──HTTPS──▶ https://<domain>/mcp   (MCP, Streamable HTTP)
         │ 401 + WWW-Authenticate(resource_metadata)                │
         ▼                                                          ▼
https://<domain>/.well-known/oauth-protected-resource        apps/mcp-server (existing tools)
https://<domain>/.well-known/oauth-authorization-server      ├─ OAuth bearer → tenant resolver (NEW)
https://<domain>/oauth/{authorize,token,register,revoke}     └─ static bearer (existing, Alexa-sim / static_headers)
https://<domain>/{docs,privacy,terms,support}  (static pages)
Postgres (RLS) ◀── same data layer, new tables: oauth_clients, oauth_codes, oauth_tokens, web_accounts
```

Keep one codebase, one deployment. New code lives in a new package `apps/mcp-server/src/oauth/` (or `packages/oauth` if cleaner), plus a migration `db/v2/migrations/018_v2_oauth.sql` (+ rollback), following existing RLS / conventions.

## 3. OAuth 2.1 authorization server (MVP, must ship)

Implement to the MCP authorization spec (2025-11-25) **and** Claude's specifics in the Auth doc:

1. **Protected resource metadata** (RFC 9728) at `/.well-known/oauth-protected-resource` (and the path-suffixed variant `/.well-known/oauth-protected-resource/mcp`): `resource` = exact MCP URL (`https://<domain>/mcp`), `authorization_servers: ["https://<domain>"]`, `scopes_supported: ["shop.read", "shop.write", "offline_access"]`.
2. **401 handshake**: any unauthenticated `/mcp` request → `401` with `WWW-Authenticate: Bearer resource_metadata="https://<domain>/.well-known/oauth-protected-resource", scope="shop.read shop.write"`. Never a 200 with an error body.
3. **Authorization server metadata** (RFC 8414) at `/.well-known/oauth-authorization-server`: issuer, `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `revocation_endpoint`, `code_challenge_methods_supported: ["S256"]`, `grant_types_supported: ["authorization_code","refresh_token"]`, `response_types_supported: ["code"]`, `token_endpoint_auth_methods_supported: ["none","client_secret_post"]`, `client_id_metadata_document_supported: true`, `scopes_supported`.
4. **CIMD** (preferred by Anthropic for directory traffic): accept a `client_id` that is an HTTPS URL, fetch and validate the metadata document (cache, size/time limits, SSRF guard: reuse `ssrf-fetcher` patterns already in repo), require `redirect_uri` to be listed in it. Claude Code's CIMD: `https://claude.ai/oauth/claude-code-client-metadata`.
5. **DCR** (RFC 7591) at `/oauth/register`, `application/json`, public clients (`token_endpoint_auth_method: none`), rate-limited, with cleanup of unused registrations after 30 days.
6. **Redirect URIs**: exact match for `https://claude.ai/api/mcp/auth_callback`; loopback `http://127.0.0.1/callback` and `http://localhost/callback` matched **port-agnostically** (RFC 8252). Reject everything else not registered.
7. **PKCE S256 mandatory**; `state` echoed; authorization codes single-use, 60 s TTL, bound to client + redirect + PKCE.
8. **Token endpoint** accepts `application/x-www-form-urlencoded`; returns opaque access tokens (hashed at rest, 1 h TTL) + **rotating refresh tokens** (30 days, old one invalidated in the same response; reuse detection revokes the family); RFC 6749 errors (`invalid_grant` etc.). Respond well under 10 s.
9. **Login + consent UI** (server-rendered HTML, no heavy framework, mobile-friendly, EN + VI):
   - Sign in with email + password (scrypt via `node:crypto`, no new deps) **or** sign up.
   - **New sign-ups get their own sandbox shop** populated from the deterministic demo seed (so every new user and every reviewer immediately sees realistic data). Clearly labelled "Demo shop (sample data)". Real shops: link an existing GroceryClaw tenant via the existing invite-code flow.
   - Consent screen shows the client name and **redirect URI hostname** clearly (spec requirement), requested scopes, and Allow / Deny. Extra warning when only loopback redirects are registered.
   - CSRF protection, secure cookies, login rate limiting, generic auth errors.
10. **Token → tenant**: `/mcp` resolves an OAuth access token to `(tenant_id, user_id, scopes)` and runs every query through `runTenantScopedTransaction` (same as bearer path). `shop.write` is required for `create_reorder_draft` / `confirm_reorder`.
11. **Revocation** endpoint (RFC 7009) and an account page to see/revoke connected apps.
12. Keep existing static bearer auth working unchanged (Alexa-sim, e2e scripts, Devpost demo). Document it as the `static_headers` option for org admins.

Tests (node:test, `tests/v2/oauth-*.test.mjs`, no network): metadata documents; 401 shape; DCR; CIMD fetch/validation/SSRF; redirect matching incl. loopback ports; PKCE failure cases; code reuse; refresh rotation + reuse detection; form-urlencoded token requests; scope enforcement on write tools; tenant isolation via OAuth tokens; sandbox-shop provisioning.

## 4. MCP server changes for Claude clients

- **Protocol versions**: keep `2025-11-25` working (Devpost evidence). Check whether Claude now negotiates the newer spec (**2026-07-28, "MCP 2.0", stateless**) and whether `@modelcontextprotocol/sdk` has a release supporting it. If yes, upgrade and support both; prefer **stateless** request handling (no server-side session requirement) so any instance behind the load balancer can answer. Record the decision in `DECISIONS.md`.
- **Origin rule** (already correct: no `Origin` → allowed): add a regression test; document Anthropic egress `160.79.104.0/21`. CloudFront origin-verify secret stays.
- **Client profile**: tool text today is optimised for speech (≤ 35 words). For Claude chat keep the same tools but add a concise markdown summary in `content` when the client is not the voice simulator (detect by auth type or `clientInfo`), always keeping `structuredContent` + `outputSchema`.
- **Reorder flow in Claude**: `create_reorder_draft` (write, non-destructive) returns the draft id and a short-lived confirmation reference usable by the model (today the Alexa-sim host holds the token outside the model; Claude has no such host, so add a Claude-client path); `confirm_reorder` already has `destructiveHint: true`, so Claude asks the user before running it. Keep TTL + tenant binding + single use. Never expose raw secrets.
- **Tool descriptions**: describe only what each tool does; no instructions to Claude, no promotion (prompt-injection rules). Names ≤ 64 chars.
- **Errors**: every failure returns an actionable, specific message (never bare "Internal Server Error").
- **Server `instructions`** field: 2–3 neutral sentences on what ShopVoice is and currency/units conventions.
- Optional stretch (only after MVP): **MCP Apps** UI (interactive low-stock table + reorder form) per https://claude.com/docs/connectors/building/mcp-apps/getting-started. If shipped, produce 3–5 PNG carousel screenshots ≥ 1000 px wide, cropped to the app response, with their prompts.

## 5. Deployment (production-grade, cheap)

- Use the existing CDK app in `infra/aws/` (EC2 + docker compose + CloudFront + SSM + CloudWatch). Region per owner creds. Add: the OAuth routes, static pages, `NODE_ENV=production`, backups of Postgres (daily `pg_dump` to S3, 7-day retention), CloudWatch alarms (5xx rate, health check).
- Custom domain (if owner bought one): ACM certificate in us-east-1 for CloudFront, alias records; `resource`/`issuer` URLs use the custom domain. Fallback: CloudFront domain, switchable by one env var.
- `/.well-known/*` must be served at the domain root through CloudFront (check cache behaviours don't strip them).
- Health: `/healthz`, `/readyz`. Target p95 < 800 ms for tools, < 2 s for OAuth endpoints.
- Record the deployed URLs in `docs/directory/DEPLOYMENT.md` and in the Devpost docs (this also completes the Amazon entry's "deployed" evidence: run `scripts/demo/inspector_evidence.mjs --label deployed`).

## 6. Listing assets and public pages (agent produces all of them)

Served from the deployment (plain HTML, EN with VI toggle) and committed under `apps/mcp-server/public/`:
- `/docs`: what ShopVoice is, who it is for, how to connect in Claude (directory + custom connector URL), each tool with an example prompt, the two-step reorder safety model, limits, FAQ, changelog. This is the **documentation URL**.
- `/privacy`: data collected (account email, shop data you enter or sync, tool-call audit log), purpose, storage location/region, retention (audit 90 days; deletion on request within 30 days), third parties (AWS hosting; optional KiotViet sync only if the shop enables it; **no data sold, no model training**), security, contact. This is the **privacy policy URL**.
- `/terms`, `/support` (support email + response time).
- **Icon**: square SVG + 512×512 PNG, simple, original (no Amazon/Alexa/Anthropic marks).
- `docs/directory/SUBMISSION_KIT.md`, ready to paste, respecting the portal's limits:
  - **Connector**: server URL; transport (Streamable HTTP); URL option = Universal URL; server name (≤ 100); tagline (≤ 55); description (≤ 2,000); 1–5 categories; docs URL; privacy URL; support contact; icon; slug proposal; use cases; what users need before connecting ("a free ShopVoice account; a sandbox shop is created on sign-up"); reads + writes; company fields (owner as individual developer); auth type = OAuth (**CIMD + DCR**); data handling (first-party API; no health data; no sponsored content); **Test & launch** instructions with reviewer credentials (a dedicated reviewer account with a fully populated shop; password generated at deploy time and stored only in `.env`/SSM, placeholder in the kit); confirmation that every tool was run via MCP Inspector and as a custom connector in Claude; notes for the seven compliance acknowledgments (esp. "financial transactions": ShopVoice creates **purchase-order drafts/confirmations inside the shop's own records; it never moves money**).
  - **Plugin**: repo URL, branch `main`, path `/` (plugin at repo root), listing texts, pairing note with the connector.
- `docs/directory/REVIEWER_WALKTHROUGH.md`: 5 prompts a reviewer can paste in Claude and what each should return.

## 7. Plugin bundle `shopvoice` (MVP, must ship)

Build in `plugins/shopvoice/` in groceryclaw, then push to the owner-created public repo `vansyson1308/shopvoice-plugin` with the **plugin folder at the repo root** (avoids subfolder validation holds), same way `kiotviet-mcp` was published (`git subtree split` or a clean export with a CI workflow).

```
shopvoice-plugin/
├── .claude-plugin/plugin.json     # name "shopvoice" (permanent), displayName "ShopVoice", version, description, author {name, url}, license "MIT", homepage (docs URL), repository, keywords
├── .mcp.json                      # {"mcpServers":{"shopvoice":{"type":"http","url":"https://<domain>/mcp"}}}  (no secrets)
├── skills/
│   ├── shop-morning-briefing/SKILL.md   # daily briefing: yesterday's sales vs same weekday, low stock, pending invoices
│   ├── restock-planner/SKILL.md         # suggest → draft → explicit user "yes" → confirm; never confirm without it
│   ├── sales-insights/SKILL.md          # top/slow movers, period comparisons, simple actionable advice
│   └── supplier-invoices/SKILL.md       # invoice status, what's missing, follow-ups
├── commands/briefing.md, commands/restock.md   # load as skills in chat, slash commands in Cowork/Code
├── README.md                      # ≥ 40 words: what it does, how to use, what data it sends (to <domain> only), link to privacy policy
└── LICENSE                        # MIT
```

Rules (from the plugin checklist): valid YAML front matter with a single-string `description` written as user situations; folder name = skill `name`; no `bin/`, no hooks, no local servers, no package launchers, no lockfiles, no binaries other than PNG/SVG images, every file < 256 KiB, no `.DS_Store`; no credentials anywhere; name not generic/reserved; `version` bumped each release. Skills must be bilingual-friendly (answer in the user's language, VND formatting for Vietnamese shops).

Quality: write `evals/` cases and run `claude plugin eval` (if Claude Code is available in the environment) comparing with/without the plugin; save results to `docs/directory/PLUGIN_EVAL.md`. Run `claude plugin validate .` → must print `✔ Validation passed`. Load-test the plugin locally with `claude --plugin-dir ./plugins/shopvoice` against the deployed server. Produce a zip `shopvoice-plugin.zip` for **Customize > Plugins > Upload plugin** testing by the owner.

## 8. Verification (Definition of Done)

- [ ] `npm run typecheck && npm run lint && npm test` green; new OAuth/MCP tests included; real counts reported.
- [ ] Deployed public HTTPS; `/.well-known/*` reachable; 401 handshake correct (`curl -i`).
- [ ] **End-to-end OAuth** proven with MCP Inspector (OAuth flow) against the deployed URL; screenshots in `docs/directory/evidence/`.
- [ ] Every tool called successfully on the deployed server with the reviewer account (Inspector CLI JSON saved).
- [ ] Custom-connector test in Claude: the agent writes exact steps for the owner (Customize > Connectors > Add custom connector → URL → sign in → run the 5 reviewer prompts) in `docs/directory/OWNER_CLAUDE_TEST.md`; mark as owner-verified only after the owner confirms.
- [ ] Plugin: `claude plugin validate` passes; README/LICENSE present; `.mcp.json` points to the deployed URL; repo pushed.
- [ ] Docs, privacy, terms, support pages live; icon committed; `SUBMISSION_KIT.md` complete with character counts checked by a script.
- [ ] Alexa-sim + e2e voice flow still pass (Devpost entry unaffected). `DEVPOST_SUBMISSION.md` updated: deployed URLs, "also available as a Claude connector and plugin (submitted to the Claude directory)" plus evidence. Do **not** claim "listed"/"published" until the owner sees **Published** in the portal.
- [ ] No secrets in git (scan history of new commits); `.env.example` and `docs/ops/SECRETS.md` updated.

## 9. Milestones

| Date (2026) | Deliverable |
|---|---|
| Sep 28–Oct 1 | Migration 018, OAuth server (metadata, DCR, CIMD, authorize/consent, token, refresh, revoke) + tests |
| Oct 2–4 | MCP changes (origin rule, client profile, confirm destructive, protocol check); sandbox-shop provisioning |
| Oct 5–7 | Deploy (CDK) + domain + pages + icon; Inspector OAuth evidence; reviewer account |
| Oct 8–10 | Plugin bundle, validate, evals, push to `shopvoice-plugin`; SUBMISSION_KIT; owner Claude test |
| Oct 11–12 | Owner submits connector, then plugin; update Devpost docs |
