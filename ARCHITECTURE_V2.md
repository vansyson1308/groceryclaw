# Architecture V2 (Basic) — GroceryClaw SaaS

> **Version:** 2.1.2-FINALIZE · **Last updated:** 2026-03-02  
> **Owner:** Engineering · **Status:** READY FOR IMPLEMENTATION  
> **Change:** v2.0→v2.1→v2.1.2 — all blockers resolved; implementation-ready


## v2.1.2 Patch Summary (Docs-Only — FINALIZE)

- **B1 — Migration fix:** Corrected in MASTER_DESIGN_PACK §7.4. No changes needed in Architecture doc (migration is a data concern, not an architectural one).
- **B2 — Invite consumption finalized:** `consume_invite_code()` fully specified in MASTER_DESIGN_PACK §3.2.1. Gateway responsibilities updated below to include invite-specific rate limiting.
- **Gateway rate-limiting for invite brute-force:** Gateway **MUST** enforce invite-attempt rate limits (10/min per `platform_user_id`, 5/min per source IP) at the middleware layer BEFORE calling the `consume_invite_code()` DB function. This defends against brute-force of unknown codes where no DB row exists to track attempts.
- **Consistency audit:** Confirmed zero mixed ID usage, zero "decrypt from env" remnants.
- **Gateway no-egress clarification (v2.1.2 post-review):** Explicitly documented that Gateway MUST NOT call Zalo OA API directly. All outbound messages (including onboarding prompts and error replies) are enqueued as NOTIFY jobs for the notifier worker. This aligns with the "No internet egress from Gateway" boundary rule.

## Decision Matrix v2.1.2

| # | Patch Item | Decision (MUST/SHALL) |
|---|---|---|
| B2 | Gateway invite rate-limit | Gateway **MUST** rate-limit invite attempts: 10/min per `platform_user_id` + 5/min per source IP. Enforced BEFORE DB function call. |
| C1 | ID consistency | Confirmed: all references use schema-dictionary identifiers. |

---

## v2.1.1 Patch Summary (Docs-Only)

This patch resolves the remaining **BLOCKERS** before implementation:

- **RLS bootstrap tenant resolution (BLOCKER):** Added a secure bootstrap mechanism using **SECURITY DEFINER** PostgreSQL functions to resolve `tenant_id` and consume invite codes *without* `app.current_tenant` set.
- **audit_logs cross-tenant leak (BLOCKER):** Split DB access into **app_user** (tenant-scoped only) vs **admin_reader** (cross-tenant, Admin service only). Replaced unsafe `USING (true)` read policy for `app_user`.
- **Webhook verification ambiguity (BLOCKER):** Replaced “Needs verification” with a **two-mode** operational design:
  - Mode 1: Verified Signature (HMAC/signature) using **raw body**, constant-time compare, explicit failure codes.
  - Mode 2: Fallback (staging-only by default) with **source verification + strict limits** and **anti-replay via dedupe keys + TTL** (no timestamp dependency).
- **ID/FK + secrets consistency (INCONSISTENCY):** Canonicalized identifiers:
  - External boundary uses `platform_user_id` (Zalo string).
  - Internal DB uses `zalo_users.id` UUID as `zalo_user_id` FK everywhere.
  Updated `pending_notifications` to use UUID FK and removed “decrypt token from env” language in favor of envelope decryption from `secret_versions`.

**Rollback notes:** Each change is reversible by disabling bootstrap functions / reverting RLS policies / switching webhook mode flag / reverting column naming in docs; rollback steps are specified in the relevant sections below.

## Decision Matrix v2.1.1

| Patch Item | Decision (MUST/SHALL) | Rationale | Enforcement Mechanism | Tests / Monitors |
|---|---|---|---|---|
| (1) RLS Bootstrap Tenant Resolution | Gateway/Worker **MUST** resolve tenant membership via **SECURITY DEFINER** functions **before** setting `app.current_tenant`. | Avoids RLS deadlock where tenant-scoped tables return 0 rows without tenant context. | `resolve_membership_by_platform_user_id()` + `consume_invite_code()` owned by `bootstrap_owner` and granted to `app_user`. | “Bootstrap Resolution” integration spec; monitor invite lockouts + auth failures. |
| (2) audit_logs RLS Leak | `app_user` **MUST NOT** have cross-tenant reads; Admin service **SHALL** use `admin_reader` role for cross-tenant audit access. | Prevents cross-tenant leakage of audit logs to Gateway/Worker. | RLS: `app_user` SELECT policy tenant-scoped (or none); `admin_reader` separate policy/function; separate DB creds for Admin. | “Policy Safety” tests; monitor `groceryclaw_rls_violation_total`. |
| (3) Webhook Signature + Anti-Replay | Runtime **MUST** support 2 modes: Mode 1 verified signature; Mode 2 fallback with strict source verification and dedupe-based replay defense. Production **SHALL** run Mode 1 unless compensating controls are approved. | Removes ambiguity; provides safe, implementable path even if provider docs are unclear. | Config flag `WEBHOOK_VERIFY_MODE`; raw-body verification; dedupe table unique keys + TTL. | Contract tests for both modes; monitor auth failures, dedupe hit-rate, rate limiting. |
| (4) ID/FK + Secrets Consistency | DB **MUST** use `zalo_users.id` UUID as FK (`zalo_user_id`) everywhere; external payloads **MUST** use `platform_user_id`. Secrets **MUST** be envelope-decrypted from `secret_versions` (no env “decrypt token” step). | Eliminates mixed identifiers and inconsistent secret handling. | Schema conventions + glossary + review gate; lint/checklists in PR templates. | “No mixed IDs” tests; log-scrub tests for secrets. |

---

## 1. Architecture Principles

| Principle | Implication |
|---|---|
| **Async-first** | Webhook ACK is instant; all heavy processing via queue + workers |
| **Tenant-is-first-class** | `tenant_id` in every record, log line, metric label, queue job payload |
| **Minimal public surface** | Only Gateway `/webhooks/zalo` + `/health` face the internet |
| **Fail-closed authentication** | Invalid/missing webhook signature → 401 immediately; no processing |
| **DB-enforced isolation** | PostgreSQL RLS on all tenant-scoped tables from Beta |
| **Idempotent by default** | Every state mutation has an idempotency key; replays are safe |
| **Observable** | Structured logs + metrics + tracing; debug any tenant in < 15 min |
| **Strangler-compatible** | V1 (n8n) and V2 run in parallel; per-tenant routing via flag |

---

## 2. Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ TRUST BOUNDARY 0: INTERNET (untrusted)                                      │
│                                                                             │
│   Zalo Platform ──── webhook POST ──────┐                                   │
│   Attackers ──── spoofed requests ──────┤                                   │
│                                         │                                   │
└─────────────────────────────────────────┼───────────────────────────────────┘
                                          │
┌─────────────────────────────────────────▼───────────────────────────────────┐
│ TRUST BOUNDARY 1: DMZ (public-facing, minimal logic)                        │
│                                                                             │
│   ┌─────────────────────────────────────────────┐                           │
│   │  GATEWAY :3000                              │                           │
│   │  /webhooks/zalo  ← ONLY public endpoint     │                           │
│   │  /health         ← no auth needed           │                           │
│   │                                             │                           │
│   │  Responsibilities:                          │                           │
│   │  1. Verify webhook signature (HMAC)         │                           │
│   │  2. Validate payload schema                 │                           │
│   │  3. Resolve platform_user_id → membership (bootstrap function) → tenant + role       │                           │
│   │  4. Dedupe (inbound_event INSERT)           │                           │
│   │  5. Enqueue job                             │                           │
│   │  6. Update last_interaction_at              │                           │
│   │  7. Return 200                              │                           │
│   └──────────────────────┬──────────────────────┘                           │
│                          │                                                  │
└──────────────────────────┼──────────────────────────────────────────────────┘
                           │ private network only
┌──────────────────────────▼──────────────────────────────────────────────────┐
│ TRUST BOUNDARY 2: INTERNAL (private network, authenticated services)        │
│                                                                             │
│   ┌───────────┐  ┌────────────┐  ┌────────────┐  ┌───────────────────────┐ │
│   │   Redis   │  │ PostgreSQL │  │   MinIO    │  │    WORKER POOL       │ │
│   │  :6379    │  │   :5432    │  │   :9000    │  │                      │ │
│   │ requirepw │  │  TLS+pw   │  │  accesskey │  │  invoice-xml         │ │
│   │ bind pvt  │  │  RLS ON   │  │  pvt only  │  │  kiotviet-sync       │ │
│   └───────────┘  └────────────┘  └────────────┘  │  notifier            │ │
│                                                   │  mapping-resolve     │ │
│                                                   └──────────────────────┘ │
│                                                                             │
│   ┌─────────────────────────────────────┐                                   │
│   │  ADMIN API :3001                    │                                   │
│   │  VPN + OIDC/SSO + RBAC             │                                   │
│   │  /metrics ← private only            │                                   │
│   └─────────────────────────────────────┘                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ TRUST BOUNDARY 3: EXTERNAL APIS (third-party, rate-limited)                 │
│                                                                             │
│   KiotViet API  ← per-tenant OAuth tokens (envelope-encrypted at rest)      │
│   Zalo OA API   ← OA access token (interaction-window enforced)             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key boundary rules:**
- Boundary 0 → 1: ONLY `POST /webhooks/zalo` and `GET /health` cross this boundary.
- `/metrics` MUST NOT be exposed to the internet. It is served on the admin port (:3001) or a separate internal-only port.
- Boundary 1 → 2: Gateway connects to Redis (enqueue) and PG (insert inbound_event) over private network. No internet egress from Gateway. **Gateway MUST NOT call Zalo OA API directly** — all outbound messages (including onboarding prompts and error replies) are enqueued as NOTIFY jobs for the notifier worker, which is the sole component making Zalo outbound calls.
- Boundary 2 → 3: ONLY workers (kiotviet-sync, notifier) make outbound calls. Workers MUST validate URLs and enforce SSRF protections before any HTTP egress.

---

## 3. Webhook Authenticity & Anti-Replay (v2.1.1)

### 3.1 Modes (Runtime MUST Support Both)

The Gateway **MUST** run in exactly one of the following modes, controlled by `WEBHOOK_VERIFY_MODE`:

- `verified_signature` (Mode 1) — **REQUIRED for production by default**
- `fallback_source_verified` (Mode 2) — **allowed only in staging by default** (see §3.5 Go/No‑Go)

The Gateway **MUST** use the **raw request body bytes** as received on the wire for any signature verification. It **MUST NOT** re-serialize JSON before hashing.

### 3.2 Mode 1 — Verified Signature Mode (HMAC / Signature)

**Inputs (placeholders to be verified against Zalo docs):**
- Signature header(s): `X-...-Signature` (exact name **MUST** be verified)  
- Optional: timestamp/nonce header(s): `X-...-Timestamp`, `X-...-Nonce` (**only enforced if verified to be part of the signed payload**)

**Canonical verification algorithm (MUST):**
1. Read `raw_body` bytes from the HTTP layer (no JSON parsing yet).
2. Extract `received_signature` from the verified header name.
3. Compute `expected_signature = HMAC_SHA256(OA_WEBHOOK_SECRET, raw_body)` **or** the exact algorithm mandated by Zalo docs.
4. Compare using **constant-time** compare.
5. If a timestamp/nonce is defined by Zalo **and included in the signature base**, enforce:
   - timestamp drift **≤ 300s** (configurable) and
   - nonce uniqueness via dedupe store (see §3.4).
   Otherwise, **DO NOT** rely on timestamp for anti-replay.

**Failure behavior (MUST):**
- Missing/invalid signature → **401** and **no side-effects** (no DB inserts, no queue jobs).
- Log: `{event:"webhook_auth_fail", reason:"signature_missing|signature_mismatch", source_ip, request_id}` (no payload).
- Metric: `groceryclaw_webhook_auth_fail_total{reason=...} += 1`.

### 3.3 Mode 2 — Fallback Mode (No Signature Spec Available)

Mode 2 exists **only** to enable development and staging validation when Zalo signature specs are not yet verified.

**Source verification (MUST satisfy ALL configured controls):**
- **Verification token**: request MUST contain a shared token (header or field) configured per environment.
- **Network control** (choose at least one; both recommended):
  - IP allowlist of Zalo webhook source ranges **OR**
  - Private ingress (e.g., Cloudflare/Reverse-proxy with authenticated origin) where only the proxy can reach Gateway.
- **Rate limits (MUST):**
  - Global: 300 req/min (burst 600)
  - Per `platform_user_id`: 30 req/min
  - Per source IP: 60 req/min
- Any failure → **403** and **no side-effects**.

**Hard limits (MUST):**
- Max body size: **256 KB**
- Max attachment size fetched: **10 MB**
- Attachment URL allowlist: `*.zalo.me`, `*.zadn.vn` (and any additional domains only after review)
- Download timeout: **10s**, max redirects: **0**
- SSRF guard: block RFC1918, link-local, loopback; block non-HTTP(S)

### 3.4 Anti-Replay & Idempotency (BOTH MODES)

Anti-replay **MUST NOT** rely on timestamps unless the provider’s timestamp is verified to be signed.

**Primary anti-replay mechanism (MUST):**
- Deduplicate using `(tenant_id, provider_msg_id)` with a UNIQUE constraint:
  - `provider_msg_id` = Zalo message id (`zalo_msg_id`)
  - Persist in `inbound_events` (or equivalent) with `UNIQUE(tenant_id, zalo_msg_id)`
- Additionally, store a dedupe TTL window:
  - `inbound_events` retention **≥ 90 days** already covers common replay windows.
  - For faster rejection, a Redis `SETNX` key `dedupe:{tenant_id}:{zalo_msg_id}` with TTL **24h** MAY be used, but the DB UNIQUE constraint remains the source of truth.

**Required ACK behavior:**
- If dedupe key already exists (DB unique violation / prior row):
  - Return **200** with `{status:"accepted"}` and do not enqueue duplicate jobs.

### 3.5 Retry Semantics (Provider → Gateway)

Provider retry behavior is **unknown until verified**. Safe defaults:

- Treat **5xx** and **timeouts** as retried by provider.
- Treat **4xx** as not retried.

**Gateway response contract (MUST):**
- `200` for authenticated + schema-valid requests (even if downstream processing fails later).
- `400` for schema invalid (no retry assumed).
- `401` for signature auth failure (Mode 1).
- `403` for source verification failure (Mode 2).
- `429` for rate limiting (retry MAY occur; include `Retry-After`).

### 3.6 Zalo Verification Checklist (Pre‑Production Go/No‑Go)

Before enabling production traffic:

1. Confirm official Zalo docs/spec for:
   - Exact signature header name(s)
   - Algorithm and signing base (raw body vs body+timestamp+nonce)
   - Whether timestamp/nonce is present and included in signature
   - Provider retry rules (which HTTP codes trigger retries)
2. Run contract tests in sandbox:
   - Known good signature → accepted
   - Wrong signature → 401
   - Missing signature → 401
   - Replay of the same message id → 200, no duplicate processing
3. **Go/No‑Go Rule (MUST):**
   - If signature spec is verified → enable `verified_signature` and **disable Mode 2** in production.
   - If signature spec is not verified → production is **blocked** unless a written exception is approved with compensating controls (private ingress + allowlist + aggressive rate limits + monitoring). Staging may use Mode 2.

## 4. System Components

### 4.1 High-Level Topology

```
┌──────────────────────────────────────────────────────────────────┐
│                         INTERNET                                  │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                      ┌──────▼──────┐
                      │   GATEWAY   │  (public; ONLY /webhooks/zalo + /health)
                      │  :3000      │  /metrics NOT exposed here
                      └──────┬──────┘
                             │
                ┌────────────┼──────────────────┐
                │      PRIVATE NETWORK          │
                │                               │
                │  ┌───────────┐  ┌──────────┐  │
                │  │   Redis   │  │  MinIO   │  │
                │  │  (Queue)  │  │   (S3)   │  │
                │  └─────┬─────┘  └──────────┘  │
                │        │                      │
                │  ┌─────▼────────────────────┐ │
                │  │     WORKER POOL          │ │
                │  │  invoice-xml             │ │
                │  │  kiotviet-sync           │ │
                │  │  notifier (window-aware) │ │
                │  │  mapping-resolve         │ │
                │  └──────────┬───────────────┘ │
                │             │                 │
                │  ┌──────────▼──────────────┐  │
                │  │    PostgreSQL (RLS ON)   │  │
                │  └─────────────────────────┘  │
                │                               │
                │  ┌─────────────────────────┐  │
                │  │  Admin API :3001        │  │
                │  │  VPN + OIDC + RBAC      │  │
                │  │  /metrics (internal)    │  │
                │  └─────────────────────────┘  │
                └───────────────────────────────┘
```

### 4.2 Component Details

#### Gateway Service (`apps/gateway`)

**Responsibilities:**
1. Verify webhook signature (HMAC-SHA256, fail-closed) — see §3.1.
2. Validate payload schema (Zod runtime validation).
3. Resolve `platform_user_id` via bootstrap DB function → `{tenant_id, role, status, membership_id}`; then set `app.current_tenant` for all tenant-scoped queries.
3a. **Invite code path (v2.1.2):** If user is unlinked and submits an invite code, Gateway MUST enforce invite-specific rate limits (10/min per `platform_user_id` + 5/min per source IP) BEFORE calling `consume_invite_code()`. This defends against brute-force attempts where no DB row exists to track failures. All invite failures return the same generic message regardless of failure type.
4. Enforce authorization: `role >= staff` for file messages; unlinked users get onboarding prompt (enqueued as NOTIFY job — Gateway MUST NOT call Zalo API directly).
5. Update `zalo_users.last_interaction_at` (interaction window tracking).
6. Insert `inbound_event` row (UNIQUE constraint for idempotency).
7. Enqueue job `PROCESS_INBOUND_EVENT` to the Redis-backed worker queue (`bullmq-lite` shim using `RPUSH`/`BRPOP`).
8. Flush pending notifications (if any exist for this user and window is now open).
9. Return HTTP 200 within 200 ms budget.

**Technology:** Node.js 20 + built-in `node:http` server (`createServer`) with explicit route handling.

**Endpoints exposed to internet:**
- `POST /webhooks/zalo` — webhook ingress (signature-verified)
- `GET /healthz` — shallow process health check (no auth)
- `GET /readyz` — strict dependency readiness (Postgres `SELECT 1` + Redis `PING`, 503 on dependency failure)

**Endpoints NOT exposed to internet:**
- `GET /metrics` — MUST be on admin port (:3001) or internal-only binding.

#### Queue (`infra/redis`)

**Technology:** Redis 7 + lightweight `bullmq-lite` compatibility layer (implemented via `redis-cli` `RPUSH`/`BRPOP`, not full BullMQ server-side features). Redis MUST have `requirepass` set and bind to private interface only.

| Queue Name | Producer | Consumer | Implementation semantics |
|---|---|---|---|
| `process-inbound` | Gateway | Worker | Redis list `bull:process-inbound:wait` (`RPUSH`/`BRPOP`) |

**Implication:** retry/DLQ behavior is implemented in application logic and job status tables, not by native BullMQ Redis data structures.

#### Worker Pool (`apps/worker`)

| Worker | Side-effects | Idempotency | Special |
|---|---|---|---|
| `invoice-xml` | Writes `canonical_invoice` rows | `(tenant_id, invoice_fingerprint)` | Sets tenant context for RLS |
| `kiotviet-sync` | KiotViet API call | `(tenant_id, external_effect_key)` | Decrypts tenant token in-memory; never logs |
| `notifier` | Zalo OA API outbound | `(tenant_id, notification_ref)` | **Checks interaction window before sending** |
| `mapping-resolve` | Updates mapping_dictionary | `(tenant_id, mapping_prompt_id)` | — |

**Every worker MUST set PG session variable before any query:**
```sql
SET LOCAL app.current_tenant = '<tenant_id>';
```
RLS policies enforce that only rows matching this tenant are visible/writable.

#### PostgreSQL (`infra/postgres`)

- **RLS ENABLED from Beta** on all tenant-scoped tables (see MASTER_DESIGN_PACK §3.2).
- Source of truth. Schema detailed in MASTER_DESIGN_PACK §3.

#### Admin API (`apps/admin`)


**Database access (v2.1.1, MUST):**
- Admin API **MUST** use a dedicated PostgreSQL role `admin_reader` for cross-tenant investigation reads (e.g., `audit_logs`).
- Gateway and Workers **MUST NOT** use `admin_reader`; they connect only as `app_user`.
- Admin API’s DB connectivity **SHALL** be restricted to private network/VPN and authenticated by OIDC at the HTTP layer.

**Rollback note:** If `admin_reader` cannot be provisioned, Admin API audit access MUST be implemented via SECURITY DEFINER read functions callable only by the Admin service identity; `app_user` still MUST remain tenant-scoped.
**Authentication (layered):**

| Layer | Mechanism | Purpose |
|---|---|---|
| Network | VPN / private network only | Prevent internet exposure |
| Identity | OIDC/SSO (e.g., Google Workspace, Auth0) | Verify admin identity |
| Authorization | RBAC: `super_admin`, `admin`, `viewer` | Scope permissions |
| Break-glass | Static API key (rotatable, restricted scope) | Emergency access when OIDC is unavailable |
| Audit | Every request logged with admin identity + action + target | Non-repudiation |

**OIDC flow for Admin API:**
1. Admin authenticates via OIDC provider (Google Workspace / Auth0).
2. OIDC provider issues JWT with `sub` (admin identity) and `groups` (role mapping).
3. Admin API validates JWT signature + expiration + audience.
4. Map OIDC group → RBAC role (`super_admin` / `admin` / `viewer`).
5. Log `{ admin_id: sub, role, action, target, timestamp }` to `admin_audit_logs`.

**Break-glass API key:**
- Used ONLY when OIDC is unavailable (outage, emergency).
- Scoped to read-only by default; `super_admin` key for writes (separate key).
- MUST be rotated every 90 days.
- Every use logged with alert to security channel.

**Serves `/metrics` endpoint** (Prometheus format) — accessible only from within private network.



#### Runtime ports & readiness contract (implemented)

| Service | Default bind | Health endpoint | Readiness endpoint | Readiness logic |
|---|---|---|---|---|
| Gateway | `0.0.0.0:8080` | `GET /healthz` | `GET /readyz` | `dbPing(SELECT 1)` + `redisPing(PING)` with short timeout; returns `503` if dependency check fails |
| Admin (private) | `127.0.0.1:3001` | `GET /healthz` | `GET /readyz` | `dbPing(SELECT 1)` + `redisPing(PING)` with short timeout; returns `503` if dependency check fails |
| Worker (private) | `0.0.0.0:3002` (health server) | `GET /healthz` | `GET /readyz` | `dbPing(SELECT 1)` + `redisPing(PING)` with short timeout; returns `503` if dependency check fails |

Worker metrics remain on `WORKER_METRICS_PORT` (default `9090`) and are separate from health/readiness probes.

#### Observability Stack

| Layer | Tool | Notes |
|---|---|---|
| Logs | Pino (structured JSON) → stdout | Collected by Docker journal → Loki |
| Metrics | Prometheus client (`prom-client`) | Exposed on Admin API :3001/metrics (internal only) |
| Tracing | OpenTelemetry SDK → Jaeger/Tempo | Correlation across Gateway → Queue → Worker |
| Alerting | Prometheus alerting rules → Telegram/PagerDuty | Thresholds in MASTER_DESIGN_PACK §5 |

---

## 5. Secrets Management Flow

### 5.1 Envelope Encryption Architecture

```
┌─────────────────────────────────────────────────────┐
│  Master Key (MEK)                                    │
│  Location: env var (Beta) → Vault/KMS (GA)           │
│  Rotation: manual (Beta) → automated (GA)            │
│  NEVER stored in DB or logs                          │
└──────────────────────┬──────────────────────────────┘
                       │ encrypts/decrypts
┌──────────────────────▼──────────────────────────────┐
│  Data Encryption Keys (DEK)                          │
│  One per secret_version row                          │
│  Stored: encrypted_dek (AES-256-GCM wrapped by MEK) │
│  in secret_versions table                            │
└──────────────────────┬──────────────────────────────┘
                       │ encrypts/decrypts
┌──────────────────────▼──────────────────────────────┐
│  Tenant Secrets (e.g., KiotViet tokens)              │
│  Stored: encrypted_value (AES-256-GCM wrapped by DEK)│
│  in secret_versions table                            │
└─────────────────────────────────────────────────────┘
```

### 5.2 Runtime Secret Access (Worker)

```
kiotviet-sync worker needs tenant's KiotViet token:
│
├─ 1. Query secret_versions WHERE tenant_id = $1
│     AND secret_type = 'kiotviet_token'
│     AND status = 'active'
│     ORDER BY version DESC LIMIT 1
│
├─ 2. Decrypt DEK: AES-256-GCM-Decrypt(MEK, encrypted_dek)
│     → plaintext DEK (in memory only)
│
├─ 3. Decrypt value: AES-256-GCM-Decrypt(DEK, encrypted_value)
│     → plaintext KiotViet token (in memory only)
│
├─ 4. Use token for KiotViet API call
│
├─ 5. Zero plaintext DEK and token from memory after use
│     (Buffer.fill(0) or equivalent)
│
└─ NEVER: log, serialize to job payload, store in Redis, or return in API response
```

### 5.3 Secret Rotation

1. Admin calls `POST /admin/tenants/:id/secrets/rotate` (type=kiotviet_token, new_value=...).
2. System creates new `secret_versions` row (version = prev + 1, status = `active`).
3. Previous version marked `status = 'rotated'` (kept for audit; encrypted value retained 30 days then wiped).
4. All in-flight jobs using old token will fail on next KiotViet call → retry picks up new version.
5. No downtime; workers always read latest active version.

---

## 6. Interaction State Integration

The notifier worker integrates with the interaction state machine (see PRD §5.6):

```
Notifier receives NOTIFY job
│
├─ 1. Query zalo_users WHERE id = $1
│     → get last_interaction_at
│
├─ 2. Check: last_interaction_at > now() - INTERVAL '48 hours'?
│     ├─ YES (window open):
│     │   ├─ Check global OA rate limiter (80 msg/min)
│     │   │   ├─ UNDER LIMIT → send via Zalo OA API
│     │   │   └─ OVER LIMIT  → re-enqueue with delay
│     │   └─ On send success → record in audit_logs
│     │
│     └─ NO (window closed):
│         ├─ INSERT into pending_notifications
│         │   (tenant_id, zalo_user_id, payload, expires_at = now() + 72h)
│         └─ Mark NOTIFY job as completed (notification stored, not sent)
│
└─ When Gateway processes next inbound message from this user:
    ├─ Update last_interaction_at = now() (window reopens)
    ├─ Query pending_notifications for this user (max 3, newest first)
    ├─ Enqueue NOTIFY jobs for each pending notification
    └─ Delete flushed pending_notifications
```

---

## 7. Sequence Diagrams

### 7.1 Invoice Processing (Happy Path — with auth + window checks)

```
Zalo         Gateway              Redis         invoice-xml     kv-sync       notifier      PostgreSQL
 │               │                  │               │              │             │              │
 │──POST /wh────►│                  │               │              │             │              │
 │               │──verify HMAC─────│               │              │             │              │
 │               │  (fail→401)      │               │              │             │              │
 │               │──validate schema │               │              │             │              │
 │               │──resolve user────│───────────────│──────────────│─────────────│─────────────►│
 │               │  →tenant+role    │               │              │             │              │
 │               │  (fail→200+prompt)               │              │             │              │
 │               │──update last_    │               │              │             │              │
 │               │  interaction_at──│───────────────│──────────────│─────────────│─────────────►│
 │               │──flush pending   │               │              │             │              │
 │               │  notifications───│───────────────│──────────────│─────────────│─────────────►│
 │               │──INSERT inbound_ │               │              │             │              │
 │               │  event (dedup)───│───────────────│──────────────│─────────────│─────────────►│
 │               │──ENQUEUE job────►│               │              │             │              │
 │◄──200 OK──────│                  │               │              │             │              │
 │               │                  │               │              │             │              │
 │               │                  │──dequeue─────►│              │             │              │
 │               │                  │               │──SET tenant──│─────────────│─────────────►│
 │               │                  │               │  context(RLS)│             │              │
 │               │                  │               │──parse+map───│─────────────│─────────────►│
 │               │                  │               │──ENQUEUE     │             │              │
 │               │                  │               │  kv-sync────►│             │              │
 │               │                  │               │              │             │              │
 │               │                  │               │              │◄─dequeue────│              │
 │               │                  │               │              │──decrypt    │              │
 │               │                  │               │              │  token (secret_versions envelope) │              │
 │               │                  │               │              │──KiotViet   │              │
 │               │                  │               │              │  API call   │              │
 │               │                  │               │              │──audit_log──│─────────────►│
 │               │                  │               │              │──ENQUEUE    │              │
 │               │                  │               │              │  notify────►│              │
 │               │                  │               │              │             │              │
 │               │                  │               │              │             │◄─dequeue─────│
 │               │                  │               │              │             │──check       │
 │               │                  │               │              │             │  window      │
 │               │                  │               │              │             │  (open→send) │
 │◄──Result msg──│──────────────────│───────────────│──────────────│─────────────│              │
```

### 7.2 Missing Mapping (Interactive) — unchanged from v2.0

### 7.3 Failure & DLQ — unchanged from v2.0

---

## 8. Scaling Model

*(Unchanged from v2.0 — see capacity estimates, horizontal scaling table, bottleneck analysis)*

### 8.1 Capacity Estimates (1000 tenants)

| Parameter | Estimate |
|---|---|
| Invoices/day | ~2000 |
| Peak invoices/hour | ~400 |
| Peak jobs/minute | ~20 (bursts to 50) |
| KiotViet API calls/day | ~4000 |

### 8.2 Horizontal Scaling

| Load Tier | Gateway | Workers | Redis | PostgreSQL |
|---|---|---|---|---|
| < 500 tenants | 1 | 2 | 1 | 1 (4 vCPU) |
| 500–2000 | 2 | 4 | 1 | 1 (8 vCPU) |
| 2000–5000 | 2 | 8 | 1 | 1 (16 vCPU) + read replica |

---

## 9. Failure Modes & Recovery

*(Unchanged from v2.0 — see failure table + recovery invariant)*

**Additional failure mode (v2.1):**

| Failure Mode | Detection | Impact | Recovery |
|---|---|---|---|
| OIDC provider down | Admin API returns 503 on login | Admins cannot access admin API | Break-glass API key (logged, alerted) |
| MEK compromised | Security alert | All encrypted secrets exposed | Emergency rotation: generate new MEK, re-encrypt all DEKs, revoke old MEK |
| Zalo webhook signature key rotated by Zalo | All webhooks return 401 | No invoices processed | Update OA_SECRET_KEY env var; redeploy Gateway |

---

## 10. Recommended Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript (Node.js 20 LTS) | Async I/O; shared types; team familiarity |
| HTTP server | Node.js `node:http` | Minimal runtime surface with explicit routing/validation in code |
| Queue | Redis 7 + `bullmq-lite` shim | Redis list queue (`RPUSH`/`BRPOP`); retries/DLQ handled by app logic |
| Database | PostgreSQL 16 | JSONB, **RLS**, proven at scale |
| ORM | Drizzle ORM | Type-safe SQL; lightweight migrations |
| Object storage | MinIO | S3-compatible; no vendor lock-in |
| Admin auth | **OIDC/SSO** (Google Workspace / Auth0) | Production-grade identity |
| Observability | Pino + prom-client + OpenTelemetry | Logs/metrics/traces |
| Secrets (Beta) | **Envelope encryption** (AES-256-GCM, MEK in env) | Versioned, rotatable |
| Secrets (GA) | **HashiCorp Vault** (transit + KV) | Automated rotation, audit |
| Containerization | Docker + docker-compose | V1 compat |
| CI/CD | GitHub Actions | Repo on GitHub |

---

## 11. Repo Tree Proposal

```
groceryclaw/
├── n8n/                          # V1 legacy (untouched)
│
├── apps/
│   ├── gateway/
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── routes/
│   │   │   │   └── webhooks.ts
│   │   │   ├── middleware/
│   │   │   │   ├── webhook-auth.ts    # HMAC verification (fail-closed)
│   │   │   │   ├── tenant-resolve.ts  # zalo_user → tenant + role
│   │   │   │   └── rate-limit.ts
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── worker/
│   │   ├── src/
│   │   │   ├── processors/
│   │   │   │   ├── invoice-xml.ts
│   │   │   │   ├── kiotviet-sync.ts
│   │   │   │   ├── notifier.ts        # Interaction-window-aware
│   │   │   │   └── mapping-resolve.ts
│   │   │   ├── services/
│   │   │   │   ├── parser/
│   │   │   │   ├── mapping/
│   │   │   │   ├── kiotviet/
│   │   │   │   ├── zalo/
│   │   │   │   └── secrets/
│   │   │   │       └── envelope-crypto.ts  # Decrypt secrets at runtime
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── admin/
│       ├── src/
│       │   ├── server.ts
│       │   ├── middleware/
│       │   │   ├── oidc-auth.ts       # OIDC JWT validation
│       │   │   ├── rbac.ts            # Role-based access control
│       │   │   └── break-glass.ts     # Emergency API key fallback
│       │   ├── routes/
│       │   │   ├── tenants.ts
│       │   │   ├── jobs.ts
│       │   │   ├── canary.ts
│       │   │   ├── secrets.ts         # Secret rotation endpoints
│       │   │   └── admin-users.ts     # RBAC management
│       │   └── index.ts
│       ├── Dockerfile
│       └── package.json
│
├── packages/
│   └── common/
│       ├── src/
│       │   ├── db/
│       │   │   ├── schema.ts
│       │   │   ├── rls-policies.sql   # RLS policy definitions
│       │   │   ├── migrations/
│       │   │   └── client.ts          # Sets tenant context per request
│       │   ├── types/
│       │   ├── queue/
│       │   ├── utils/
│       │   │   ├── idempotency.ts
│       │   │   ├── logger.ts
│       │   │   ├── envelope-crypto.ts
│       │   │   └── interaction-window.ts
│       │   └── index.ts
│       └── package.json
│
├── infra/
│   ├── docker-compose.v2.yml
│   ├── docker-compose.yml         # V1 legacy
│   ├── postgres/
│   │   ├── init.sql
│   │   └── rls-setup.sql          # Enable RLS + create policies
│   ├── redis/
│   ├── minio/
│   └── prometheus/
│
├── tests/
│   ├── fixtures/
│   ├── unit/
│   ├── integration/
│   │   ├── rls/                   # RLS isolation tests (CI gate)
│   │   └── webhook-auth/          # Signature verification tests
│   ├── contract/
│   └── load/
│
├── docs/saas_v2/
├── turbo.json
├── package.json
└── .github/workflows/
```
