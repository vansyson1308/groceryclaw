# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GroceryClaw is a multi-tenant SaaS platform for Vietnamese grocery stores ("tạp hóa"). It receives Zalo messages via webhook, processes invoices (text, image/OCR, XML), syncs with KiotViet POS, and sends notifications back through Zalo OA. There is a legacy MVP (n8n-based, `src/logic/`, root `docker-compose.yml`) and a V2 architecture (TypeScript monorepo under `apps/` and `packages/`).

## Architecture

**Monorepo structure** (npm workspaces):
- `packages/common` — shared library (`@groceryclaw/common`): config, Postgres/Redis clients, BullMQ wrapper, webhook auth, rate limiting, crypto, logging, notification templates
- `apps/gateway` — HTTP server (port 8080) receiving Zalo webhooks at `POST /webhooks/zalo`, with `/healthz`, `/readyz`, and `/metrics` endpoints. Resolves tenant membership, handles invite codes, deduplicates messages, and enqueues BullMQ jobs
- `apps/worker` — BullMQ consumer processing jobs: `PROCESS_INBOUND_EVENT`, `PROCESS_IMAGE_INVOICE`, `CHATBOT_REPLY`, `NOTIFY_USER`, `FLUSH_PENDING_NOTIFICATIONS`, `LEGACY_FORWARD_INBOUND`. Integrates with KiotViet API and Zalo OA API
- `apps/admin` — Internal admin API (port 3001) with OIDC auth + RBAC. Tenant management, invite code generation, secret rotation

**Data flow**: Zalo webhook → Gateway (auth, dedup, tenant resolution) → BullMQ queue in Redis → Worker (process, OCR, map products, sync KiotViet, notify user)

**Database**: PostgreSQL 16 with Row-Level Security (RLS). Tenant isolation via `SET LOCAL app.current_tenant`. Migrations in `db/v2/migrations/` (numbered SQL files). The `resolve_membership_by_platform_user_id` and `consume_invite_code` are key DB functions.

**Legacy MVP**: `src/logic/` has standalone JS modules (pricing, unit conversion, Zalo signature/token). Root `docker-compose.yml` runs Postgres + n8n. Legacy tests use `node --test src/logic/*.test.js`.

## Build & Development Commands

```bash
npm run build              # TypeScript build (tsc -b tsconfig.build.json)
npm run typecheck          # Same as build, type-check only
npm run lint               # Custom linter (tools/v2/lint.mjs)
npm run format:check       # Format check (tools/v2/format-check.mjs)
npm run sql:guard          # SQL interpolation guard (tools/v2/sql-interpolation-guard.mjs)
npm test                   # Build + run all V2 unit tests (node --test tests/v2/*.test.mjs ...)
```

Run a single test:
```bash
node --test tests/v2/<test-file>.test.mjs
```

Run legacy unit tests:
```bash
node --test src/logic/*.test.js
```

## Database Commands

```bash
npm run db:v2:migrate      # Apply V2 migrations
npm run db:v2:rollback     # Rollback last migration
npm run db:v2:status       # Show migration status
npm run db:v2:seed         # Seed test data
npm run db:v2:test:rls     # RLS integration tests (requires running Postgres)
npm run db:v2:test:bootstrap  # Bootstrap function tests (requires running Postgres)
npm run test:v2:db:real    # Real Postgres tenant transaction tests
```

## Docker / Local Stack

V2 local stack (Postgres, Redis, Gateway, Admin, Worker):
```bash
npm run v2:up              # Build and start V2 compose stack
npm run v2:down            # Stop V2 stack
npm run v2:reset           # Stop + destroy volumes
npm run v2:smoke           # Run smoke tests against running stack
npm run e2e                # Full E2E integration gate (spins up its own compose)
```

Env files: `infra/compose/v2/.env.example` → copy to `infra/compose/v2/.env`

Legacy stack: `docker compose up -d` (root docker-compose.yml, Postgres + n8n)

## CI Pipeline (V2)

Defined in `.github/workflows/v2-ci.yml`. Runs on push to `main`/`work` and PRs:
1. lint → format:check → typecheck → sql:guard
2. Unit tests
3. Redis auth integration tests
4. Apply migrations → RLS tests → bootstrap tests → real DB tests
5. E2E integration gate
6. Load test (light) → performance SLO gate

## Key Conventions

- **TypeScript**: strict mode, ES2022 target, NodeNext modules. Output to `dist/` in each workspace.
- **Testing**: Node.js built-in test runner (`node --test`), test files are `.test.mjs` in `tests/v2/`.
- **No Express/Fastify**: Gateway and Admin use raw `node:http` `createServer`.
- **Multi-tenancy**: All tenant-scoped DB queries use `SET LOCAL app.current_tenant` in a transaction. Never bypass RLS.
- **Queue**: BullMQ over Redis. Queue name configurable via `BULLMQ_QUEUE_NAME` (default: `process-inbound`).
- **Imports**: V2 apps import from `packages/common/dist/index.js` (compiled output), not source TS.
- **Env vars**: See `.env.example` for full list. Key ones: `DATABASE_URL`/`DB_APP_URL`, `REDIS_URL`, `ZALO_OA_SECRET`, `INVITE_PEPPER_B64`.
- **Infra**: K8s manifests in `infra/k8s/` using Kustomize. Separate deployments for gateway, admin, worker.
