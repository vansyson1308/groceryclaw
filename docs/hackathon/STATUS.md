# ShopVoice — STATUS (agent memory across sessions)

Last updated: 2026-09-25. Branch: `claude/great-ritchie-094a7c` (see DECISIONS.md D1). Baseline: `a9f3cdb` (tag `pre-hackathon-baseline`, local only; see BLOCKERS.md B1).

## Resume protocol

1. Read this file, then `git status`, `git log --oneline -15`.
2. Local DB: `pg_ctlcluster 16 main start` (native Postgres 16; password `postgres`), `redis-server --daemonize yes`, `dockerd &` (Docker works after starting the daemon).
3. `export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/groceryclaw_v2 && npm run db:v2:migrate && DEMO_ANCHOR_DATE=2026-09-25 npm run db:v2:seed -- --demo`.
4. Continue from the first unchecked box below.

## Checklist

### Phase 0: setup and recon
- [x] Baseline tag created locally (push blocked, B1)
- [x] docs/hackathon/{SPEC,STATUS,DECISIONS,BLOCKERS,FEEDBACK_LOG,FRICTION_LOG}.md
- [x] Codebase map (below)
- [x] Local stack: native Postgres 16 + Redis run; migrations 001–017 apply (after fix D3)
- [x] Owner checkpoint A asked (license / AWS creds / Alexa+ access)

### Phase 1: data layer
- [x] `017_v2_inventory_sales.sql` with rollback (verified up → down → up)
- [x] `002_demo_shop_seed.sql` generated deterministically (60 products, 5 suppliers, 91 days, 4 low-stock, 3 invoices)
- [x] `--demo` flag on `db_v2_seed.mjs` (+ demo MCP token minting)
- [x] RLS isolation tests `tests/v2/db/shopvoice-rls.test.mjs` (7/7 pass against local PG)

### Phase 2: MCP server
- [x] `apps/mcp-server` workspace, tsconfig ref, Dockerfile (image builds + container smoke OK), compose service
- [x] Streamable HTTP `/mcp`, protocol `2025-11-25` verified by test (`tests/v2/mcp-http.test.mjs`)
- [x] Bearer auth per tenant (hashed tokens, session bound to tenant), Origin validation, rate limits, `/healthz`, `/readyz`

### Phase 3: tools
- [x] Read tools: get_low_stock, get_stock_level, get_sales_summary, get_top_movers, get_invoice_status, suggest_reorder
- [x] create_reorder_draft / confirm_reorder (5-minute token, hashed, never spoken, redacted in audit)
- [x] morning_briefing prompt, shop://profile resource (+ get_daily_briefing stretch tool)
- [x] ≤35-word speech + outputSchema + annotations on every tool; audit log (`voice_audit_log`)
- Tests: mcp-http 11, mcp-tools 16, mcp-speech 13 (no DB); db/mcp-tools-db 6 + db/shopvoice-rls 7 (Postgres)

### Phase 4: Alexa+ simulator
- [x] apps/alexa-sim UI (push-to-talk Web Speech API, typed fallback, tool-call panel, confirmation/confirmed cards, no Amazon marks) + /api/turn + BedrockBrain (Converse tool use, default `us.amazon.nova-2-lite-v1:0`) with RulesBrain fallback + Polly with browser-voice fallback. Host holds confirmation tokens (never in model context) and blocks confirm without a "yes".
- [x] scripts/demo/e2e_voice_flow.mjs: 5/5 PASS locally (memory backend and Postgres backend), rules brain. **Unverified with Bedrock** (B2).
- [x] Local latency (same host, Postgres, 160 calls): client p95 12.8 ms, server p95 8 ms (`docs/hackathon/evidence/latency-local-postgres.json`). Deployed p95 still to measure.

### Phase 5: AWS
- [x] CDK in infra/aws (EC2 + docker compose + 2x CloudFront + SSM + IAM + CloudWatch Logs), `cdk synth` OK; deploy.sh / teardown.sh / smoke.sh
- [x] AWS compose layout rehearsed locally in containers (origin-verify gate enforced, e2e 5/5 with Bedrock->rules fallback since creds are invalid)
- [x] MCP Inspector 2.8.0 evidence **against local server** (Postgres backend): connected + "MCP 2025-11-25" screenshot, tools list, tool result, CLI JSON for tools/list, tools/call, resources/read, prompts/get (`docs/hackathon/evidence/inspector-*-local-*`). Reusable: `scripts/demo/inspector_evidence.mjs --label deployed`.
- [ ] Deployed + Inspector evidence against the public URL: **blocked on B2 (AWS credentials)**
- [~] p95 latency: local 12.8 ms client / 8 ms server; deployed number pending B2
- [x] AWS_SERVICES.md

### Phase 6: open source
- [x] oss/kiotviet-mcp: standalone MIT package (KiotViet Public API client + 7 voice-first tools + two-step PO + stdio/HTTP CLI + demo shop), 4/4 tests, verified with Inspector CLI. Owner creates the public repo (B6).
- [x] SDK example PR draft: `docs/hackathon/oss/typescript-sdk-example/` (patch applies cleanly, example verified against SDK 1.30.1). Owner opens it.

### Phase 7: hardening
- [x] Rate limiting (per tenant + per-IP auth failures), safe spoken errors, origin-verify gate
- [x] README section "ShopVoice (Alexa+ MCP)" with quickstart A (Docker+Postgres) and B (no DB, verified verbatim) + Mermaid + PNG diagram (`docs/hackathon/architecture.png`)
- [~] DoD §8: see "Definition of Done" below

### Phase 8: video
- [x] demo/video pipeline (script.md, narration.json, cards/narrate/record/assemble, build.sh) rendered end to end: 151.5 s, 1920x1080 h264+aac (offline voices; Polly re-render needs B2). VIDEO_RUNBOOK.md written.

### Phase 9: submission
- [x] DEVPOST_SUBMISSION.md, BUILT_DURING_HACKATHON.md, draft PR vansyson1308/groceryclaw#25 open
- [ ] Owner checkpoint B hand-off (final message)

## Final test run (2026-09-25, commit 1175e6b + this update)

| Run | Tests | Pass | Fail | Cancelled | Skipped | Note |
|---|---|---|---|---|---|---|
| Baseline `a9f3cdb`, no DB | 156 | 131 | 11 | 2 | 12 | pre-existing failures |
| This branch before the CI fix (`c07c3d4`), no DB | 223 | 185 | 11 | 2 | 25 | the same 11 pre-existing failures; +67 tests |
| This branch after the CI fix (`c3259a1`), no DB | 226 | 201 | 0 | 0 | 25 | stale Zalo-era tests ported to Telegram; DB suites skip without `DATABASE_URL`; 8 s |
| This branch after the CI fix, with Postgres 16 (`DATABASE_URL`) | 226 | 221 | 0 | 0 | 5 | the 5 skips need Redis or the opt-in compose stack (run by later CI steps); about 14 s, 3 runs in a row |
| `oss/kiotviet-mcp` (`npm test`) | 4 | 4 | 0 | 0 | 0 | |

ShopVoice-only suites (mcp-http 12, mcp-tools 16, mcp-speech 13, alexa-sim 7, shopvoice-seed 6, db/mcp-tools-db 6, db/shopvoice-rls 7): **67/67 pass**.

## Definition of Done (spec §8) — evidence

| Item | State | Evidence |
|---|---|---|
| typecheck / lint pass | ✅ | `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run sql:guard` all pass |
| `npm test` passes | ✅ | 0 failures with and without `DATABASE_URL`, no hang, no leftover processes. Every v2-ci step also passes in a local replay on a fresh Postgres 16 cluster (BLOCKERS B3, now resolved). |
| New tests `tests/v2/mcp-*.test.mjs`: each tool's happy path, tenant isolation, token expiry, invalid input, ≤35 words | ✅ | mcp-http, mcp-tools, mcp-speech, db/mcp-tools-db, db/shopvoice-rls |
| MCP Inspector against the **deployed** URL | ⏳ B2 | Local run done (`docs/hackathon/evidence/inspector-local-*`); `scripts/demo/inspector_evidence.mjs --label deployed` is ready |
| e2e voice flow (5 utterances) | ✅ local / ⏳ deployed | 5/5 on memory and Postgres backends and on the AWS compose layout in containers; `scripts/aws/smoke.sh` for the deployed run |
| p95 tool latency < 800 ms | ✅ local / ⏳ deployed | 12.8 ms client, 8 ms server (local) |
| No secrets in the repo; `.env.example` + `docs/ops/SECRETS.md` updated | ✅ | Tokens only hashed in the DB; tests use obvious fake tokens |
| README "ShopVoice (Alexa+ MCP)" + quickstart + `start:mcp`, `start:alexa-sim`, `--demo` | ✅ | Quickstart B verified verbatim; A verified piecewise (Docker Hub limits in the sandbox) |
| Demo video rendered, < 3:00 | ✅ (placeholder voices) | 151.5 s, 1080p h264 |

## Codebase map (recon)

- Tenant-scoped DB access: `packages/common/src/pg.ts` `runTenantScopedTransaction` sets `app.current_tenant` via `set_config(..., true)`. RLS helper `_rls_tenant_id()` (migration 003) fails safe to NULL.
- Runtime DB role: `app_user` is a member of `groceryclaw_app_user` (migration 011). Policies in 006 have no `TO` clause; 012 recreated some with `TO groceryclaw_app_user`.
- Invoice tables: `canonical_invoices` / `canonical_invoice_items` (005), `resolved_invoice_items` + `sync_results` (006), `pending_confirmations` (014). `canonical_invoices.inbound_event_id` → `inbound_events.user_id` → `platform_users` (012 rename of `zalo_users`).
- `product_cache` (006, + `base_price` in 016, trigram index in 016): sku, barcode, product_name, unit, active. No quantities.
- Miniapp search: `apps/miniapp/src/routes/search.ts` `searchProducts` (pg_trgm `%` + `similarity`), `findByBarcode`.
- KiotViet adapter: `apps/worker/src/kiotviet-adapter.ts`.
- Migrations: `scripts/v2/db_v2_migrate.mjs` (psql or docker), checksum table `schema_migrations_v2`; remote: `scripts/v2/remote_migrate.mjs` (pg client).
- Lint: `tools/v2/lint.mjs` forbids explicit `any` in apps/packages TS; format check forbids trailing whitespace and tabs, and requires a final newline, across apps/packages/tests/docs.
- Types: repo uses `types-node-compat.d.ts` stubs; `@types/node` in node_modules is v14 (transitive via exceljs → fast-csv).

## Baseline test state (main @ a9f3cdb, before the CI fix)

Measured in an isolated worktree, no `DATABASE_URL`, `node --test --test-timeout=60000 …` (same globs as `npm test`):
**156 tests: 131 pass, 11 fail, 2 cancelled, 12 skipped.** Pre-existing failures (not touched by ShopVoice work):
canary-rollout (404 + hang without timeout), gateway-webhook (7), webhook-auth, worker-notifier, sql-parameterization-hotpaths.
Note: plain `npm test` on main hangs on canary-rollout (child servers not cleaned up after the 404 assertion).

With `DATABASE_URL` set (local PG, migrated through 017), full run: **217 tests: 187 pass, 21 fail, 4 cancelled, 5 skipped**.
All 21 failures + 4 cancellations are pre-existing: the same admin-auth/endpoints/secrets, real-tenant-transaction,
rls-runtime-role and invite-roundtrip tests fail identically on baseline code against the same DB (stale `zalo_users`,
admin audit-log path), plus the no-DB baseline failures above. Every ShopVoice test passes.

## Unverified / notes

- Nothing claimed as deployed. AWS calls unverified (B2).
