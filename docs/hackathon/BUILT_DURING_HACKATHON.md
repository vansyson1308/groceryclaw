# What was built during the submission window

**Project:** ShopVoice, an Alexa+ MCP server for small grocery owners, built on the pre-existing GroceryClaw repository.
**Submission window:** starts 2026-09-01.
**Baseline:** commit `a9f3cdb2a385b68bc2c7bb82c61a8e57fbee5c57` (2026-03-31 12:03 +0700), the last commit before the window. It is tagged `pre-hackathon-baseline`; the tag must be pushed by the owner, see BLOCKERS.md B1.

Regenerate the numbers with:
```bash
git diff --shortstat a9f3cdb..HEAD
git diff --stat a9f3cdb..HEAD -- . ':!**/package-lock.json'
git log --oneline a9f3cdb..HEAD
```

## Numbers (at commit `4a62424`, 2026-09-26)

- `git diff --shortstat a9f3cdb..4a62424`: **148 files changed, 15,170 insertions(+), 1,014 deletions(-)**
- Excluding the three `package-lock.json` files: **146 files changed, 13,595 insertions(+), 1,014 deletions(-)**
- 13 commits since baseline:
  - features: `a3c15aa` (db) → `071de84` (mcp) → `8542858` (sim) → `f6f30d5` (aws) → `5cb0d83` (oss) → `ea6d9e9` (demo);
  - Phase 9 docs: `1175e6b`, `c07c3d4`;
  - CI repair: `bbff291`, `95a191e`, `c3259a1`, `4a62424`, plus docs `61f2734`.
- Most of the deletions come from the CI repair, which rewrote stale Zalo-era tests and CI gates for the Telegram gateway (see below).

## What existed before (not claimed)

The GroceryClaw V2 data plane already existed before the window:
- Telegram/Zalo gateway, BullMQ worker (invoice OCR/XML/Excel → KiotViet purchase orders), admin API, Telegram mini-app.
- Postgres migrations 001–016 with row-level security.
- `packages/common` (`runTenantScopedTransaction`, logger, rate limiter).
- `product_cache` with pg_trgm search.

## What is new (all built during the window)

| Area | New work | Key paths |
|---|---|---|
| Data | Migration 017: shop profile, suppliers, stock levels, reorder rules, daily sales, purchase-order drafts, voice audit log, MCP access tokens (all with forced RLS); `resolve_mcp_access_token()`; deterministic demo seed generator plus the "Corner Mart Demo" seed (60 products, 5 suppliers, 91 days of sales, 4 low items, 3 invoices); `--demo` seed flag; token minting | `db/v2/migrations/017_v2_inventory_sales.sql`, `db/v2/seed/002_demo_shop_seed.sql`, `scripts/v2/gen_demo_seed.mjs`, `scripts/v2/db_v2_seed.mjs`, `scripts/v2/create_mcp_token.mjs` |
| MCP server | New app. Streamable HTTP on raw `node:http` with the official SDK (protocol 2025-11-25). Per-tenant bearer auth, sessions bound to a tenant, Origin validation, rate limits, CloudFront origin-verify gate. 9 voice-first tools with `outputSchema` and annotations, a `morning_briefing` prompt, a `shop://profile` resource, audit logging. Postgres store (RLS) and in-memory store. | `apps/mcp-server/` |
| Voice simulator | New app: push-to-talk web UI, Bedrock Converse tool-use agent acting as an MCP client, Polly speech, host-held confirmation tokens, offline fallbacks | `apps/alexa-sim/` |
| Shared code | Product search moved into `@groceryclaw/common`, plus a voice-oriented variant (the miniapp re-exports it unchanged) | `packages/common/src/product-search.ts` |
| AWS | CDK app (EC2 + docker compose + 2× CloudFront + SSM + IAM + CloudWatch Logs), deploy, teardown and smoke scripts, ops image | `infra/aws/`, `scripts/aws/` |
| Open source | `kiotviet-mcp`, a standalone MIT package (KiotViet Public API client, voice-first tools, two-step purchase orders, stdio/HTTP CLI); drafted example PR for the MCP TypeScript SDK | `oss/kiotviet-mcp/`, `docs/hackathon/oss/` |
| Tests | 60+ new tests: MCP protocol/auth/origin/rate-limit, tool contracts, speech rules, RLS isolation, Postgres tool flows, simulator safety, e2e voice flow, seed determinism, OSS package | `tests/v2/mcp-*.test.mjs`, `tests/v2/alexa-sim.test.mjs`, `tests/v2/shopvoice-seed.test.mjs`, `tests/v2/db/shopvoice-rls.test.mjs`, `tests/v2/db/mcp-tools-db.test.mjs`, `oss/kiotviet-mcp/test/` |
| Demo and evidence | e2e voice flow, latency probe, MCP Inspector evidence script and screenshots, video pipeline (Playwright + Polly + ffmpeg) | `scripts/demo/`, `demo/video/`, `docs/hackathon/evidence/` |
| Docs | README section, architecture diagram, AWS services, decisions, friction and feedback logs, runbooks | `README.md`, `docs/hackathon/` |

## Small fixes to pre-existing code, made because the new work needed them

- `scripts/v2/db_v2_lib.mjs` and `scripts/v2/remote_migrate.mjs` now accept migrations 014–016, which were committed without `-- migrate:up/down` markers. `db:v2:migrate` previously failed on a fresh database.
- `db/v2/seed/001_dev_seed.sql` was updated for the 012 `zalo_users` → `platform_users` rename.
- `apps/miniapp/src/routes/search.ts` now re-exports the moved search functions; behaviour is unchanged.

## CI repair (pre-existing breakage on `main`, fixed during the window)

`v2-ci` on `main` had been timing out since the Zalo → Telegram migration (`fd7eef7`, March 2026). Many tests and CI gates still targeted the removed `/webhooks/zalo` route and the `zalo_users` table, which was renamed to `platform_users`. Some of these tests also leaked child servers after a failed assertion, so the job hung until the time limit.

Commits `bbff291`, `95a191e`, `c3259a1` and `4a62424` fix it:
- They port those tests and gates (unit, DB, Redis, E2E compose, load, smoke) to the Telegram gateway.
- They add a test harness that always stops spawned servers.
- They run DB test files serially.
- They add `TELEGRAM_API_BASE_URL` so the E2E gate can use a Bot API stub.

Only two changes touch pre-existing app code:
- the gateway's test-adapter path for invite redemption;
- the worker's configurable Bot API root.

Details are in STATUS.md and BLOCKERS.md B3.
