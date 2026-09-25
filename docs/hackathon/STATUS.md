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
- [ ] apps/alexa-sim UI + /api/turn + Bedrock agent (fake fallback) + Polly (fake fallback)
- [ ] scripts/demo/e2e_voice_flow.mjs

### Phase 5: AWS
- [ ] CDK in infra/aws, deploy.sh / teardown.sh
- [ ] Deployed + Inspector evidence (blocked B2)
- [ ] p95 latency measurement
- [ ] AWS_SERVICES.md

### Phase 6: open source
- [ ] oss/kiotviet-mcp package
- [ ] SDK example PR draft in docs/hackathon/oss/

### Phase 7: hardening
- [ ] DoD §8, rate limiting, safe spoken errors, README section + diagram

### Phase 8: video
- [ ] demo/video pipeline rendered, ffprobe duration < 3:00, VIDEO_RUNBOOK.md

### Phase 9: submission
- [ ] DEVPOST_SUBMISSION.md, BUILT_DURING_HACKATHON.md, PR opened

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

## Baseline test state (main @ a9f3cdb)

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
