# Implementation Direction Log — SaaS V2 (Option B)

## A) Vision & Non-goals (5–10 bullets)
- Build an async-first, multi-tenant SaaS runtime (Gateway + Queue + Workers + Admin) that serves 1000+ tenants through one Zalo OA with webhook ACK p95 under 200ms and heavy work offloaded to workers.
- Keep V2 additive and canary-by-tenant (`processing_mode`) using strangler migration; no destructive changes to legacy MVP paths.
- Enforce tenant isolation at the database layer from Beta using RLS on all tenant-scoped tables, with fail-safe behavior when tenant context is missing.
- Use invitation-gated onboarding with anti-brute-force controls (Gateway rate limit + DB lockouts) and leak-proof generic failures.
- Enforce strict security posture: Gateway as only public surface, fail-closed webhook auth, admin behind private network + OIDC/RBAC, and secrets via envelope encryption + versioning.
- Standardize identifiers: external boundary uses `platform_user_id`, internal relations use UUID `zalo_user_id` FK (`zalo_users.id`) and `tenant_id`.
- Ensure idempotency and replay safety at ingress (`UNIQUE(tenant_id, zalo_msg_id)`) and downstream jobs to prevent duplicate side effects.
- Respect Zalo interaction window policy by deferring outbound messages to `pending_notifications` when the window is closed.
- Non-goals in V2 Basic: owner web portal, OCR/AI parsing, multi-OA support, billing system, multi-region deployment, and ZNS template workflows.

## B) Core Components & Boundaries
- **Gateway**
  - **Responsibility:** Verify webhook authenticity, validate schema, resolve membership/invite bootstrap, enforce authz/rate limits, insert inbound event, enqueue jobs, fast ACK.
  - **Exposure:** **Public** (`POST /webhooks/zalo`, `GET /health` only).
  - **Trust boundary:** Internet edge; must fail closed and must not perform internet egress calls.
- **Workers (invoice-xml, mapping-resolve, kiotviet-sync, notifier)**
  - **Responsibility:** Async processing pipeline, mapping workflows, KiotViet sync, outbound Zalo notifications with interaction-window enforcement.
  - **Exposure:** **Private**.
  - **Trust boundary:** Internal trusted compute with controlled external egress (KiotViet/Zalo only, SSRF guarded).
- **Admin API/Tooling**
  - **Responsibility:** Tenant lifecycle, invite generation, secret rotation/revoke, DLQ/job ops, audit visibility.
  - **Exposure:** **Private** (VPN/private network + OIDC JWT + RBAC, with break-glass controls).
  - **Trust boundary:** Privileged operator plane, isolated credentials (`admin_reader` for cross-tenant audit).
- **Database (PostgreSQL)**
  - **Responsibility:** Source of truth, RLS enforcement, bootstrap functions, idempotency constraints, audit records.
  - **Exposure:** **Private**.
  - **Trust boundary:** Data isolation boundary; app roles are least-privilege (`app_user`, `admin_reader`, `bootstrap_owner`).
- **Queue (Redis/BullMQ)**
  - **Responsibility:** Decouple ingress from processing, retries/backoff, DLQ routing.
  - **Exposure:** **Private** (`requirepass`, private bind).
  - **Trust boundary:** Internal async bus; no external ingress.
- **Secrets subsystem (`secret_versions` + envelope crypto, Vault later)**
  - **Responsibility:** Versioned encrypted secret storage, decryption at worker runtime, rotation lifecycle.
  - **Exposure:** **Private**.
  - **Trust boundary:** Cryptographic boundary (MEK/DEK split, no plaintext persistence/logging).
- **Observability (logs/metrics/traces)**
  - **Responsibility:** Tenant-scoped operational visibility, SLOs, security eventing/alerts.
  - **Exposure:** **Private** (`/metrics` internal-only).
  - **Trust boundary:** Monitoring plane; must avoid secret leakage and public exposure.

## C) Data Model Highlights
- **Canonical IDs**
  - `tenants.id` (UUID) is the tenant FK in tenant-scoped entities and job envelopes.
  - `zalo_users.id` (UUID) is the only user FK (`zalo_user_id`) in relational tables.
  - `zalo_users.platform_user_id` (TEXT UNIQUE) is boundary identifier for inbound/outbound Zalo APIs and resolution input.
  - `tenant_users.id` (UUID) is membership identity and linkage for onboarding/admin actions.
- **Key tables**
  - Identity and access: `zalo_users`, `tenant_users`, `invite_codes`.
  - Processing: `inbound_events`, `jobs`, `idempotency_keys`, invoice/mapping tables.
  - Messaging: `pending_notifications` (window-closed deferred sends).
  - Security/audit: `secret_versions`, `audit_logs`, `admin_audit_logs`.
- **RLS strategy**
  - RLS enabled on all tenant-scoped tables with policies tied to `_rls_tenant_id()` reading `app.current_tenant` fail-safely.
  - Missing tenant context yields zero rows (fail-safe), not cross-tenant data or exceptions.
  - `app_user` is tenant-scoped only; `admin_reader` is dedicated for Admin cross-tenant audit reads.
- **Bootstrap functions summary**
  - `resolve_membership_by_platform_user_id()` (SECURITY DEFINER) resolves tenant/membership before tenant context is set.
  - `consume_invite_code()` (SECURITY DEFINER, atomic) handles normalization, peppered hash lookup, lockouts, one-time consume, and concurrency safety (`FOR UPDATE SKIP LOCKED`) with generic failure outputs.

## D) Critical Flows (Sequence)
- **Ingress webhook → enqueue → worker parse → mapping → KiotViet → notify**
  1. Gateway authenticates webhook (Mode 1 in prod by default; raw-body verification), validates schema, resolves membership.
  2. Unauthorized/unlinked/suspended cases short-circuit with safe behavior (notify job or reject) without processing side effects.
  3. Gateway updates interaction timestamp, dedup-inserts `inbound_events`, enqueues processing job, returns 200 fast.
  4. Workers process XML/map data; KiotViet sync worker decrypts tenant token from `secret_versions` envelope path and performs API operations idempotently.
  5. Notifier checks interaction window; sends immediately if open or stores `pending_notifications` if closed.
- **Onboarding / invite consume flow**
  1. Admin creates tenant and invite code.
  2. User sends invite via bot; Gateway enforces invite attempt rate limits before DB call.
  3. `consume_invite_code()` atomically validates/consumes code, creates/uses `zalo_users`, creates membership, activates tenant as needed.
  4. All invite failures are indistinguishable to caller (generic message) to prevent code probing.
- **Failure UX / interaction-window constraints**
  - Processing failures map to deterministic user-safe messages plus retry/DLQ actions.
  - If interaction window is closed, notifier does not send proactively; it stores pending items (TTL policy) and flushes on next inbound user message.

## E) Risk Register (Top 10)
1. **Webhook spoofing / signature bypass**
   - Impact: high, Likelihood: medium.
   - Mitigation: fail-closed signature mode, constant-time compare, raw-body hashing, Mode-2 restricted to staging by default.
   - Test/monitor: webhook auth contract tests, `webhook_auth_fail` metrics.
2. **Replay/duplicate webhook delivery**
   - Impact: high, Likelihood: high.
   - Mitigation: DB unique dedupe `(tenant_id, zalo_msg_id)` + optional Redis fast dedupe.
   - Test/monitor: replay contract tests; dedupe-hit and duplicate-side-effect alerts.
3. **Cross-tenant data leakage**
   - Impact: critical, Likelihood: medium.
   - Mitigation: mandatory RLS, `_rls_tenant_id()` fail-safe, least-privilege DB roles, no `app_user` cross-tenant audit reads.
   - Test/monitor: CI RLS gates + `groceryclaw_rls_violation_total` alerts.
4. **Invite brute-force / onboarding takeover**
   - Impact: high, Likelihood: medium-high.
   - Mitigation: Gateway rate-limit + per-code/per-user DB lockouts + generic failure responses.
   - Test/monitor: invite abuse tests; lockout/rate-limit telemetry.
5. **SSRF via file URL fetch or worker egress abuse**
   - Impact: critical, Likelihood: medium.
   - Mitigation: URL/domain allowlist, block private/link-local/loopback, no redirects, protocol restrictions, timeout and size caps.
   - Test/monitor: SSRF security tests and blocked-attempt metrics.
6. **Secret exposure in logs/memory/storage**
   - Impact: critical, Likelihood: medium.
   - Mitigation: envelope encryption, versioned secrets, no plaintext logs, rotation/revoke paths.
   - Test/monitor: log-scrub tests + secret access audit trails.
7. **Gateway latency regression (ACK misses SLO)**
   - Impact: high, Likelihood: medium.
   - Mitigation: async-first design, strict budget per ingress step, fire-and-forget non-critical updates.
   - Test/monitor: p95 ACK dashboards and alerting.
8. **Queue backlog / worker saturation**
   - Impact: high, Likelihood: medium.
   - Mitigation: horizontal worker scaling, queue prioritization, retry limits with DLQ.
   - Test/monitor: queue depth, job start latency p95, DLQ rate.
9. **Admin auth boundary failure (OIDC misconfig or bypass)**
   - Impact: critical, Likelihood: low-medium.
   - Mitigation: network gate + OIDC validation + RBAC, tightly controlled break-glass with alerts.
   - Test/monitor: authz tests and admin audit anomaly alerts.
10. **Migration drift from schema dictionary / ID confusion**
   - Impact: high, Likelihood: medium.
   - Mitigation: schema dictionary as hard gate, migration acceptance queries, no-mixed-ID checks.
   - Test/monitor: migration apply/rollback CI and schema contract checks.

## F) Build Plan (Phased)
- **Phase 0: Repo scaffolding + CI gates + local compose**
  - **Deliverables:** monorepo app/package structure, v2 compose stack, lint/format/test pipelines, PR/CI gates for contract+security suites.
  - **Acceptance tests:** pipeline runs lint + unit + integration harness skeleton + migration smoke job.
  - **Rollback/flags:** keep V1 untouched; V2 disabled by default via tenant `processing_mode='legacy'`.
- **Phase 1: DB schema/migrations + RLS + bootstrap functions + tests**
  - **Deliverables:** canonical schema tables, RLS policies with `_rls_tenant_id()`, bootstrap functions, migration scripts and fixtures.
  - **Acceptance tests:** apply/rollback migrations, RLS isolation tests, bootstrap resolution tests, no-mixed-ID checks.
  - **Rollback/flags:** reversible migration set; keep legacy columns/paths until validation gates pass.
- **Phase 2: Gateway ingress + validation + enqueue + contract tests**
  - **Deliverables:** webhook auth modes, schema validation, membership/invite flow integration, fast ACK path, enqueue + dedupe behavior.
  - **Acceptance tests:** webhook contracts (valid/invalid/missing signature), invite rate-limit contracts, 200 ACK under budget in integration bench.
  - **Rollback/flags:** feature-flag webhook mode and per-tenant canary routing.
- **Phase 3: Workers + idempotency + KiotViet adapter stub + integration tests**
  - **Deliverables:** worker processors, idempotency enforcement, KiotViet client stub with envelope decrypt, audit/event logging.
  - **Acceptance tests:** end-to-end processing integration, duplicate message suppression, worker retry behavior.
  - **Rollback/flags:** route tenant back to legacy mode if sync error budget exceeded.
- **Phase 4: Notifier + interaction policy enforcement + retry/DLQ**
  - **Deliverables:** notifier worker with window checks, pending queue persistence/flush, outbound limiter, DLQ handling.
  - **Acceptance tests:** window-open send vs window-closed defer, pending TTL/flush semantics, notifier retry and DLQ paths.
  - **Rollback/flags:** disable notifier send path per tenant and keep queued records for replay.
- **Phase 5: Admin + OIDC + audit/ops tooling**
  - **Deliverables:** private admin API, OIDC+RBAC middleware, break-glass controls, audit endpoints, tenant/invite/secret/job operations.
  - **Acceptance tests:** auth boundary tests (network+JWT+RBAC), admin audit completeness, secrets rotate/revoke workflows.
  - **Rollback/flags:** keep read-only break-glass mode and revoke write routes behind feature switches.
- **Phase 6: Load tests + capacity model + SLO verification**
  - **Deliverables:** 1000-tenant load scenarios, capacity tuning, scaling runbook, SLO dashboards/alerts.
  - **Acceptance tests:** p95 SLO pass for ACK/job/E2E metrics under target load; resilience drills (queue surge, dependency timeout).
  - **Rollback/flags:** freeze tenant canary expansion; automatic fallback to legacy for unstable cohorts.

## G) Prompt Roadmap
1. Phase 0 foundation: monorepo scaffolding, CI quality gates, and local V2 compose baseline.
2. Phase 1 schema implementation: create V2 tables and schema-dictionary conformance checks.
3. RLS hardening: implement `_rls_tenant_id()`, per-table policies, and mandatory RLS CI tests.
4. Bootstrap security functions: implement and test `resolve_membership_by_platform_user_id()` + `consume_invite_code()`.
5. Gateway webhook ingress MVP: auth modes, payload contracts, dedupe insert, enqueue, and fast ACK budget checks.
6. Invite/onboarding flow in Gateway: pre-DB rate limits, generic failure UX, and tenant-linking behavior.
7. Worker pipeline slice: invoice parse → mapping resolve → KiotViet stub with idempotency and retry semantics.
8. Notifier + interaction window: pending notification persistence, flush-on-inbound, OA rate limiting.
9. Admin security plane: OIDC/RBAC, break-glass controls, audit logging, and tenant/secret/job endpoints.
10. Scale-and-release gate: load/capacity tests, SLO validation, canary-by-tenant rollout and rollback drill.

## H) Clarifications Needed (if any)
1. **Webhook signature specification from Zalo is still externally unresolved in-doc** (exact header names, signing base, algorithm details, timestamp/nonce inclusion). Safe default: block production unless Mode 1 is verified; allow Mode 2 only in staging or approved exception with compensating controls.
2. **Provider retry semantics are not confirmed** (which HTTP statuses trigger retries). Safe default: design idempotent ingress; treat 5xx/timeouts as retriable and keep 200 for authenticated valid payloads.
3. **Exact OA interaction policy details remain checklist items** (confirmed reply-window duration, allowed message types/list interactions, exact outbound limits). Safe default: enforce conservative 48h window and 80 msg/min global limiter until verified.
