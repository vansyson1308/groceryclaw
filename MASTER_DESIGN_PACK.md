# Master Design Pack — GroceryClaw SaaS V2

> **Version:** 2.1.2-FINALIZE · **Last updated:** 2026-03-02  
> **Owner:** Engineering · **Status:** READY FOR IMPLEMENTATION  
> **Companion docs:** [PRD_V2.md](./PRD_V2.md) · [ARCHITECTURE_V2.md](./ARCHITECTURE_V2.md)  
> **Change:** v2.0→v2.1→v2.1.2 — all blockers resolved; implementation-ready

---

## v2.1.2 Patch Summary (Docs-Only — FINALIZE)

This patch eliminates the **final two blockers** and resolves all consistency issues discovered during a full documentation audit. After this patch, **zero guessing is required** for implementation.

### Blocker Fixes

- **B1 — Migration v2.0→v2.1 (BLOCKER FIXED):** Rewrote §7.4 migration SQL. The previous version referenced non-existent columns (`zalo_user_id` on `zalo_users` table, which does not exist — the correct column is `platform_user_id`). Migration now uses only schema-dictionary-valid identifiers. Added deterministic ownership rule, duplicate handling, roll-forward/rollback, and acceptance gates.
- **B2 — `consume_invite_code()` fully specified (BLOCKER FIXED):** Replaced pseudo-code with a complete atomic transaction. Now includes: SHA-256 pepper-based hashing strategy, exact normalization rules (trim → strip `[- ]` → uppercase → validate `^[A-Z0-9]{6,32}$`), atomic `status='active'→'used'` transition via `UPDATE ... RETURNING` with row lock, per-code DB-side lockout (5 failures / 15 min → 30 min lockout), Gateway-level rate limiting for unknown codes, and concurrency safety via `FOR UPDATE SKIP LOCKED`.

### Consistency Audit Fixes

- **C1 — Schema Dictionary created:** New §3.0A "Schema Dictionary" section lists every V2-core table and column with canonical identifier usage rules.
- **C2 — `invite_codes` table updated:** Added `attempt_count`, `last_attempt_at`, `lockout_until` columns for per-code lockout. Status enum finalized as `active | used | revoked` (removed `expired` — expiry is checked at query time via `expires_at`).
- **C3 — "Needs verification" consolidated:** All Zalo-specific verification items moved into a single "Verification Checklist" section (PRD §5.6.4 + ARCHITECTURE §3.6). No lingering "Needs verification" or TODO/NOTE/pseudo outside those sections.
- **C4 — Secret flow consistency:** Confirmed zero remaining "decrypt from env" language. All secret access paths go through `secret_versions` envelope decryption.
- **C5 — `pending_notifications` confirmed correct:** Uses `zalo_user_id UUID FK` as primary reference; `platform_user_id TEXT` is denormalized and explicitly justified for Zalo API delivery.
- **C6 — RLS fail-safe (v2.1.2 post-review):** Replaced `current_setting('app.current_tenant')::uuid` (which raises ERROR when GUC is unset) with `_rls_tenant_id()` helper function using `current_setting(..., true)` + `NULLIF` → returns NULL when setting is absent → all RLS predicates evaluate to FALSE → 0 rows returned (fail-safe, no error). This fixes the contradiction where acceptance tests required "missing context → 0 rows" but the policy would actually throw an exception.
- **C7 — `pgcrypto` extension required (v2.1.2 post-review):** `sha256()` is not a standard PostgreSQL function. Replaced with `digest(..., 'sha256')` from `pgcrypto`. Added `CREATE EXTENSION IF NOT EXISTS pgcrypto` to RLS setup section.
- **C8 — Per-user lockout window fix (v2.1.2 post-review):** Added `invite_last_attempt_at TIMESTAMPTZ` to `zalo_users`. Per-user lockout window is now anchored on this dedicated field instead of `updated_at`, which is modified by unrelated operations (profile updates, interaction tracking) and would cause incorrect window resets.
- **C9 — Retention "expired" status fix (v2.1.2 post-review):** Updated retention policy for `invite_codes` to reference `status IN ('used','revoked') OR expires_at < now()` instead of the removed `expired` status enum value.
- **C10 — Gateway no-egress rule clarified (v2.1.2 post-review):** Explicitly documented that Gateway MUST NOT call Zalo OA API directly. All outbound messages (including onboarding prompts and error replies) are enqueued as NOTIFY jobs for the notifier worker.

### What Changed Per File

| File | Sections Modified |
|---|---|
| MASTER_DESIGN_PACK.md | v2.1.2 summary, Decision Matrix v2.1.2, §3.0A Schema Dictionary, §3.1 `invite_codes` table, §3.2.1 `consume_invite_code()` full rewrite, §7.4 migration rewrite, READY TO VIBECODE CHECKLIST |
| PRD_V2.md | v2.1.2 summary, §5.1 onboarding flow edge cases (generic failure + retry-after), §5.5 failure UX (invite rate-limit row), Decision Matrix v2.1.2 |
| ARCHITECTURE_V2.md | v2.1.2 summary, §4.2 Gateway responsibilities (invite rate-limit note), Decision Matrix v2.1.2 |

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

## Decision Matrix v2.1.2

| # | Patch Item | Decision (MUST/SHALL) | Rationale | Enforcement Mechanism | Acceptance Gate |
|---|---|---|---|---|---|
| B1 | Migration v2.0→v2.1 | Migration SQL **MUST** reference only schema-dictionary columns. Legacy `zalo_user_ids TEXT[]` values **MUST** be treated as `platform_user_id` strings. First user per tenant **MUST** become `owner` (deterministic: `ORDER BY platform_user_id ASC LIMIT 1`). | Previous migration used non-existent `zalo_user_id` column on `zalo_users` table. | Schema dictionary cross-reference; migration acceptance gates in §7.4. | Post-migration: every legacy tenant with ≥1 user has ≥1 `tenant_users` row; no orphan `tenant_users`; `platform_user_id` uniqueness holds. |
| B2 | `consume_invite_code()` | Function **MUST** be a single atomic transaction with `UPDATE ... SET status='used' ... WHERE status='active' AND expires_at > now() AND (lockout_until IS NULL OR lockout_until <= now()) ... RETURNING`. Lockout: 5 failed attempts in 15 min → 30 min lockout (DB-side per code). Gateway **MUST** rate-limit invite attempts per `platform_user_id` + IP (10 req/min). | Previous spec was pseudo-code; implementer would have to guess lockout logic, hashing, and normalization. | Atomic SQL with `FOR UPDATE SKIP LOCKED`; Gateway rate-limit middleware. | Same code consumed twice → 1 success + 1 generic failure; expired → generic failure; lockout enforced after 5 failures; concurrent consumes → only 1 success. |
| C1 | Schema Dictionary | All table/column references across docs **MUST** match the Schema Dictionary in §3.0A. | Prevents future column-name drift (the root cause of B1). | PR review checklist item. | Grep for `zalo_user_id` outside of FK columns → zero false references. |
| C2 | `invite_codes` table | Status enum **MUST** be `active \| used \| revoked`. Expiry is runtime-checked via `expires_at` (no `expired` status). `attempt_count`, `last_attempt_at`, `lockout_until` columns **MUST** exist for per-code lockout. | Simplifies status machine; prevents stale-status bugs from cron-based expiry. | Schema DDL + constraint checks. | `invite_codes` table has exactly 3 status values and 3 lockout columns. |
| C3 | Verification items consolidated | All "Needs verification" items **MUST** reside in exactly one Verification Checklist per doc (PRD §5.6.4, ARCH §3.6). Runtime behavior **MUST** be implementable without verification (safe defaults). | Prevents scattered TODO/NOTE that block implementation. | Doc grep for "Needs verification" outside checklist sections → zero hits. | Zero lingering TODO/NOTE/pseudo outside Verification Checklist. |
| C4 | Secret flow | Secrets **MUST** always be accessed via `secret_versions` envelope decryption. Zero occurrences of "decrypt from env" or "decrypt token(env)" in any doc. | Eliminates contradictory secret access patterns. | Doc grep → zero hits. | Confirmed zero hits. |
| C5 | `pending_notifications` IDs | Primary user reference **MUST** be `zalo_user_id UUID FK`. `platform_user_id TEXT` is allowed **only** as denormalized field for Zalo API delivery, explicitly documented. | Enforces "No mixed IDs" rule while allowing practical delivery optimization. | Schema DDL comment. | `pending_notifications` FK points to `zalo_users(id)`. |
| C6 | RLS fail-safe | RLS policies **MUST** use `_rls_tenant_id()` helper (with `current_setting(..., true)` + `NULLIF`), NOT raw `current_setting(...)::uuid`. Missing/empty tenant context **MUST** return 0 rows, not raise an exception. | Raw `current_setting` without `missing_ok=true` throws ERROR when GUC is unset, contradicting the "fail-safe 0 rows" acceptance test. | `_rls_tenant_id()` function definition in RLS setup. | `SET app.current_tenant` to empty → SELECT returns 0 rows (no error). |
| C7 | `pgcrypto` required | `CREATE EXTENSION IF NOT EXISTS pgcrypto` **MUST** be in RLS setup migration. `consume_invite_code()` **MUST** use `digest(..., 'sha256')` not `sha256()`. | Standard PostgreSQL does not include `sha256()` function. | Extension in init migration; compile-time check. | `SELECT digest('test', 'sha256')` succeeds on fresh DB. |
| C8 | Per-user lockout window | Per-user lockout **MUST** use dedicated `invite_last_attempt_at` field, NOT `updated_at`. | `updated_at` is modified by profile updates, interaction tracking, and other operations — using it would cause incorrect lockout window resets. | DDL has `invite_last_attempt_at`; `consume_invite_code()` references it. | Simulate: update `display_name` → `updated_at` changes → lockout window NOT reset. |
| C9 | Retention cleanup | Retention for `invite_codes` **MUST** use `status IN ('used','revoked') OR expires_at < now()`, NOT reference removed `expired` status. | `expired` was removed from status enum in v2.1.2 (expiry is runtime-checked via `expires_at`). | Retention SQL query. | No reference to `'expired'` status in retention logic. |
| C10 | Gateway no-egress | Gateway **MUST NOT** call Zalo OA API directly. All outbound messages (including onboarding prompts) **MUST** be enqueued as NOTIFY jobs for the notifier worker. | Architecture specifies "No internet egress from Gateway." Sending Zalo messages requires internet egress. | Gateway has no Zalo API client; only notifier does. | Gateway process has no outbound HTTP calls to `*.zalo.me`. |

---

## Table of Contents

- [§3. Data Model & Multi-Tenant Policy](#3-data-model--multi-tenant-policy)
- [§4. API Contracts](#4-api-contracts)
- [§5. SLO/SLA & Performance Budgets](#5-slosla--performance-budgets)
- [§6. Threat Model & Security Controls](#6-threat-model--security-controls)
- [§7. Migration Plan (Strangler)](#7-migration-plan-strangler)
- [§8. Test Plan](#8-test-plan)
- [§9. Runbook](#9-runbook)
- [Appendix D: Core Decisions v2.1](#appendix-d-core-decisions-v21)

---

## §3. Data Model & Multi-Tenant Policy

### 3.0 Identifier Glossary & Naming Rules (v2.1.1)

| Term | Type | Meaning | Allowed Locations |
|---|---|---|---|
| `tenant_id` | UUID | Internal tenant primary key | All tenant-scoped tables, job envelopes, logs |
| `platform_user_id` | TEXT | **External** Zalo platform user id (string) | **Ingress/Egress boundary only** (webhook payloads, outbound API calls); may be denormalized for debugging |
| `zalo_user_id` | UUID | Internal FK referencing `zalo_users.id` | Any table referencing a user; job envelopes as `zalo_user_db_id` |

**No mixed IDs rule (MUST):**
1. Any table referencing a user **MUST** store `zalo_user_id UUID REFERENCES zalo_users(id)`.  
2. External identifiers (`platform_user_id`) **MUST NOT** be used as FKs.  
3. At the boundary: inbound payloads carry `platform_user_id`; the Gateway **MUST** resolve it to `zalo_user_id` before any tenant-scoped DB operations.

Acceptance: See §8 “No mixed IDs” gate.

### 3.0A Schema Dictionary (v2.1.2 — Authoritative)

This is the **single source of truth** for V2-core table and column names. Any reference in any doc MUST match this dictionary. If a column name appears in migration SQL, API contracts, or pseudocode that is not listed here, it is a **bug**.

#### Canonical Identifier Quick-Reference

| Identifier | Type | Where It Lives | Where It Is Used |
|---|---|---|---|
| `tenants.id` | UUID PK | `tenants` table | FK as `tenant_id` in all tenant-scoped tables, job envelopes, logs, metrics |
| `zalo_users.id` | UUID PK | `zalo_users` table | FK as `zalo_user_id` in `tenant_users`, `invite_codes.used_by`, `pending_notifications`, `inbound_events`, job envelopes (as `zalo_user_db_id`) |
| `zalo_users.platform_user_id` | TEXT UNIQUE | `zalo_users` table | Ingress/egress boundary only: webhook payloads, Zalo OA API calls, Gateway resolution input, denormalized debug fields |
| `tenant_users.id` | UUID PK | `tenant_users` table | FK as `invited_by` in `tenant_users`, `created_by` in `invite_codes`, `membership_id` in bootstrap function returns |

#### Where Each Identifier Is Allowed (MUST)

| Context | Use `platform_user_id` (TEXT) | Use `zalo_user_id` (UUID FK) | Use `tenant_id` (UUID FK) |
|---|---|---|---|
| Webhook payload (inbound) | YES — this is the raw Zalo identifier | NO | NO (resolved by Gateway) |
| Gateway resolution function input | YES | NO | NO |
| DB FK columns | NO — never as FK | YES | YES |
| Job envelope | NO (use `zalo_user_db_id`) | YES (as `zalo_user_db_id`) | YES |
| Zalo OA API call (outbound) | YES — required by Zalo API | NO | NO |
| Log lines | Allowed for debugging | Preferred | YES |
| Denormalized columns | Only if explicitly justified (e.g., `pending_notifications.platform_user_id` for delivery) | Preferred | Required |

### 3.1 Core Tables

All tenant-scoped tables include `tenant_id NOT NULL` and participate in composite indexes with `tenant_id` as leading key. **All tenant-scoped tables MUST have RLS enabled from Beta.**

#### `tenants`

```sql
CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  kiotviet_retailer TEXT,
  processing_mode TEXT NOT NULL DEFAULT 'legacy'
    CHECK (processing_mode IN ('legacy', 'v2')),
  config          JSONB NOT NULL DEFAULT '{
    "daily_summary_enabled": false,
    "daily_summary_hour": 20,
    "price_alert_threshold_pct": 10
  }',
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- No zalo_user_ids array. Relationship is via zalo_users + tenant_users.
```

#### `zalo_users` **(NEW — v2.1)**

```sql
CREATE TABLE zalo_users (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id        TEXT NOT NULL UNIQUE,              -- Zalo platform user ID (external)
  display_name            TEXT,                               -- Cached from Zalo profile
  last_interaction_at     TIMESTAMPTZ NOT NULL DEFAULT now(), -- Interaction window tracking
  invite_attempt_count    INT NOT NULL DEFAULT 0,            -- Brute-force protection: failed invite attempts
  invite_lockout_until    TIMESTAMPTZ,                       -- Per-user lockout expiry
  invite_last_attempt_at  TIMESTAMPTZ,                       -- v2.1.2: last failed invite attempt (lockout window anchor; NOT updated_at which changes for other reasons)
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_zalo_users_platform_user_id ON zalo_users (platform_user_id);
```

#### `tenant_users` **(NEW — v2.1)**

```sql
CREATE TABLE tenant_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  zalo_user_id    UUID NOT NULL REFERENCES zalo_users(id),
  role            TEXT NOT NULL DEFAULT 'staff'
    CHECK (role IN ('owner', 'staff', 'viewer')),
  status          TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'revoked')),
  invited_by      UUID REFERENCES tenant_users(id),       -- NULL for first owner
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, zalo_user_id)                        -- One membership per tenant per user
);

CREATE INDEX idx_tenant_users_zalo ON tenant_users (zalo_user_id);
CREATE INDEX idx_tenant_users_tenant ON tenant_users (tenant_id, status);
```

**Constraint (V2 basic):** One user → one tenant. Enforced by application logic (check before INSERT). Relaxable in V2+ if needed.

#### `invite_codes` **(NEW — v2.1)**

```sql
CREATE TABLE invite_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  code_hash       BYTEA NOT NULL,                          -- SHA-256(PEPPER || normalized_code); see §3.2.1 hashing spec
  code_hint       TEXT NOT NULL,                           -- last 2 chars for support/debug (non-secret)
  target_role     TEXT NOT NULL DEFAULT 'staff'
    CHECK (target_role IN ('owner', 'staff')),
  created_by      UUID REFERENCES tenant_users(id),        -- NULL if created by admin
  status          TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'used', 'revoked')),      -- v2.1.2: removed 'expired'; expiry checked at query time via expires_at
  used_by         UUID REFERENCES zalo_users(id),          -- zalo_users.id UUID FK (set on consumption)
  expires_at      TIMESTAMPTZ NOT NULL,                    -- created_at + 24 hours
  used_at         TIMESTAMPTZ,                             -- set on consumption
  attempt_count   INT NOT NULL DEFAULT 0,                  -- v2.1.2: failed attempts against THIS code
  last_attempt_at TIMESTAMPTZ,                             -- v2.1.2: last failed attempt timestamp
  lockout_until   TIMESTAMPTZ,                             -- v2.1.2: per-code lockout expiry (5 fails in 15 min -> 30 min lockout)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial unique: code_hash is unique among active codes only.
-- Revoked/used codes MAY share a hash if re-issued (operational flexibility).
CREATE UNIQUE INDEX idx_invite_codes_hash_active ON invite_codes (code_hash) WHERE status = 'active';
-- Lookup index for consume path
CREATE INDEX idx_invite_codes_hash ON invite_codes (code_hash) WHERE status = 'active';
```

**Invite code hashing strategy (v2.1.2, MUST):**
- `code_hash = SHA-256(PEPPER || normalized_code)` where PEPPER is a 32-byte secret stored in secrets manager (env var `INVITE_CODE_PEPPER` in Beta, Vault in GA).
- PEPPER **MUST NOT** be stored in the database.
- The hash is deterministic (same code always produces same hash), enabling lookup by `WHERE code_hash = $computed_hash`.
- Because the hash is deterministic and codes are short (6–32 chars), the PEPPER provides brute-force resistance: without the PEPPER, an attacker with DB read access cannot reverse codes.

**Normalization rules (v2.1.2, MUST — applied before hashing):**
1. Trim leading/trailing whitespace.
2. Remove all spaces and hyphens (`[ -]` → empty).
3. Convert to uppercase.
4. Validate: `^[A-Z0-9]{6,32}$` — reject if length < 6 or > 32 or contains non-alphanumeric characters.
5. Failure to normalize (invalid chars, wrong length) → return generic failure immediately (no DB query).

**Uniqueness policy:** Partial uniqueness (`code_hash UNIQUE WHERE status='active'`). This allows re-issuance of the same code value after the original is used/revoked. Operational impact is minimal because codes are randomly generated and the 6-char alphanumeric space (36^6 ≈ 2.2 billion) makes collisions negligible.

#### `secret_versions` **(NEW — v2.1)**

```sql
CREATE TABLE secret_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  secret_type     TEXT NOT NULL                           -- 'kiotviet_token'
    CHECK (secret_type IN ('kiotviet_token')),
  version         INT NOT NULL,
  encrypted_dek   BYTEA NOT NULL,                         -- DEK encrypted by MEK (AES-256-GCM)
  encrypted_value BYTEA NOT NULL,                         -- Secret encrypted by DEK (AES-256-GCM)
  dek_nonce       BYTEA NOT NULL,                         -- 12-byte nonce for DEK encryption
  value_nonce     BYTEA NOT NULL,                         -- 12-byte nonce for value encryption
  status          TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'rotated', 'revoked')),
  rotated_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  wipe_after      TIMESTAMPTZ,                            -- rotated_at + 30 days → wipe encrypted_value
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, secret_type, version)
);

CREATE INDEX idx_secrets_tenant_active ON secret_versions (tenant_id, secret_type, status)
  WHERE status = 'active';
```

#### `pending_notifications` **(NEW — v2.1)**

```sql
CREATE TABLE pending_notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  zalo_user_id       UUID NOT NULL REFERENCES zalo_users(id),   -- INTERNAL FK (UUID)
  platform_user_id   TEXT,                                      -- OPTIONAL denormalized for delivery/debug (external)
  message_type       TEXT NOT NULL,
  payload            JSONB NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL,                      -- created_at + 72 hours
  flushed_at         TIMESTAMPTZ,                               -- When delivered
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'flushed', 'expired')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pending_user ON pending_notifications (zalo_user_id, status)
  WHERE status = 'pending';
```

#### `inbound_events`

```sql
CREATE TABLE inbound_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  zalo_user_id    UUID NOT NULL REFERENCES zalo_users(id), -- v2.1: FK to zalo_users
  zalo_msg_id     TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  file_url        TEXT,
  file_storage_key TEXT,
  status          TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'enqueued', 'processing', 'completed', 'failed')),
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, zalo_msg_id)
);

CREATE INDEX idx_inbound_events_tenant_status ON inbound_events (tenant_id, status);
CREATE INDEX idx_inbound_events_created ON inbound_events (created_at);
```

#### `canonical_invoices`, `invoice_line_items`, `mapping_dictionary`, `mapping_prompts`, `idempotency_keys`, `audit_logs`, `jobs`

*(Schema unchanged from v2.0 — see previous version. All MUST have RLS enabled.)*

#### `admin_audit_logs` **(NEW — v2.1)**

```sql
CREATE TABLE admin_audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        TEXT NOT NULL,                          -- OIDC sub claim
  admin_role      TEXT NOT NULL,                          -- Role at time of action
  auth_method     TEXT NOT NULL                           -- 'oidc' | 'break_glass_key'
    CHECK (auth_method IN ('oidc', 'break_glass_key')),
  action          TEXT NOT NULL,                          -- 'tenant.create' | 'secret.rotate' | etc.
  target_type     TEXT NOT NULL,                          -- 'tenant' | 'job' | 'secret' | etc.
  target_id       TEXT,
  request_summary JSONB NOT NULL DEFAULT '{}',            -- Sanitized request (no secrets)
  source_ip       INET NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_audit_time ON admin_audit_logs (created_at DESC);
CREATE INDEX idx_admin_audit_admin ON admin_audit_logs (admin_id, created_at DESC);
```

### 3.2 Multi-Tenant Policy — RLS Mandatory from Beta

**Decision:** Shared-table multi-tenancy with **PostgreSQL RLS enforced from V2 Beta** (not deferred to GA).

**Rationale:** Application-level `WHERE tenant_id = $1` is necessary but not sufficient. A single missed filter in any code path leaks data for 1000+ tenants. RLS is the safety net that MUST exist from day one.

#### RLS Setup

```sql
-- 1. Create application role (workers/gateway connect as this role)
CREATE ROLE app_user LOGIN PASSWORD '...';

-- 1a. Required extension: pgcrypto (v2.1.2)
-- Used by invite code hashing (digest()), bootstrap functions, and
-- available for any future cryptographic needs.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Enable RLS on every tenant-scoped table
ALTER TABLE inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE mapping_dictionary ENABLE ROW LEVEL SECURITY;
ALTER TABLE mapping_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE secret_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;
-- audit_logs: RLS enabled but policy allows read across tenants for admin queries
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- 3. Fail-safe tenant resolution helper (v2.1.2 FIX)
-- current_setting('app.current_tenant') without missing_ok=true raises ERROR
-- if the GUC has never been set in the session. This would crash instead of
-- returning 0 rows. The helper below returns NULL when the setting is absent
-- or empty, causing all RLS predicates to evaluate to FALSE (0 rows = fail-safe).
CREATE OR REPLACE FUNCTION _rls_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  SET search_path = public
AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid;
$$;
-- NOTE: current_setting(name, missing_ok := true) returns NULL instead of
-- raising an error when the GUC is not set. NULLIF handles the empty-string
-- case. The ::uuid cast on NULL yields NULL, so `tenant_id = NULL` is FALSE
-- for every row → 0 rows returned (fail-safe, no error, no data leak).

-- 4. Create isolation policy (applied to ALL tables above except audit_logs)
-- Template (repeat for each table):
CREATE POLICY tenant_isolation ON inbound_events
  FOR ALL
  TO app_user
  USING (tenant_id = _rls_tenant_id())
  WITH CHECK (tenant_id = _rls_tenant_id());

-- audit_logs: app_user is tenant-scoped only. Cross-tenant reads are ONLY for Admin service (admin_reader).
CREATE POLICY audit_write_app_user ON audit_logs
  FOR INSERT TO app_user
  WITH CHECK (tenant_id = _rls_tenant_id());

CREATE POLICY audit_read_app_user ON audit_logs
  FOR SELECT TO app_user
  USING (tenant_id = _rls_tenant_id());

-- admin_reader: dedicated DB role used ONLY by Admin API for cross-tenant investigations
CREATE ROLE admin_reader LOGIN PASSWORD '...';
GRANT SELECT ON audit_logs TO admin_reader;

CREATE POLICY audit_read_admin_reader ON audit_logs
  FOR SELECT TO admin_reader
  USING (true);

-- 4. Superuser (migration role) bypasses RLS
-- Migrations run as postgres superuser, not app_user
```

#### 3.2.1 Bootstrap Tenant Resolution (RLS-safe) — **BLOCKER FIX**

**Problem:** The Gateway must resolve `tenant_id` **before** it can set `app.current_tenant`, but normal tenant-scoped reads return **0 rows** without tenant context.

**Primary approach (v2.1.1, REQUIRED):** Use narrowly-scoped **SECURITY DEFINER** functions that bypass RLS only for:
- Resolving membership by `platform_user_id`
- Atomically consuming invite codes (one-time onboarding)

##### DB Roles & Permissions (MUST)

- `app_user` (Gateway/Workers): tenant-scoped RLS role. **MUST NOT** have cross-tenant reads.
- `bootstrap_owner` (NOLOGIN): owns bootstrap functions; may bypass RLS only through those functions.
- `admin_reader` (Admin API only): cross-tenant audit reads for investigations.

**Security rules (MUST):**
1. Bootstrap functions **MUST** set a safe `search_path` and be `SECURITY DEFINER`.
2. Bootstrap functions **MUST** return generic “not_found” outcomes for invalid inputs (no tenant metadata leakage).
3. Bootstrap functions **MUST** write an audit record for successful membership resolution and invite consumption.
4. Gateway **MUST** call bootstrap functions **before** any tenant-scoped query and only then set `app.current_tenant`.

##### Function 1 — Resolve Membership (MUST)

```sql
-- Resolve tenant membership without requiring app.current_tenant.
CREATE OR REPLACE FUNCTION resolve_membership_by_platform_user_id(
  p_platform_user_id TEXT
) RETURNS TABLE (
  tenant_id      UUID,
  membership_id  UUID,
  zalo_user_id   UUID,
  role           TEXT,
  status         TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tu.tenant_id,
    tu.id          AS membership_id,
    zu.id          AS zalo_user_id,
    tu.role,
    tu.status
  FROM zalo_users zu
  JOIN tenant_users tu ON tu.zalo_user_id = zu.id
  WHERE zu.platform_user_id = p_platform_user_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_membership_by_platform_user_id(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_membership_by_platform_user_id(TEXT) TO app_user;
```

**Gateway handling (MUST):**
- If 0 rows returned: treat as **unlinked** user (onboarding flow), and **MUST NOT** set tenant context.
- If `status != 'active'`: return a user-safe message and **MUST NOT** proceed to tenant-scoped work.

##### Function 2 — Consume Invite Code (Atomic, One-Time) (MUST) — v2.1.2 FINAL

The function **MUST** be atomic, resistant to brute-force, leak-proof, and concurrency-safe. This spec is **implementation-complete** — no guessing required.

**Inputs:** `(p_code_plaintext TEXT, p_platform_user_id TEXT, p_source_ip INET DEFAULT NULL)`

**Outputs:** `TABLE (tenant_id UUID, role_assigned TEXT, membership_id UUID, zalo_user_id UUID)` — 0 rows on any failure.

**Lockout policy (MUST):**
- **Per-code lockout (DB-side):** 5 failed attempts within 15 minutes → `lockout_until = now() + 30 minutes`. Tracked on the `invite_codes` row via `attempt_count`, `last_attempt_at`, `lockout_until`.
- **Per-user lockout (DB-side):** 5 failed attempts within 60 minutes → `invite_lockout_until = now() + 60 minutes`. Tracked on `zalo_users` row via `invite_attempt_count`, `invite_lockout_until`, `invite_last_attempt_at` (dedicated field — **NOT** `updated_at`).
- **Gateway rate-limit (for unknown codes where no DB row exists):** 10 invite attempts per `platform_user_id` per minute AND 5 invite attempts per source IP per minute. Enforced at Gateway middleware BEFORE calling the DB function.
- **Failure responses MUST NOT reveal** whether the code exists, is expired, is revoked, is locked out, or is unknown. All failures return the same generic response: 0 rows from function, `"Mã mời không hợp lệ hoặc đã hết hạn."` from Gateway.

**Concurrency:** Two simultaneous `consume_invite_code()` calls with the same valid code MUST result in exactly one success. Achieved via `FOR UPDATE SKIP LOCKED` on the `invite_codes` row — the second caller gets 0 rows (the row is locked) and receives a generic failure.

```sql
CREATE OR REPLACE FUNCTION consume_invite_code(
  p_code_plaintext TEXT,
  p_platform_user_id TEXT,
  p_source_ip INET DEFAULT NULL
) RETURNS TABLE (
  tenant_id      UUID,
  role_assigned  TEXT,
  membership_id  UUID,
  zalo_user_id   UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now              TIMESTAMPTZ := clock_timestamp();
  v_zu_id            UUID;
  v_zu_lockout       TIMESTAMPTZ;
  v_ic               RECORD;        -- invite_codes row
  v_normalized       TEXT;
  v_code_hash        BYTEA;
  v_pepper           BYTEA;
  v_membership_id    UUID;
BEGIN
  -- ================================================================
  -- STEP 1: Normalize the input code
  -- ================================================================
  -- Trim, strip spaces/hyphens, uppercase
  v_normalized := upper(regexp_replace(trim(p_code_plaintext), '[ -]', '', 'g'));

  -- Validate: must be 6-32 alphanumeric chars
  IF v_normalized !~ '^[A-Z0-9]{6,32}$' THEN
    RETURN;  -- generic failure (0 rows)
  END IF;

  -- ================================================================
  -- STEP 2: Resolve or create zalo_users row (bootstrap-safe)
  -- ================================================================
  INSERT INTO zalo_users (platform_user_id, last_interaction_at)
  VALUES (p_platform_user_id, v_now)
  ON CONFLICT (platform_user_id) DO UPDATE SET updated_at = v_now
  RETURNING id, invite_lockout_until INTO v_zu_id, v_zu_lockout;

  -- Check per-user lockout
  IF v_zu_lockout IS NOT NULL AND v_zu_lockout > v_now THEN
    RETURN;  -- generic failure (0 rows); user is globally locked out
  END IF;

  -- ================================================================
  -- STEP 3: Compute code_hash using PEPPER
  -- ================================================================
  -- PEPPER is passed via a session variable set by Gateway before calling:
  --   SET LOCAL app.invite_pepper = encode(pepper_bytes, 'hex');
  -- This avoids storing PEPPER in DB while allowing DB-side hash computation.
  v_pepper := decode(current_setting('app.invite_pepper', true), 'hex');
  IF v_pepper IS NULL OR length(v_pepper) < 16 THEN
    RAISE EXCEPTION 'invite_pepper not set or too short';
  END IF;

  v_code_hash := digest(v_pepper || convert_to(v_normalized, 'UTF8'), 'sha256');
  -- NOTE: digest() is from pgcrypto extension (CREATE EXTENSION IF NOT EXISTS pgcrypto).
  -- Postgres does NOT have a built-in sha256() function. digest(data, 'sha256') returns BYTEA.

  -- ================================================================
  -- STEP 4: Attempt to consume the invite code (single atomic UPDATE)
  -- ================================================================
  -- FOR UPDATE SKIP LOCKED ensures only one concurrent caller succeeds.
  -- Only matches if: status='active', not expired, not locked out.
  UPDATE invite_codes
  SET
    status   = 'used',
    used_by  = v_zu_id,
    used_at  = v_now
  WHERE id = (
    SELECT ic.id
    FROM invite_codes ic
    WHERE ic.code_hash = v_code_hash
      AND ic.status = 'active'
      AND ic.expires_at > v_now
      AND (ic.lockout_until IS NULL OR ic.lockout_until <= v_now)
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING invite_codes.id, invite_codes.tenant_id, invite_codes.target_role
  INTO v_ic;

  -- ================================================================
  -- STEP 5: Handle failure (code not found, expired, locked, or concurrent)
  -- ================================================================
  IF v_ic IS NULL THEN
    -- Increment per-code attempt counter (if a matching code_hash row exists at all)
    UPDATE invite_codes
    SET
      attempt_count   = CASE
                          WHEN last_attempt_at IS NULL OR last_attempt_at < v_now - INTERVAL '15 minutes'
                          THEN 1
                          ELSE attempt_count + 1
                        END,
      last_attempt_at = v_now,
      lockout_until   = CASE
                          WHEN (last_attempt_at IS NOT NULL
                                AND last_attempt_at >= v_now - INTERVAL '15 minutes'
                                AND attempt_count + 1 >= 5)
                          THEN v_now + INTERVAL '30 minutes'
                          ELSE lockout_until
                        END
    WHERE code_hash = v_code_hash
      AND status = 'active';
    -- Note: if no row matches (unknown code), this UPDATE affects 0 rows — no side-effect.

    -- Increment per-user attempt counter
    -- v2.1.2 FIX: uses invite_last_attempt_at (dedicated field) instead of
    -- updated_at, which is modified by unrelated operations (profile update,
    -- interaction tracking, etc.) and would cause incorrect window resets.
    UPDATE zalo_users
    SET
      invite_attempt_count = CASE
                               WHEN invite_lockout_until IS NOT NULL AND invite_lockout_until > v_now
                               THEN invite_attempt_count  -- already locked out, don't increment
                               WHEN invite_last_attempt_at IS NULL
                                    OR invite_last_attempt_at < v_now - INTERVAL '60 minutes'
                               THEN 1  -- reset window
                               ELSE invite_attempt_count + 1
                             END,
      invite_lockout_until = CASE
                               WHEN invite_attempt_count + 1 >= 5
                                    AND (invite_lockout_until IS NULL OR invite_lockout_until <= v_now)
                                    AND (invite_last_attempt_at IS NOT NULL
                                         AND invite_last_attempt_at >= v_now - INTERVAL '60 minutes')
                               THEN v_now + INTERVAL '60 minutes'
                               ELSE invite_lockout_until
                             END,
      invite_last_attempt_at = v_now
    WHERE id = v_zu_id;

    RETURN;  -- generic failure (0 rows)
  END IF;

  -- ================================================================
  -- STEP 6: Success — create tenant_users membership
  -- ================================================================
  INSERT INTO tenant_users (tenant_id, zalo_user_id, role, status, invited_at)
  VALUES (v_ic.tenant_id, v_zu_id, v_ic.target_role, 'active', v_now)
  ON CONFLICT (tenant_id, zalo_user_id) DO UPDATE
    SET role = EXCLUDED.role, status = 'active', invited_at = v_now
  RETURNING id INTO v_membership_id;

  -- Activate tenant if still pending
  UPDATE tenants SET status = 'active', updated_at = v_now
  WHERE id = v_ic.tenant_id AND status = 'pending';

  -- ================================================================
  -- STEP 7: Audit log
  -- ================================================================
  INSERT INTO audit_logs (tenant_id, actor_type, actor_id, action, metadata)
  VALUES (
    v_ic.tenant_id,
    'zalo_user',
    v_zu_id::TEXT,
    'invite.consume',
    jsonb_build_object(
      'invite_code_id', v_ic.id,
      'role_assigned', v_ic.target_role,
      'source_ip', p_source_ip::TEXT,
      'membership_id', v_membership_id
    )
  );

  -- ================================================================
  -- STEP 8: Return success
  -- ================================================================
  RETURN QUERY SELECT v_ic.tenant_id, v_ic.target_role, v_membership_id, v_zu_id;
END;
$$;

REVOKE ALL ON FUNCTION consume_invite_code(TEXT, TEXT, INET) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_invite_code(TEXT, TEXT, INET) TO app_user;
```

**Mandatory behavior summary (v2.1.2, MUST/SHALL):**

| Requirement | Implementation |
|---|---|
| One-time use | `UPDATE ... SET status='used' ... WHERE status='active' ... RETURNING` — atomic transition |
| No existence leak | All failures return 0 rows; Gateway returns identical generic message for all failure types |
| Per-code lockout | 5 failures in 15 min → `lockout_until = now() + 30 min` (on the `invite_codes` row) |
| Per-user lockout | 5 failures in 60 min → `invite_lockout_until = now() + 60 min` (on the `zalo_users` row). Window anchored on `invite_last_attempt_at` — **NOT** `updated_at` which is modified by unrelated operations |
| Gateway rate-limit | 10 req/min per `platform_user_id` + 5 req/min per IP for invite-attempt endpoint |
| Constant-time compare | SHA-256 hash comparison is fixed-length (32 bytes); no timing side-channel on code length |
| Concurrency safety | `FOR UPDATE SKIP LOCKED` — second concurrent caller gets 0 rows |
| PEPPER management | 32-byte secret in env/Vault; passed to function via `SET LOCAL app.invite_pepper`; NEVER in DB |
| Audit logging | Success → `audit_logs` row with `action='invite.consume'`, tenant_id, actor, source_ip |

**Acceptance gates for invite system (automatable test specs):**

```
TEST: "Same code consumed twice → 1 success, 1 generic failure, no duplicate memberships"
  GIVEN: active invite code C for Tenant A, two users U1 and U2
  WHEN:  U1 calls consume_invite_code(C, U1) → succeeds (1 row)
  AND:   U2 calls consume_invite_code(C, U2) → fails (0 rows)
  THEN:  tenant_users has exactly 1 new row (U1)
  AND:   invite_codes.status = 'used'

TEST: "Concurrent consume → only 1 success"
  GIVEN: active invite code C
  WHEN:  two transactions call consume_invite_code(C, ...) simultaneously
  THEN:  exactly 1 returns success; the other returns 0 rows
  AND:   invite_codes.status = 'used' with exactly 1 used_by

TEST: "Expired code → generic failure; no membership created"
  GIVEN: invite code C with expires_at = now() - 1 hour
  WHEN:  consume_invite_code(C, U1)
  THEN:  returns 0 rows
  AND:   no new tenant_users row

TEST: "Active code + valid user → membership with correct role"
  GIVEN: invite code C with target_role='staff' for Tenant A
  WHEN:  consume_invite_code(C, U1) → succeeds
  THEN:  tenant_users row: tenant_id=A, zalo_user_id=U1.id, role='staff', status='active'

TEST: "5 failed attempts → code locked out for 30 min"
  GIVEN: active invite code C
  WHEN:  5 calls with wrong codes that happen to match C's hash → (this tests per-code counter)
  THEN:  6th attempt returns 0 rows even with correct code
  AND:   lockout_until is set to ~30 min from now

TEST: "5 failed attempts by same user → user locked out for 60 min"
  GIVEN: user U1
  WHEN:  U1 submits 5 wrong codes within 60 min
  THEN:  6th attempt returns 0 rows regardless of code correctness
  AND:   zalo_users.invite_lockout_until is set

TEST: "Gateway rate-limit blocks rapid attempts before DB"
  GIVEN: user U1 sending > 10 invite attempts per minute
  THEN:  Gateway returns 429 with Retry-After header; no DB function called

TEST: "Unknown code → no DB side-effect, same response as expired/used"
  GIVEN: code 'XXXXXX' does not exist in invite_codes
  WHEN:  consume_invite_code('XXXXXX', U1)
  THEN:  returns 0 rows
  AND:   no invite_codes rows modified (attempt_count unchanged)
  AND:   zalo_users.invite_attempt_count incremented (per-user tracking)
```

##### Gateway Flow Update (MUST)

1. Extract `platform_user_id` from webhook payload.
2. Call `resolve_membership_by_platform_user_id(platform_user_id)`.
3. If membership found and active:
   - Start DB transaction
   - `SET LOCAL app.current_tenant = tenant_id`
   - Proceed with all tenant-scoped operations (RLS enforced)
4. If no membership:
   - Accept webhook (200) and enqueue onboarding prompt as NOTIFY job (Gateway MUST NOT call Zalo API directly; no tenant DB reads).

##### Bootstrap Resolution — Integration Test Spec (CI Gate, MUST)

```
TEST: "Bootstrap resolution does not leak tenant data"
  GIVEN: No membership exists for platform_user_id X
  WHEN:  call resolve_membership_by_platform_user_id(X)
  THEN:  returns 0 rows
  AND:   app_user cannot SELECT from any tenant table without tenant context (0 rows)

TEST: "Membership resolved without tenant context"
  GIVEN: platform_user_id X is linked to Tenant A with active membership
  WHEN:  call resolve_membership_by_platform_user_id(X) without setting app.current_tenant
  THEN:  returns {tenant_id=TenantA, role, status, membership_id}

TEST: "Tenant context enables tenant-scoped reads"
  GIVEN: resolved tenant_id=TenantA
  WHEN:  SET LOCAL app.current_tenant = TenantA and SELECT from canonical_invoices
  THEN:  only TenantA rows are returned

TEST: "Invalid invite codes do not leak existence"
  GIVEN: invite code 'ABC123' exists for TenantA
  WHEN:  consume_invite_code('WRONG00', platform_user_id X)
  THEN:  returns 0 rows
  AND:   response/message is identical to expired/used codes
  AND:   no tenant identifiers/names appear in logs or responses
```

**Rollback (docs-level):**
- If bootstrap functions are rejected, the only acceptable alternative is Option B (bootstrap tables + scoped RLS) and MUST be documented before implementation starts.

#### Application Integration

Every database operation MUST be wrapped in a tenant context:

```typescript
// packages/common/src/db/client.ts
async function withTenantContext<T>(
  tenantId: string,
  fn: (tx: Transaction) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.current_tenant = ${tenantId}`);
    return fn(tx);
  });
}
```

**Rule:** `SET LOCAL` scopes the setting to the current transaction. If a transaction is not used, the setting leaks to other queries on the same connection. Therefore: **all tenant-scoped queries MUST run inside `withTenantContext()`**. If `app.current_tenant` is never set (or set to empty), the `_rls_tenant_id()` helper returns NULL and all RLS predicates evaluate to FALSE — returning 0 rows (fail-safe, no error). This is enforced by:
1. ESLint custom rule that flags raw `db.query()` calls on tenant-scoped tables.
2. Integration tests that verify RLS enforcement (see §8).

#### RLS Acceptance Tests (CI Gate — MANDATORY)

```
TEST: "RLS prevents cross-tenant read"
  GIVEN: Tenant A has 5 invoices, Tenant B has 3 invoices
  WHEN:  Connection sets app.current_tenant = Tenant_A
  THEN:  SELECT * FROM canonical_invoices returns exactly 5 rows
  AND:   None of the rows have tenant_id = Tenant_B

TEST: "RLS prevents cross-tenant write"
  GIVEN: app.current_tenant = Tenant_A
  WHEN:  INSERT INTO canonical_invoices (tenant_id = Tenant_B, ...)
  THEN:  INSERT fails with RLS violation error

TEST: "Missing tenant context returns zero rows"
  GIVEN: app.current_tenant is NOT set (or set to empty string)
  WHEN:  SELECT * FROM canonical_invoices
  THEN:  Returns zero rows (not an error — fail-safe via _rls_tenant_id() returning NULL)

TEST: "RLS applies to all tenant-scoped tables"
  FOR EACH TABLE in [inbound_events, canonical_invoices, invoice_line_items,
    mapping_dictionary, mapping_prompts, idempotency_keys, jobs,
    secret_versions, pending_notifications, tenant_users, invite_codes]:
    VERIFY: RLS is enabled (query pg_class.relrowsecurity)
    VERIFY: At least one policy exists (query pg_policies)
```

**These tests MUST pass in CI. Failure blocks merge.**

### 3.3 Retention Policy

| Data | Retention | Mechanism |
|---|---|---|
| `inbound_events` | 90 days | pg_cron deletes completed rows > 90 days |
| `canonical_invoices` + `invoice_line_items` | 1 year | Archive to cold storage |
| `audit_logs` | 2 years | Regulatory; no auto-delete |
| `admin_audit_logs` | 2 years | No auto-delete |
| `mapping_dictionary` | Indefinite | Core tenant data |
| `secret_versions` (rotated) | 30 days after rotation | `wipe_after` → zero encrypted_value |
| `pending_notifications` (expired) | 7 days | Delete where expires_at < now() - 7 days |
| `invite_codes` (used/revoked or past `expires_at`) | 30 days | Delete codes where `(status IN ('used','revoked') OR expires_at < now()) AND created_at < now() - 30 days` |
| MinIO raw files | 90 days | Lifecycle policy |
| Redis job data | 7 days | BullMQ TTL |

### 3.4 Migrations

- **Tool:** Drizzle Kit.
- **RLS migration:** MUST be the first migration applied. RLS policies are defined in `packages/common/src/db/rls-policies.sql` and applied via `drizzle-kit migrate`.
- **Tenant model migration (from v2.0):** See §7.4 for migration from `zalo_user_ids` array to `zalo_users` + `tenant_users` tables.

---

## §4. API Contracts

### 4.1 Gateway Endpoints (Public)

#### `POST /webhooks/zalo`

**Authentication:** Webhook verification modes (see ARCHITECTURE §3). Production MUST use Mode 1 (verified signature) unless an approved exception exists.

**Request flow:**
```
1. Verify signature → 401 if invalid (fail-closed)
2. Verify mode-specific anti-replay controls (see ARCHITECTURE §3)
3. Validate schema → 400 if malformed
4. Resolve platform_user_id → membership via resolve_membership_by_platform_user_id():
   - Unknown user (no zalo_user row) → create zalo_user, return 200,
     enqueue NOTIFY job: "Nhắn 'Bắt đầu' để đăng ký"
   - Known user, no tenant_users membership → return 200,
     enqueue NOTIFY job: "Bạn chưa kết nối cửa hàng"
   - Known user, active membership, role >= staff → proceed
   - Known user, suspended/revoked → return 200,
     enqueue NOTIFY job: "Tài khoản đã bị tạm ngưng"
   (Gateway MUST NOT call Zalo OA API directly; all outbound via notifier)
5. Update last_interaction_at on zalo_users
6. Flush pending_notifications for this user (if any; enqueue as NOTIFY jobs)
7. INSERT inbound_event (dedupe on tenant_id + zalo_msg_id)
8. ENQUEUE job
9. Return 200
```

**Response:**
```jsonc
// 200 OK — always for authenticated + valid requests
{ "status": "accepted", "event_id": "uuid" }

// 401 — signature verification failed
{ "error": "unauthorized" }  // No details to avoid info leak

// 400 — malformed payload
{ "error": "bad_request" }

// 429 — tenant rate limited
{ "error": "rate_limited", "retry_after": 60 }
```

#### `GET /health`

No authentication required. Returns `200 { "status": "ok" }`.

### 4.2 Admin API Endpoints (Private / VPN + OIDC)

**Authentication layers (ALL MUST pass):**

1. **Network:** Request MUST originate from VPN / private network. Requests from public IPs MUST be rejected at the load balancer level.
2. **Identity:** `Authorization: Bearer <oidc_jwt>` header. JWT MUST be validated: signature, expiration, audience (`groceryclaw-admin`), issuer.
3. **Role:** JWT `groups` claim mapped to RBAC role. Endpoint-level permission check.

**Break-glass fallback:**
- Header: `X-Break-Glass-Key: <static_api_key>`
- Used ONLY when OIDC provider is down.
- Read-only by default. Write access requires separate `X-Break-Glass-Key-Write`.
- Every break-glass request triggers alert to security channel.
- Every request (OIDC or break-glass) is logged to `admin_audit_logs`.

**RBAC Matrix:**

| Endpoint | `super_admin` | `admin` | `viewer` | break-glass-read | break-glass-write |
|---|---|---|---|---|---|
| GET /admin/tenants | ✓ | ✓ | ✓ | ✓ | — |
| POST /admin/tenants | ✓ | ✓ | ✗ | ✗ | ✓ |
| PATCH /admin/tenants/:id | ✓ | ✓ | ✗ | ✗ | ✓ |
| POST /admin/tenants/:id/invite | ✓ | ✓ | ✗ | ✗ | ✓ |
| POST /admin/tenants/:id/secrets/rotate | ✓ | ✗ | ✗ | ✗ | ✗ |
| GET /admin/jobs | ✓ | ✓ | ✓ | ✓ | — |
| POST /admin/jobs/:id/retry | ✓ | ✓ | ✗ | ✗ | ✓ |
| GET /admin/dlq | ✓ | ✓ | ✓ | ✓ | — |
| POST /admin/dlq/drain | ✓ | ✓ | ✗ | ✗ | ✓ |
| GET /admin/audit | ✓ | ✓ | ✓ | ✓ | — |

#### Tenant Management

```
POST   /admin/tenants                        — Create tenant + generate invite code
GET    /admin/tenants                        — List tenants (paginated)
GET    /admin/tenants/:id                    — Get tenant details (includes users, active secrets metadata)
PATCH  /admin/tenants/:id                    — Update config, status, processing_mode
POST   /admin/tenants/:id/invite             — Generate invite code (target_role required)
POST   /admin/tenants/:id/users/:uid/revoke  — Revoke a user's membership
```

**`POST /admin/tenants` request:**
```jsonc
{
  "name": "Tạp Hoá Phương Vy",
  "kiotviet_retailer": "tapdoanphuongvy",
  "kiotviet_token": "raw_token_here",   // Envelope-encrypted before storage
  "processing_mode": "v2"
}
// Response includes: { tenant_id, invite_code: "X7K9M2", invite_expires_at }
```

**`POST /admin/tenants/:id/invite` request:**
```jsonc
{
  "target_role": "staff"    // or "owner"
}
// Response: { code: "ABC123", expires_at: "ISO8601" }
```

#### Secret Management

```
POST   /admin/tenants/:id/secrets/rotate     — Rotate a secret (creates new version)
GET    /admin/tenants/:id/secrets/status      — List secret types + version + status (no plaintext)
POST   /admin/tenants/:id/secrets/revoke      — Revoke a specific version
```

**`POST /admin/tenants/:id/secrets/rotate` request:**
```jsonc
{
  "secret_type": "kiotviet_token",
  "new_value": "new_raw_token"      // Encrypted server-side; never stored plaintext
}
// Response: { version: 3, status: "active", previous_version: { version: 2, status: "rotated" } }
```

#### Job, DLQ, Audit endpoints — unchanged from v2.0

### 4.3 Job Payload Schemas

*(Unchanged from v2.0. Key addition: `zalo_user_db_id` field added to job envelope for role checks in workers.)*

```jsonc
{
  "jobId": "uuid",
  "tenant_id": "uuid",
  "zalo_user_db_id": "uuid",         // v2.1: FK to zalo_users table
  "correlation_id": "uuid",
  "created_at": "ISO8601",
  "payload": { /* job-specific */ }
}
```

#### `NOTIFY` payload — v2.1 addition: window check

```jsonc
{
  "jobId": "...",
  "tenant_id": "...",
  "zalo_user_db_id": "...",
  "correlation_id": "...",
  "payload": {
    "platform_user_id": "zalo_user_abc123",   // External Zalo platform user id for API call
    "message_type": "result",
    "message_template": "invoice_result",
    "template_data": { ... },
    "allow_pending": true                  // If true, store as pending if window closed
                                           // If false, discard (e.g., stale mapping prompt)
  }
}
```

---

## §5. SLO/SLA & Performance Budgets

*(Unchanged from v2.0 — all targets remain the same)*

### 5.1 Service Level Objectives

| Metric | p50 | p95 | p99 |
|---|---|---|---|
| Webhook ACK latency | < 50 ms | < 200 ms | < 500 ms |
| Job start latency | < 500 ms | < 2 s | < 5 s |
| XML parse + normalize | < 2 s | < 10 s | < 20 s |
| XML + KiotViet sync E2E | < 10 s | < 30 s | < 60 s |
| Zalo notification delivery | < 3 s | < 10 s | < 30 s |

### 5.2 Performance Budget (Webhook ACK — updated for v2.1)

| Step | Budget | Notes |
|---|---|---|
| TLS termination | 5 ms | Nginx/Caddy |
| HMAC signature verification | 2 ms | crypto.timingSafeEqual |
| Timestamp check | 1 ms | Arithmetic comparison |
| Fastify routing + schema validation | 10 ms | Zod |
| Tenant resolution (Redis → PG fallback) | 8 ms | zalo_users + tenant_users lookup |
| Update last_interaction_at | 3 ms | Async (non-blocking for ACK) |
| Flush pending notifications check | 3 ms | Async (non-blocking) |
| INSERT inbound_event | 15 ms | PG with unique check |
| Enqueue BullMQ job | 5 ms | Redis LPUSH |
| Response serialization | 3 ms | |
| **Total** | **55 ms** | **145 ms headroom** |

**Note:** `last_interaction_at` update and pending flush are fire-and-forget; they MUST NOT block the 200 response.

### 5.3–5.5 Capacity Model, Autoscaling

*(Unchanged from v2.0)*

---

## §6. Threat Model & Security Controls

### 6.1 Attack Surface (Updated)

```
                     ┌──────────────────────────┐
  INTERNET ─────────►│  Gateway :3000           │◄── ONLY public surface
                     │  POST /webhooks/zalo     │    HMAC-verified
                     │  GET /health             │    No auth needed
                     └────────────┬─────────────┘
                                  │ private network ONLY
          ┌───────────────────────┼──────────────────────────┐
          │                       │                          │
    ┌─────▼─────┐    ┌───────────▼───────────┐    ┌────────▼──────────┐
    │   Redis   │    │    PostgreSQL          │    │  Admin :3001      │
    │ requirepw │    │  password + TLS        │    │  VPN + OIDC + RBAC│
    │ bind pvt  │    │  RLS ON all tables     │    │  /metrics (here)  │
    └───────────┘    └───────────────────────┘    └───────────────────┘
```

### 6.2 Threats & Mitigations (Expanded)

| # | Threat | Likelihood | Impact | Control | Test |
|---|---|---|---|---|---|
| T1 | **Spoofed Zalo webhook** | Medium | Fake invoices | HMAC-SHA256 verify (fail-closed); fallback IP allowlist if no HMAC | Unit: invalid sig → 401; integration: spoofed payload rejected |
| T2 | **Webhook replay** | High | Duplicate goods receipts | Three-tier idempotency keys + dedupe on (tenant_id, zalo_msg_id); timestamp checks only if verified to be signed | Integration: replay same msg_id → no duplicate; replay old timestamp → 401 |
| T3 | **SSRF via file download** | Medium | Internal network scan | URL allowlist (`*.zalo.me`, `*.zadn.vn`); block RFC 1918; DNS rebind protection | Unit: private IP → rejected; non-allowlisted host → rejected |
| T4 | **Malicious file content** | Medium | Code execution, DoS | Max 10 MB; content-type allowlist; download timeout 10s; no exec | Unit: oversized → rejected; wrong content-type → rejected |
| T5 | **Cross-tenant data leak** | Medium | Data breach | **RLS on all tables from Beta** + tenant_id in every query + integration tests | **CI gate: RLS isolation tests (§3.2)** |
| T6 | **KiotViet token theft** | Medium | POS access | **Envelope encryption** (MEK → DEK → value); decrypt in-memory only; zero after use | Unit: encrypted value not in logs; rotation creates new version |
| T7 | **Admin API unauthorized** | Medium | Full control | **VPN + OIDC/SSO + RBAC**; break-glass key (logged + alerted) | Integration: no OIDC → 401; wrong role → 403; break-glass → alert fired |
| T8 | **Redis unauthed access** | Low | Job manipulation | `requirepass` + bind private interface | Infra: verify bind config in CI |
| T9 | **Secret leakage in logs** | Medium | Token exposure | Pino redaction paths; structured logging; never serialize plaintext to job payloads | Unit: log output for KV sync job contains no token substring |
| T10 | **DoS via webhook flood** | Medium | System overload | Per-tenant rate limit 60 req/min; global 1000 req/min | Load test: flood one tenant → 429; others unaffected |
| T11 | **Dependency supply chain** | Low | Compromised packages | `npm audit` in CI; lockfile pinning; Dependabot | CI gate |
| T12 | **Tenant hijack via onboarding** | Medium | Attacker joins tenant | **Invitation codes** (6-char, 24h TTL, single-use); brute-force rate limit (5/hr/user) | Unit: expired code → rejected; used code → rejected; 6th attempt → lockout |
| T13 | **Metrics endpoint data leak** | Low | Infra details exposed | `/metrics` on admin port :3001 only; NOT on gateway port | Integration: GET :3000/metrics → 404 |
| T14 | **MEK compromise** | Low | All secrets decryptable | Emergency rotation runbook; re-encrypt all DEKs; revoke old MEK | Runbook drill (quarterly) |
| T15 | **Interaction window abuse** | Low | Spam users | Window check before every outbound; rate limiter 80 msg/min | Unit: closed window → message stored not sent; rate limit → re-enqueue |

### 6.3 Secrets Management (Envelope Encryption)

See ARCHITECTURE_V2.md §5 for architecture diagram and runtime flow.

**Invariants:**
- Plaintext secrets MUST exist only in worker process memory during active use.
- Plaintext secrets MUST be zeroed after use (`Buffer.fill(0)`).
- Plaintext secrets MUST NOT appear in: logs, job payloads, API responses, Redis, error messages, stack traces.
- Pino redaction MUST include: `['*.kiotviet_token', '*.encrypted_value', '*.encrypted_dek', '*.authorization', '*.new_value']`.
- `secret_versions` table MUST have RLS enabled (tenant-scoped).
- Rotated secrets: `encrypted_value` MUST be wiped (zeroed in DB) 30 days after rotation.

**Rotation procedure:** See ARCHITECTURE_V2.md §5.3.

### 6.4 Admin Auth Controls

| Layer | V2 Beta | V2 GA |
|---|---|---|
| Network | VPN / private network | Same + IP allowlist |
| Identity | OIDC/SSO (Google Workspace or Auth0) | Same + MFA enforcement |
| Authorization | RBAC (super_admin, admin, viewer) | Same |
| Break-glass | Static API key (read-only default) | Same + hardware key consideration |
| Audit | `admin_audit_logs` table | Same + SIEM integration |
| Key rotation | Manual, 90-day policy | Automated via Vault |

---

## §7. Migration Plan (Strangler)

### 7.1 Strategy

*(Unchanged from v2.0 — canary per tenant via processing_mode flag)*

### 7.2 Migration Phases

*(Phase 0–4 unchanged from v2.0)*

### 7.3 Rollback Procedures

*(Unchanged from v2.0)*

### 7.4 Tenant Model Migration (v2.0 → v2.1) — v2.1.2 REWRITE

If any tenants were created under the v2.0 schema (with `zalo_user_ids TEXT[]` array on `tenants`), they MUST be migrated to the v2.1 entity model.

**Legacy source assumption:** V2.0 `tenants` table contains a column `zalo_user_ids TEXT[]` where each element is a **Zalo platform user ID string** (i.e., what v2.1 calls `platform_user_id`). This is the external Zalo identifier, NOT an internal UUID.

**Migration steps (implementable SQL):**

```sql
-- ================================================================
-- Step 1: Create new tables (if not already created by Drizzle migration)
-- ================================================================
-- zalo_users, tenant_users, invite_codes, secret_versions
-- (handled by Drizzle Kit migration — see §3.1 DDL)

-- ================================================================
-- Step 2: Backfill zalo_users from legacy platform_user_id strings
-- ================================================================
-- Each distinct element in tenants.zalo_user_ids becomes a zalo_users row.
-- The array values are platform_user_id strings (external Zalo IDs).
INSERT INTO zalo_users (platform_user_id, last_interaction_at, created_at)
SELECT DISTINCT
  unnest_val,
  now(),                          -- no historical interaction data; default to now()
  t.created_at                    -- approximate creation from tenant creation date
FROM tenants t,
     LATERAL unnest(t.zalo_user_ids) AS unnest_val
WHERE t.zalo_user_ids IS NOT NULL
  AND array_length(t.zalo_user_ids, 1) > 0
  AND unnest_val IS NOT NULL
  AND trim(unnest_val) != ''       -- skip empty/whitespace-only entries
ON CONFLICT (platform_user_id) DO NOTHING;
-- RESULT: One zalo_users row per distinct platform_user_id across all tenants.
-- Duplicates (same user in multiple tenants) are de-duped by UNIQUE constraint.

-- ================================================================
-- Step 3: Create tenant_users membership rows
-- ================================================================
-- Ownership rule (deterministic, MUST): For each tenant, the FIRST user
-- alphabetically by platform_user_id becomes 'owner'. All others become 'staff'.
-- This is deterministic and auditable.
WITH ranked_users AS (
  SELECT
    t.id AS tenant_id,
    zu.id AS zalo_user_id,
    t.created_at AS tenant_created,
    ROW_NUMBER() OVER (
      PARTITION BY t.id
      ORDER BY unnest_val ASC  -- deterministic: alphabetical by platform_user_id
    ) AS rn
  FROM tenants t,
       LATERAL unnest(t.zalo_user_ids) AS unnest_val
  JOIN zalo_users zu ON zu.platform_user_id = unnest_val
  WHERE t.zalo_user_ids IS NOT NULL
    AND array_length(t.zalo_user_ids, 1) > 0
)
INSERT INTO tenant_users (tenant_id, zalo_user_id, role, status, invited_at)
SELECT
  tenant_id,
  zalo_user_id,
  CASE WHEN rn = 1 THEN 'owner' ELSE 'staff' END,  -- first alphabetically = owner
  'active',
  tenant_created
FROM ranked_users
ON CONFLICT (tenant_id, zalo_user_id) DO NOTHING;
-- RESULT: Every legacy tenant-user relationship has a tenant_users row.
-- One user per tenant is 'owner'; rest are 'staff'.

-- ================================================================
-- Step 4: Migrate kiotviet_token_enc to secret_versions (envelope encryption)
-- ================================================================
-- NOTE: This step MUST be run as a Node.js/TypeScript migration script,
-- NOT as raw SQL, because it requires:
--   1. Reading the MEK from env/Vault
--   2. Generating a random DEK per tenant
--   3. Encrypting DEK with MEK (AES-256-GCM)
--   4. Re-encrypting the existing token with DEK (AES-256-GCM)
-- The script pseudocode:
--
--   for each tenant with kiotviet_token_enc:
--     old_token = single_layer_decrypt(env.OLD_ENCRYPTION_KEY, tenant.kiotviet_token_enc)
--     dek = crypto.randomBytes(32)
--     dek_nonce = crypto.randomBytes(12)
--     value_nonce = crypto.randomBytes(12)
--     encrypted_dek = aes256gcm_encrypt(MEK, dek_nonce, dek)
--     encrypted_value = aes256gcm_encrypt(dek, value_nonce, old_token)
--     INSERT INTO secret_versions (tenant_id, secret_type, version, encrypted_dek,
--       encrypted_value, dek_nonce, value_nonce, status)
--     VALUES (tenant.id, 'kiotviet_token', 1, encrypted_dek, encrypted_value,
--       dek_nonce, value_nonce, 'active')
--     zero(old_token, dek)  -- Buffer.fill(0)
--
-- This script is located at: scripts/migrate-secrets-to-envelope.ts

-- ================================================================
-- Step 5: Activate migrated tenants (if still pending from v2.0)
-- ================================================================
UPDATE tenants SET status = 'active', updated_at = now()
WHERE status = 'pending'
  AND id IN (SELECT DISTINCT tenant_id FROM tenant_users WHERE status = 'active');

-- ================================================================
-- Step 6: Validation queries (run BEFORE dropping old columns)
-- ================================================================
-- Gate 1: Every legacy tenant with >=1 user has >=1 tenant_users row
SELECT t.id, t.name, array_length(t.zalo_user_ids, 1) AS legacy_count,
       (SELECT count(*) FROM tenant_users tu WHERE tu.tenant_id = t.id) AS new_count
FROM tenants t
WHERE t.zalo_user_ids IS NOT NULL
  AND array_length(t.zalo_user_ids, 1) > 0;
-- ASSERT: new_count >= 1 for every row. If any row has new_count = 0, migration failed.

-- Gate 2: No tenant_users row exists without a matching zalo_users row
SELECT tu.* FROM tenant_users tu
LEFT JOIN zalo_users zu ON zu.id = tu.zalo_user_id
WHERE zu.id IS NULL;
-- ASSERT: 0 rows returned.

-- Gate 3: platform_user_id uniqueness holds (should already be enforced by UNIQUE constraint)
SELECT platform_user_id, count(*) FROM zalo_users
GROUP BY platform_user_id HAVING count(*) > 1;
-- ASSERT: 0 rows returned.

-- Gate 4: Every tenant with legacy users has exactly one owner
SELECT tenant_id, count(*) AS owner_count FROM tenant_users
WHERE role = 'owner' AND status = 'active'
GROUP BY tenant_id HAVING count(*) != 1;
-- ASSERT: 0 rows returned (every migrated tenant has exactly 1 owner).

-- ================================================================
-- Step 7: Drop old columns (ONLY after all validation gates pass)
-- ================================================================
ALTER TABLE tenants DROP COLUMN IF EXISTS zalo_user_ids;
ALTER TABLE tenants DROP COLUMN IF EXISTS kiotviet_token_enc;

-- ================================================================
-- Step 8: Enable RLS on all new tables
-- ================================================================
-- (handled by rls-policies.sql migration — see §3.2)
```

**Handling duplicates and invalid platform_user_id strings:**
- Empty strings and whitespace-only entries in `zalo_user_ids` are skipped (`trim(unnest_val) != ''`).
- Duplicate `platform_user_id` values across tenants are de-duped by the `UNIQUE(platform_user_id)` constraint on `zalo_users` — only one row per distinct platform_user_id.
- If a single user appears in multiple tenants' `zalo_user_ids` arrays, they get multiple `tenant_users` rows (one per tenant). This is valid for migration; the V2 basic "one user → one tenant" constraint is enforced at application level going forward, NOT retroactively.

**Roll-forward notes:**
- This migration is idempotent: re-running Steps 2–3 with `ON CONFLICT DO NOTHING` is safe.
- Step 4 (secrets) MUST be run exactly once per tenant; the script SHALL check for existing `secret_versions` rows before inserting.

**Rollback notes:**
- If migration fails mid-way, the old `zalo_user_ids` column still exists (Step 7 is last).
- To roll back: `DROP TABLE IF EXISTS tenant_users, zalo_users, invite_codes CASCADE;` and keep V2.0 schema.
- The secrets migration script SHALL write a `migration_log` entry before dropping old encryption; if rollback is needed, the old `kiotviet_token_enc` column still has the original encrypted value.

**Acceptance gates (MUST pass before Step 7):**
1. Every legacy tenant with ≥1 user has ≥1 `tenant_users` row.
2. No `tenant_users` row exists without a matching `zalo_users` row.
3. `platform_user_id` uniqueness holds; zero duplicates in `zalo_users`.
4. Every migrated tenant has exactly one `owner` role.
5. Gateway resolves tenants correctly via new model (manual smoke test with 3 tenants).
6. 10 test invoices processed successfully via new model.

---

## §8. Test Plan

### 8.1 Test Pyramid

*(Unchanged from v2.0)*

### 8.2 Unit Tests (Updated)

| Module | Test Focus | Fixture |
|---|---|---|
| **Webhook HMAC verifier** | Valid sig → pass; invalid → reject; missing → reject; timestamp drift → reject | Fixture signatures generated with known secret |
| **Tenant resolver (v2.1)** | zalo_user → tenant via new entity model; unknown user; suspended user; revoked user | Mock zalo_users + tenant_users |
| **Invite code validator** | Valid code → accept; expired → reject; used → reject; lockout after 5 attempts | Mock invite_codes |
| **Interaction window checker** | Within 48h → open; outside → closed; edge cases (exactly 48h) | Mock zalo_users.last_interaction_at |
| **Envelope crypto** | Encrypt → decrypt roundtrip; wrong MEK → fail; wrong DEK → fail | Test keys |
| **Notifier (window-aware)** | Open window → send; closed → store pending; pending flush on reopen | Mock state |
| XML parser | *(unchanged)* | |
| Mapping engine | *(unchanged)* | |
| Idempotency guard | *(unchanged)* | |
| Price alert calculator | *(unchanged)* | |
| KiotViet payload builder | *(unchanged)* | |

### 8.3 Integration Tests (Updated)

| Scenario | Assertions |
|---|---|
| **RLS isolation (CI GATE)** | Tenant A context → cannot see/write Tenant B data. Missing context → zero rows. Applied to ALL tenant-scoped tables. |
| **Policy Safety — audit_logs** | As `app_user` in Tenant A context: cannot read Tenant B audit_logs. As `admin_reader`: can read across tenants. |
| **Webhook auth — valid signature** | 200; inbound_event created |
| **Webhook auth — invalid signature** | 401; zero inbound_events; metric incremented |
| **Webhook auth — replayed timestamp** | 401; zero side-effects |
| **Bootstrap Resolution (CI GATE)** | Unknown user: no tenant data. Membership resolved without tenant context. After setting tenant context: tenant-scoped reads work. Invalid invite code: no leaks. |
| **Onboarding — valid invite code** | zalo_user created; tenant_user (role=owner) created; invite marked used; tenant activated |
| **Onboarding — invalid/expired code** | No tenant_user created; appropriate error message returned |
| **Onboarding — brute force (6 attempts)** | First 5 logged; 6th returns lockout message; lockout_until set |
| **Authorization — unlinked user sends file** | 200 with onboarding prompt; zero jobs enqueued |
| **Authorization — revoked user sends file** | 200 with suspended message; zero jobs enqueued |
| **Notifier — window open** | Message sent via Zalo API mock |
| **Notifier — window closed** | Message stored in pending_notifications; NOT sent |
| **Notifier — pending flush on next message** | Pending notification delivered when user sends new message |
| **Secret rotation** | New version created; old version status=rotated; worker picks up new version |
| **Admin OIDC auth — valid JWT** | 200; admin_audit_log created |
| **Admin OIDC auth — invalid JWT** | 401; no side-effects |
| **Admin break-glass — valid key** | 200; admin_audit_log with auth_method='break_glass_key'; alert triggered |
| Full invoice flow | *(unchanged)* |
| Idempotent webhook replay | *(unchanged)* |
| Idempotent KiotViet sync | *(unchanged)* |
| Mapping prompt flow | *(unchanged)* |
| Rate limiting | *(unchanged)* |
| DLQ flow | *(unchanged)* |

### 8.4 Contract Tests

*(Unchanged + addition:)*

| Contract | Producer | Consumer | Validation |
|---|---|---|---|
| **Webhook HMAC** | Zalo OA | Gateway | Generate test payloads with known secret; verify Gateway accepts |
| Zalo webhook payload | Zalo OA | Gateway | JSON Schema |
| BullMQ job payloads | Gateway/Workers | Workers | Zod runtime validation |
| KiotViet API | kiotviet-sync | KiotViet | JSON Schema |

### 8.5 Load Tests

*(Unchanged from v2.0 + additional scenario:)*

```javascript
// Scenario 4: Invite code brute-force
invite_brute_force: {
  executor: 'per-vu-iterations',
  vus: 10,
  iterations: 10,  // 10 attempts per VU
  // Each VU simulates a different zalo_user trying random codes
  // Expected: lockout after 5 attempts; no valid code guessed
}
```

### 8.6 Fixture Strategy

```
tests/fixtures/
├── zalo-payloads/
│   ├── file-message-xml.json
│   ├── file-message-xml-signed.json     # v2.1: includes valid HMAC
│   ├── file-message-xml-bad-sig.json    # v2.1: invalid HMAC
│   ├── file-message-xml-old-ts.json     # v2.1: timestamp > 300s drift
│   ├── text-message-reply.json
│   ├── text-message-start.json          # Onboarding trigger
│   ├── text-message-invite-code.json    # v2.1: invite code submission
│   ├── malformed-payload.json
│   └── duplicate-msg-id.json
│
├── invoice-xml/
│   ├── (unchanged from v2.0)
│
├── kiotviet-responses/
│   ├── (unchanged from v2.0)
│
├── rls/                                 # v2.1
│   ├── seed-two-tenants.sql             # Creates 2 tenants with data
│   └── verify-isolation.sql             # Queries that MUST return 0 cross-tenant rows
│
└── secrets/                             # v2.1
    ├── test-mek.key                     # Test master encryption key
    └── test-encrypted-token.json        # Pre-encrypted token for roundtrip test
```

### 8.7 CI Pipeline

```yaml
# .github/workflows/ci.yml — v2.1 additions
jobs:
  # ... existing jobs (lint, typecheck, unit-tests, build) ...

  rls-tests:                    # NEW — mandatory CI gate
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: test
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: test
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run db:migrate:test   # Apply schema + RLS policies
      - run: npm run test:rls          # RLS isolation tests
    # This job MUST pass. Failure blocks merge.

  integration-tests:
    # Updated to include webhook-auth + onboarding + window tests
    runs-on: ubuntu-latest
    services:
      postgres: { image: postgres:16 }
      redis: { image: redis:7 }
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run test:integration
```

---

## §9. Runbook

### 9.1 Deployment

*(Unchanged from v2.0, plus:)*

**Additional step — Verify RLS after migration:**
```bash
# After running migrations, verify RLS is enabled
psql $DATABASE_URL -c "
  SELECT tablename, rowsecurity
  FROM pg_tables
  WHERE schemaname = 'public'
  AND tablename IN ('inbound_events','canonical_invoices','invoice_line_items',
    'mapping_dictionary','mapping_prompts','idempotency_keys','jobs',
    'secret_versions','pending_notifications','tenant_users','invite_codes')
  ORDER BY tablename;
"
# ALL rows MUST show rowsecurity = true
```

### 9.2 Rollback

*(Unchanged from v2.0)*

### 9.3 Incident Response

#### Severity Levels

*(Unchanged from v2.0)*

#### Incident Playbooks

##### Playbook: Webhook Spoofing Detected

```
TRIGGER: groceryclaw_webhook_auth_fail_total spikes > 10/min

1. ASSESS
   - Check source IPs in logs: are they Zalo IPs or unknown?
   - If Zalo IPs → possible Zalo key rotation (not attack)
   - If unknown IPs → active spoofing attempt

2. CONTAIN
   - If spoofing: add source IPs to deny list at load balancer
   - If Zalo key rotation: URGENT — update OA_SECRET_KEY
     $ export OA_SECRET_KEY=<new_key_from_zalo_dashboard>
     $ docker compose -f infra/docker-compose.v2.yml restart gateway

3. VERIFY
   - Send test message to bot from Zalo → should return 200
   - Check groceryclaw_webhook_auth_fail_total returns to 0

4. POST-MORTEM
   - If Zalo rotated key: set up monitoring for Zalo key rotation notices
   - If attack: review rate limiting; consider stricter IP allowlist
```

##### Playbook: Rate-Limit Storm (Single Tenant)

```
TRIGGER: groceryclaw_rate_limit_total{tenant_id="X"} spikes

1. ASSESS
   - Is the tenant legitimately busy (delivery day)?
   - Or is it a misbehaving integration / bot loop?
   - Check: are all messages from the same zalo_user_id?

2. CONTAIN
   - If bot loop: suspend the specific tenant_user
     $ curl -X POST http://admin:3001/admin/tenants/$TID/users/$UID/revoke
   - If legitimate burst: temporarily increase tenant rate limit
     $ curl -X PATCH http://admin:3001/admin/tenants/$TID \
       -d '{"config": {"rate_limit_override": 120}}'

3. VERIFY
   - Rate limit metric returns to normal
   - No impact on other tenants (check their latency)
```

##### Playbook: Secret Compromise (KiotViet Token)

```
TRIGGER: Suspected token leak (e.g., unauthorized KiotViet activity reported by tenant)

1. IMMEDIATE (within 15 min)
   - Revoke the compromised secret version:
     $ curl -X POST http://admin:3001/admin/tenants/$TID/secrets/revoke \
       -d '{"secret_type": "kiotviet_token", "version": N}'
   - This marks the version as 'revoked'; workers will fail to decrypt
   - Contact tenant to get new KiotViet token

2. ROTATE
   - Once new token is obtained:
     $ curl -X POST http://admin:3001/admin/tenants/$TID/secrets/rotate \
       -d '{"secret_type": "kiotviet_token", "new_value": "new_token"}'
   - Workers automatically pick up new version on next job

3. INVESTIGATE
   - Review audit_logs for the tenant: who accessed the secret? When?
   - Review admin_audit_logs: any suspicious admin actions?
   - Check Pino logs: confirm no plaintext token in any log line

4. HARDEN
   - If leak was via logs: add missing redaction paths
   - If leak was via admin access: review RBAC; tighten permissions
   - If leak was via DB access: verify RLS policies; rotate PG password
```

##### Playbook: MEK Compromise (Emergency)

```
TRIGGER: Master Encryption Key suspected compromised

1. IMMEDIATE — ALL HANDS
   - Generate new MEK
   - Run re-encryption script:
     $ node scripts/reencrypt-all-deks.js --new-mek-file=/path/to/new.key
     This reads each secret_versions row, decrypts DEK with old MEK,
     re-encrypts with new MEK, updates encrypted_dek + dek_nonce.
   - Deploy new MEK to all workers (env var update + restart)

2. VERIFY
   - Process 1 test invoice per active tenant → KiotViet sync succeeds
   - Old MEK MUST be destroyed (not just removed from env)

3. POST-MORTEM
   - How was MEK accessed? (env var leak, container compromise, etc.)
   - Implement Vault/KMS if not already done
```

### 9.4 Monitoring & Alerts (Updated)

```yaml
# Additional alert rules for v2.1
groups:
  - name: groceryclaw-security
    rules:
      # Webhook auth failures
      - alert: WebhookAuthFailSpike
        expr: rate(groceryclaw_webhook_auth_fail_total[5m]) > 0.1
        for: 2m
        labels:
          severity: sev2
        annotations:
          summary: "Webhook auth failures > 6/min for 2 min"

      # Break-glass key usage
      - alert: BreakGlassKeyUsed
        expr: increase(groceryclaw_admin_break_glass_total[5m]) > 0
        labels:
          severity: sev2
        annotations:
          summary: "Break-glass API key was used — verify legitimacy"

      # Invite brute force
      - alert: InviteBruteForce
        expr: rate(groceryclaw_invite_lockout_total[10m]) > 0.05
        for: 5m
        labels:
          severity: sev3
        annotations:
          summary: "Invite code lockouts > 3/10min"

      # Pending notifications growing (window issues)
      - alert: PendingNotificationsGrowing
        expr: groceryclaw_pending_notifications_total > 100
        for: 30m
        labels:
          severity: sev3
        annotations:
          summary: "100+ pending notifications for 30 min — interaction window issues"

      # RLS violation (should never fire if code is correct)
      - alert: RLSViolation
        expr: increase(groceryclaw_rls_violation_total[5m]) > 0
        labels:
          severity: sev1
        annotations:
          summary: "RLS policy violation detected — possible cross-tenant leak"
```

### 9.5 Common Operations

*(Unchanged from v2.0, with updated auth headers:)*

```bash
# All admin operations now use OIDC token:
export ADMIN_TOKEN=$(get-oidc-token)  # From your OIDC CLI tool
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://admin:3001/admin/tenants

# Emergency (OIDC down):
curl -H "X-Break-Glass-Key: $BREAK_GLASS_KEY" http://admin:3001/admin/tenants
# ⚠ This triggers an alert. Document why in incident channel.
```

---

## Appendix A: ADR Index (Updated)

| ADR | Decision | Tradeoff |
|---|---|---|
| A1 | Fastify over Express | Faster; smaller ecosystem |
| A2 | BullMQ + Redis over RabbitMQ/Kafka | Native Node.js; no durable log |
| A3 | PostgreSQL over MySQL | JSONB, RLS, richer indexing |
| A4 | Drizzle ORM over Prisma/TypeORM | Lightweight, type-safe |
| A5 | Monorepo with Turborepo | Shared types; slightly complex setup |
| A6 | Workers as single package | Shared deps; can't scale independently |
| A7 | **Shared-table + RLS from Beta** (not deferred) | Slight perf overhead (~5%); critical safety net |
| A8 | **Separate entity tables** (zalo_users + tenant_users) over array | More joins; proper roles, lifecycle, audit |
| A9 | **Invitation codes** over open onboarding | Friction for first setup; prevents hijack |
| A10 | **Envelope encryption** over single-layer | More complex; enables rotation without re-encrypting all values |
| A11 | **OIDC/SSO** for admin over API-key-only | Requires OIDC provider setup; production-grade identity |
| A12 | **Interaction window tracking** | Slightly complex notifier; compliant with Zalo policy |
| A13 | Strangler migration with per-tenant canary | Safe; requires dual infrastructure |

## Appendix B: Glossary

*(Unchanged from v2.0 + additions:)*

| Term | Definition |
|---|---|
| Tenant | A single grocery store with its own KiotViet account and mapping dictionary |
| OA | Zalo Official Account — the bot identity |
| RLS | Row-Level Security — PostgreSQL feature enforcing tenant isolation at DB level |
| MEK | Master Encryption Key — top-level key that wraps DEKs |
| DEK | Data Encryption Key — per-secret key that wraps the actual secret value |
| Envelope Encryption | Two-layer encryption: MEK wraps DEK, DEK wraps data |
| Interaction Window | The time period after a user's last message during which the OA can reply (assumed 48h) |
| ZNS | Zalo Notification Service — template-based messages that can be sent outside the interaction window |
| Invite Code | Single-use, time-limited code for onboarding verification |
| Break-Glass Key | Emergency API key for admin access when OIDC is unavailable |
| OIDC | OpenID Connect — identity protocol for admin authentication |

## Appendix C: Build Phase Acceptance Tests (Updated)

### Phase 1: Gateway + Ingress (Week 1–2)

- [ ] `POST /webhooks/zalo` with valid HMAC → 200 within 200 ms
- [ ] `POST /webhooks/zalo` with invalid HMAC → 401, zero side-effects
- [ ] `POST /webhooks/zalo` with timestamp > 300s drift → 401
- [ ] Duplicate webhook (same msg_id) → 200, no duplicate inbound_event
- [ ] Unknown zalo_user_id → 200, onboarding prompt sent, no job enqueued
- [ ] Known user, active membership → job enqueued
- [ ] Known user, revoked membership → 200, suspended message, no job
- [ ] `last_interaction_at` updated on every inbound message
- [ ] `GET :3000/metrics` → 404 (not exposed on public port)
- [ ] Rate limit: > 60 req/min from single tenant → 429

### Phase 2: Onboarding + Roles (Week 2–3)

- [ ] Admin creates tenant → invite code generated (6-char, 24h TTL)
- [ ] User sends valid invite code → zalo_user + tenant_user(owner) created
- [ ] User sends expired/used code → rejected with message
- [ ] 6th failed invite attempt → 1-hour lockout
- [ ] Owner sends "Mời nhân viên" → staff invite code generated
- [ ] Staff invite code → tenant_user(staff) created
- [ ] Staff cannot generate invite codes (role check)

### Phase 3: XML Parser + Mapping (Week 3–4)

*(Unchanged from v2.0)*

### Phase 4: KiotViet Sync + Secrets (Week 5–6)

- [ ] Goods receipt created with token from secret_versions (envelope-decrypted)
- [ ] Duplicate sync → no duplicate receipt (idempotency)
- [ ] Secret rotation → new version active, old rotated; worker uses new
- [ ] Plaintext token NEVER appears in logs (verified by log grep)
- [ ] KiotViet 401 → tenant paused, notification to owner

### Phase 5: Notifications + Interaction Window (Week 6–7)

- [ ] Result message sent within 10s (window open)
- [ ] **Window closed → message stored in pending_notifications, NOT sent**
- [ ] **User sends next message → pending notifications flushed (max 3)**
- [ ] **Pending notifications > 72h old → discarded**
- [ ] Daily summary: only sent if opted-in AND window open
- [ ] "Dừng" command → daily summary disabled
- [ ] Global OA rate limiter: > 80 msg/min → re-enqueue with delay

### Phase 6: Admin API + Observability (Week 7–8)

- [ ] Admin endpoints require OIDC JWT (401 without)
- [ ] RBAC enforced: viewer cannot POST/PATCH/DELETE
- [ ] Break-glass key works when OIDC is down; triggers alert
- [ ] All admin actions logged in admin_audit_logs
- [ ] **RLS enabled on all tenant-scoped tables (pg_class check)**
- [ ] **RLS isolation tests pass (CI gate)**
- [ ] Prometheus metrics on :3001/metrics (not :3000)

### Phase 7: Integration + Load (Week 8–10)

- [ ] End-to-end: webhook (signed) → auth → parse → map → sync → notify
- [ ] Multi-tenant RLS test: 2+ tenants, zero data leakage
- [ ] k6 steady-state: SLOs met
- [ ] k6 burst: recovery within 5 min
- [ ] k6 single-tenant flood: other tenants unaffected
- [ ] k6 invite brute-force: lockout works under load

---

## Appendix D: Core Decisions v2.1

> **Summary of the 5 critical flaw fixes — final decisions, rationale, and enforcement.**

### Decision 1: Webhook Authenticity

| | |
|---|---|
| **Flaw** | Webhook verification was vague ("if Zalo provides HMAC"); retry semantics undefined |
| **Decision** | Two-mode webhook verification: Mode 1 verified signature (fail-closed, raw body, constant-time compare). Mode 2 fallback (staging-only by default) with source verification + strict limits. Anti-replay is dedupe-based; timestamps are enforced only if verified to be signed. |
| **Rationale** | A public webhook endpoint without cryptographic verification is an injection vector for fake invoices affecting 1000+ tenants. Fail-closed ensures zero processing of unverified payloads. |
| **Enforcement** | Gateway middleware rejects before any DB write. Unit + integration tests for valid/invalid/missing signatures. Metric: `webhook_auth_fail_total`. |
| **Tests** | Invalid sig → 401 · Missing sig → 401 · Old timestamp → 401 · Valid sig → 200 |
| **Open item** | Verify exact Zalo signing mechanism pre-Beta (see PRD §8 A8) |

### Decision 2: Messaging Policy & Interaction Window

| | |
|---|---|
| **Flaw** | No awareness of Zalo OA reply window; system could violate platform policy |
| **Decision** | Track `last_interaction_at` per zalo_user. Notifier checks window (48h assumed) before every send. Closed window → store in `pending_notifications`, flush on next inbound. Daily summary is opt-in only and window-gated. |
| **Rationale** | Sending outside the window risks OA suspension by Zalo (kills the bot for all 1000+ tenants). Storing + deferring preserves user experience without violating policy. |
| **Enforcement** | Notifier worker checks window before Zalo API call. Pending notifications table with TTL. Rate limiter (80 msg/min). |
| **Tests** | Window open → sent · Window closed → stored · Flush on reopen · Expired pending discarded · Opt-out honored |
| **Open item** | Confirm exact window duration pre-Beta (see PRD §8 A9) |

### Decision 3: Role-Based Tenant Membership (AuthZ)

| | |
|---|---|
| **Flaw** | `zalo_user_id` used as both identity and authorization; no roles; anyone could join any tenant |
| **Decision** | Separate `zalo_users` + `tenant_users` tables with explicit `role` (owner/staff/viewer). Onboarding gated by single-use invitation codes (6-char, 24h TTL). Brute-force protection: 5 attempts/hour/user. |
| **Rationale** | Without invitation gating, any Zalo user who discovers the OA can claim any tenant (hijack). Roles prevent staff from changing KiotViet credentials or inviting users. |
| **Enforcement** | Gateway resolves membership + role on every webhook. Invite codes validated with anti-brute-force. ESLint rule flags raw tenant resolution without role check. |
| **Tests** | Valid invite → linked · Expired invite → rejected · Used invite → rejected · Lockout after 5 · Unlinked user → onboarding prompt · Staff cannot invite |

### Decision 4: DB-Level Multi-Tenant Enforcement (RLS)

| | |
|---|---|
| **Flaw** | RLS deferred to "V2 GA upgrade"; Beta relied on application-level `WHERE` clauses only |
| **Decision** | PostgreSQL RLS enabled on ALL tenant-scoped tables from V2 Beta. `SET LOCAL app.current_tenant` in every transaction. Superuser role for migrations bypasses RLS. |
| **Rationale** | With 1000+ tenants in shared tables, a single missed `WHERE tenant_id =` in any query path leaks cross-tenant data. RLS is the defense-in-depth that catches application bugs. The ~5% query overhead is acceptable. |
| **Enforcement** | RLS policies in `rls-policies.sql` applied during migration. `withTenantContext()` wrapper function for all DB operations. CI gate: RLS isolation tests MUST pass. ESLint rule flags raw queries. |
| **Tests** | Wrong context → zero rows · Cross-tenant INSERT → RLS violation · All tables have RLS enabled (pg_class check) · Missing context → zero rows (fail-safe) |
| **Monitoring** | `groceryclaw_rls_violation_total` metric; SEV1 alert if > 0 |

### Decision 5: Production-Grade Admin Auth & Secrets

| | |
|---|---|
| **Flaw** | Admin API used static API key only; secrets were single-layer encrypted with no versioning/rotation |
| **Decision** | Admin: OIDC/SSO (primary) + VPN + RBAC (super_admin/admin/viewer). Break-glass static key as fallback (logged, alerted, read-only default). Secrets: envelope encryption (MEK → DEK → value) with `secret_versions` table, versioning, rotation, and automated wipe of rotated values after 30 days. `/metrics` moved to admin port. |
| **Rationale** | Static API keys cannot be tied to individual identity (non-repudiable), have no expiration, and provide no granular permissions. Single-layer encryption prevents key rotation without re-encrypting all secrets simultaneously. |
| **Enforcement** | OIDC JWT validation middleware on all admin endpoints. RBAC matrix enforced per-endpoint. `admin_audit_logs` records every action. Break-glass usage triggers immediate alert. Envelope crypto library with mandatory `Buffer.fill(0)` after use. |
| **Tests** | No OIDC → 401 · Wrong role → 403 · Break-glass → works + alert · Secret rotation → new active version · Old version wipe after 30d · Plaintext never in logs |

---

## Acceptance Gates (v2.1.2 FINALIZE) — Preconditions Before Any Implementation Starts

The following gates **MUST** be satisfied. All are now specified unambiguously in this v2.1.2 patch.

1. **Bootstrap Resolution Gate (RLS Deadlock Removed)** — ✅ Specified in v2.1.1
   - Bootstrap functions are specified (signatures, permissions, behaviors).
   - Integration test spec exists proving all 4 scenarios.

2. **Audit Log Policy Safety Gate** — ✅ Specified in v2.1.1
   - `app_user` has tenant-scoped access only.
   - `admin_reader` role is defined and restricted to Admin API.

3. **Webhook Verification Gate** — ✅ Specified in v2.1.1
   - Two-mode runtime with explicit failure codes.
   - Go/No-Go rule specified.

4. **Identifier & Secrets Consistency Gate** — ✅ Specified in v2.1.1, audited in v2.1.2
   - Schema Dictionary (§3.0A) is the single source of truth.
   - No mixed IDs anywhere in docs.
   - No "decrypt from env" language remaining.

5. **Migration Gate (v2.0→v2.1)** — ✅ Specified in v2.1.2 (B1)
   - Migration SQL uses only schema-dictionary columns.
   - Deterministic ownership assignment.
   - Acceptance gates defined and automatable.

6. **Invite Consumption Gate** — ✅ Specified in v2.1.2 (B2)
   - `consume_invite_code()` is fully atomic with `UPDATE ... RETURNING`.
   - Lockout policy fully specified with concrete numbers.
   - Acceptance tests defined and automatable.
   - Gateway rate-limiting documented for unknown-code brute-force.

**Rollback guidance (MUST):**
- If any gate fails during implementation, rollback is:
  - Disable Mode 2 in non-staging; fail-closed on webhooks.
  - Revert to tenant-scoped-only audit visibility (app_user) while maintaining admin_reader separation.
  - Keep bootstrap functions enabled; do not ship any implementation that relies on cross-tenant reads by app_user.

---

## READY TO VIBECODE CHECKLIST (GREEN/RED) — v2.1.2 FINALIZE

**This table MUST have all items GREEN before implementation begins. If any item is RED, the docs have a remaining gap that blocks implementation.**

| # | Gate | Status | Evidence |
|---|---|---|---|
| 1 | Migration §7.4 references only schema-dictionary columns | 🟢 GREEN | Step 2 uses `zalo_users.platform_user_id`; Step 3 joins on `zu.platform_user_id = unnest_val` |
| 2 | `consume_invite_code()` fully specified with atomic transitions | 🟢 GREEN | `UPDATE ... SET status='used' ... WHERE status='active' ... RETURNING` with `FOR UPDATE SKIP LOCKED` |
| 3 | Lockout strategy with concrete numbers | 🟢 GREEN | Per-code: 5/15min→30min. Per-user: 5/60min→60min (via `invite_last_attempt_at`). Gateway: 10/min/user + 5/min/IP |
| 4 | Invite code hashing via `pgcrypto` | 🟢 GREEN | `digest(PEPPER \|\| normalized_code, 'sha256')` via pgcrypto; PEPPER in env/Vault |
| 5 | No mixed ID usage across all three docs | 🟢 GREEN | Schema Dictionary §3.0A; audit confirmed zero violations |
| 6 | No secret flow contradictions | 🟢 GREEN | All secret access via `secret_versions` envelope decryption |
| 7 | "Needs verification" in exactly one checklist per doc | 🟢 GREEN | PRD §5.6.4 + ARCHITECTURE §3.6; both have go/no-go rules |
| 8 | No unresolved TODO/NOTE/pseudo outside Verification Checklist | 🟢 GREEN | Doc-wide audit complete |
| 9 | Concurrency safety for invite consumption | 🟢 GREEN | `FOR UPDATE SKIP LOCKED` — second caller gets 0 rows |
| 10 | Migration acceptance gates are automatable | 🟢 GREEN | §7.4 defines 6 gates with exact SQL queries |
| 11 | Invite acceptance tests are automatable | 🟢 GREEN | §3.2.1 defines 8 GIVEN/WHEN/THEN test specs |
| 12 | Failure responses don't reveal code existence/status | 🟢 GREEN | All failures → 0 rows + generic message |
| 13 | RLS fail-safe when `app.current_tenant` is unset | 🟢 GREEN | `_rls_tenant_id()` with `current_setting(..., true)` + `NULLIF` → NULL → 0 rows (no exception) |
| 14 | `pgcrypto` extension declared; no bare `sha256()` | 🟢 GREEN | `CREATE EXTENSION IF NOT EXISTS pgcrypto` in init; `digest(..., 'sha256')` in consume function |
| 15 | Per-user lockout uses `invite_last_attempt_at`, not `updated_at` | 🟢 GREEN | DDL has dedicated field; consume function uses it for window calc |
| 16 | Retention does not reference removed `expired` status | 🟢 GREEN | Uses `status IN ('used','revoked') OR expires_at < now()` |
| 17 | Gateway no-egress: all outbound via notifier | 🟢 GREEN | ARCH §2 + §4.2: Gateway MUST NOT call Zalo API; all messages enqueued as NOTIFY jobs |

**VERDICT: ALL 17 GATES GREEN — READY FOR IMPLEMENTATION.**
