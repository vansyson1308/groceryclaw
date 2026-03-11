# PRD V2 (Basic) — GroceryClaw SaaS

> **Version:** 2.1.2-FINALIZE · **Last updated:** 2026-03-02  
> **Owner:** Engineering · **Status:** READY FOR IMPLEMENTATION  
> **Change:** v2.0→v2.1→v2.1.2 — all blockers resolved; implementation-ready


## v2.1.2 Patch Summary (Docs-Only — FINALIZE)

- **B1 — Migration fix:** Migration SQL in MASTER_DESIGN_PACK §7.4 corrected to use schema-dictionary columns. Legacy `zalo_user_ids` values are now correctly treated as `platform_user_id` strings.
- **B2 — Invite consumption finalized:** `consume_invite_code()` is now a complete atomic transaction spec. Includes: SHA-256 pepper-based hashing, exact normalization rules, per-code and per-user lockout with concrete numbers, Gateway rate-limiting for brute-force defense, and concurrency safety via `FOR UPDATE SKIP LOCKED`.
- **Onboarding flow updated:** All invite failure responses use a single generic message. Gateway MUST rate-limit invite attempts (10/min per user, 5/min per IP) to defend against brute-force of unknown codes.
- **Consistency audit passed:** Zero mixed IDs, zero "decrypt from env" remnants, zero unresolved TODO/NOTE outside Verification Checklists.
- **Post-review fixes (v2.1.2):** RLS policy made fail-safe (`_rls_tenant_id()` helper); `pgcrypto` extension required for `digest()`; per-user lockout uses dedicated `invite_last_attempt_at` field (not `updated_at`); retention fixed for removed `expired` status; Gateway no-egress rule clarified (all outbound via notifier).

## Decision Matrix v2.1.2

| # | Patch Item | Decision (MUST/SHALL) | Rationale |
|---|---|---|---|
| B1 | Migration v2.0→v2.1 | Legacy `zalo_user_ids` values **MUST** be treated as `platform_user_id` strings. Joins **MUST** use `zalo_users.platform_user_id`, not non-existent columns. | Previous migration SQL referenced columns that do not exist in the schema. |
| B2 | `consume_invite_code()` | **MUST** be a single atomic transaction. Lockout: 5 fails / 15 min → 30 min (per-code), 5 fails / 60 min → 60 min (per-user). Gateway rate-limit: 10/min/user + 5/min/IP. All failures return identical generic message. | Previous spec was pseudo-code that forced implementers to guess. |
| C1 | Schema Dictionary | All docs **MUST** reference only schema-dictionary-valid columns. | Root cause of B1 was column-name drift. |

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

## 1. Context & Problem Statement

Vietnamese grocery stores ("tiệm tạp hoá") receive supplier invoices via Zalo as XML files, photos, or PDFs. Manually entering these into KiotViet POS is slow, error-prone, and doesn't scale. V1 solved this with an n8n-based workflow for a handful of stores. V2 replaces the n8n runtime with a purpose-built system that serves **1000+ tenants through a single Zalo OA bot**.

### Why V2

| V1 Limitation | V2 Resolution |
|---|---|
| n8n single-tenant workflows; manual duplication per store | Multi-tenant architecture with tenant_id as first-class citizen |
| No queue; synchronous processing blocks webhook ACK | Async queue + worker pool; ACK < 200 ms |
| No idempotency; duplicate invoices on webhook replays | Three-tier idempotency keys (inbound, invoice, side-effect) |
| Secrets in environment variables visible in n8n UI | Envelope-encrypted secrets at rest; versioned with rotation |
| No structured observability | Structured logs, metrics, tracing — all tenant-scoped |
| No role model; anyone with zalo_user_id can act | Explicit `tenant_users` with roles, invitation-gated onboarding |
| No messaging policy compliance | Interaction-window-aware notifier with fallback strategies |

---

## 2. Goals

1. **One Zalo OA → 1000+ tenants.** Shared bot; tenant resolution via `platform_user_id` (Zalo) → `zalo_users` → `tenant_users` → `tenants` (bootstrap resolution before tenant context).
2. **Fully automated flow:** Zalo message → parse → normalize → mapping → KiotViet sync → Zalo reply.
3. **Five Perfection Criteria:**
   - **Isolation** — tenant data never leaks; enforced at DB level (RLS) from Beta.
   - **Reliability** — idempotent + retry + zero double side-effects.
   - **Scalability** — horizontal worker scaling; no single-tenant bottleneck.
   - **Security** — minimal public surface; fail-closed webhook auth; envelope-encrypted secrets; RBAC everywhere.
   - **Operability** — debug any tenant incident in < 15 min.

---

## 3. Non-Goals (V2 Basic)

| Excluded | Rationale |
|---|---|
| End-user web portal for store owners | Defer to V2+; Zalo is the sole UI. |
| Deep ML/AI for OCR/invoice parsing | V2 basic: XML only. Image/PDF OCR is V2+ scope. |
| Multi-OA support | Single OA simplifies tenant routing. |
| Billing / subscription management | Out of scope until paying customers reach > 50. |
| Multi-region deployment | Single-region (Vietnam) is sufficient at 1000 tenants. |
| Real-time dashboard for store owners | Daily summary via Zalo is the V2 approach. |
| Zalo ZNS template messages | Investigate in V2+ if proactive messaging is needed outside interaction window. |

---

## 4. Personas

### 4.1 Store Owner (Chủ tiệm) — Role: `owner`

- **Goal:** Set up the store, invite staff, manage KiotViet connection, receive daily summaries.
- **Permissions:** Full tenant admin — invite/revoke users, update config, change KiotViet credentials.

### 4.2 Store Staff (Nhân viên nhập hàng) — Role: `staff`

- **Goal:** Send supplier invoices, respond to mapping prompts, receive results.
- **Permissions:** Send invoices, answer mapping prompts. CANNOT change tenant config or invite users.

### 4.3 Read-Only Viewer — Role: `viewer` (Future)

- **Goal:** View invoice history and audit trail via future web portal.
- **Permissions:** Read-only. Cannot trigger processing.

### 4.4 System Admin / Ops (Your team)

- **Goal:** Onboard tenants, monitor system health, investigate failures, perform canary rollouts.
- **Interaction model:** Admin API (VPN + OIDC SSO) + CLI.

### 4.5 Accountant / Auditor (Future)

- **Goal:** Review import history, reconcile supplier invoices against KiotViet records.
- **Interaction model:** Read-only access to audit trail. Deferred to V2+ web portal.

---

## 5. Detailed Zalo UX Flows

### 5.1 Flow A — Tenant Onboarding (Invitation-Gated)

Onboarding MUST prevent tenant hijack. A random Zalo user MUST NOT be able to claim or join a tenant without verification.

**Chosen mechanism:** Admin creates tenant + generates a one-time **invitation code** (6-char alphanumeric, expires in 24h). Store owner receives the code out-of-band (phone call, SMS, in-person). Store owner sends the code to the bot to link their Zalo identity.

```
Admin                           System                          Zalo OA Bot              Store Owner
  |                               |                                |                        |
  |-- POST /admin/tenants ------> |                                |                        |
  |   (name, kiotviet_creds)      |                                |                        |
  |                               |-- create tenant (pending)      |                        |
  |                               |-- generate invite_code         |                        |
  |<-- { tenant_id,               |                                |                        |
  |      invite: "X7K9M2" } -----|                                |                        |
  |                               |                                |                        |
  |-- (give code to owner         |                                |                        |
  |    via phone/SMS/in-person)   |                                |                        |
  |                               |                                |                        |
  |                               |                                |   <-- "Bắt đầu" ------|
  |                               |                                |                        |
  |                               |               "Chào bạn! Nhập  |                        |
  |                               |                mã mời để kết   |                        |
  |                               |                nối cửa hàng:" -|----------------------->|
  |                               |                                |                        |
  |                               |                                |   <-- "X7K9M2" --------|
  |                               |                                |                        |
  |                               |<-- validate code (exists,      |                        |
  |                               |    not expired, not used) -----|                        |
  |                               |-- create zalo_user row         |                        |
  |                               |-- create tenant_user (owner)   |                        |
  |                               |-- mark invite used             |                        |
  |                               |-- activate tenant              |                        |
  |                               |                                |                        |
  |                               |               "✓ Đã kết nối   |                        |
  |                               |                cửa hàng        |                        |
  |                               |                'Tạp Đoàn       |                        |
  |                               |                Phương Vy'.     |                        |
  |                               |                Gửi hoá đơn    |                        |
  |                               |                bất cứ lúc     |                        |
  |                               |                nào!" ----------|----------------------->|
```

**Staff invitation (by owner):**

Owner sends `"Mời nhân viên"` → bot checks `role = owner` → generates staff invite code (role=staff pre-set). New staff enters code the same way; gets `role = staff`.

**Edge cases (v2.1.2 — all failure responses are generic):**
- Invalid/expired/used/revoked invite code → `"Mã mời không hợp lệ hoặc đã hết hạn."` (generic — MUST NOT reveal whether code exists, is expired, is used, or is revoked)
- Already linked user → `"Bạn đã kết nối cửa hàng rồi. Gửi hoá đơn để bắt đầu!"`
- User tries to join second tenant → `"Bạn đã thuộc cửa hàng khác. Liên hệ admin để chuyển."` (V2 basic: one user → one tenant)
- Brute-force invite codes → **Multi-layer defense (v2.1.2):**
  - **Per-code lockout (DB-side):** 5 failed attempts in 15 min → code locked for 30 min.
  - **Per-user lockout (DB-side):** 5 failed attempts in 60 min → user locked for 60 min.
  - **Gateway rate-limit:** 10 invite attempts per `platform_user_id` per min + 5 per source IP per min. Exceeding → HTTP 429 with `Retry-After` header.
  - All lockout/rate-limit responses use the same generic message as invalid codes.
- Rate-limited user receives: `"Vui lòng thử lại sau ít phút."` (generic — no indication of lockout type)

### 5.2 Flow B — Invoice Processing (Happy Path)

```
Store Staff                     Zalo OA Bot                        System
     |                               |                                |
     |-- [sends invoice.xml] ------> |                                |
     |                               |-- verify webhook signature --> |
     |                               |-- resolve zalo_user → tenant   |
     |                               |   + check role >= staff -----> |
     |                               |-- ACK < 200ms                  |
     |   <-- "📄 Đã nhận hoá đơn.   |                                |
     |        Đang xử lý..." --------|                                |
     |                               |         [async workers]        |
     |                               |   parse → normalize → map ---> |
     |                               |   sync KiotViet <------------- |
     |                               |                                |
     |   <-- "✓ Đã nhập thành công:  |                                |
     |        • 12 dòng sản phẩm    |                                |
     |        • Tổng: 4,250,000 VND  |                                |
     |        • ⚠ Giá 'Nước mắm     |                                |
     |          Chinsu' cao hơn 15%  |                                |
     |          so với lần trước"    |                                |
```

**Authorization:** Gateway MUST resolve `platform_user_id` to membership and verify the user has an active `tenant_users` row with `role IN ('owner', 'staff')` and `status = 'active'`. If not → `"Bạn chưa kết nối cửa hàng. Nhắn 'Bắt đầu' để đăng ký."` and do NOT enqueue any job.

### 5.3 Flow B' — Missing Mapping (Interactive)

*(Unchanged from v2.0 — see §5.3 mapping prompt flow with max 3 suggestions, max 3 questions per invoice, 30-min timeout)*

### 5.4 Flow C — Alerts & Daily Summary

**Daily summary — interaction-window aware (see §5.6):**

Daily summary MUST only be sent within the interaction window. If window is closed, the summary is stored and delivered on the user's next message.

### 5.5 Flow D — Failure UX

| Failure | User Message | System Action |
|---|---|---|
| Unparseable file | `"File không đọc được. Vui lòng gửi lại file XML hoặc chụp rõ hơn."` | Log error, increment `parse_fail` metric |
| KiotViet timeout | `"⏳ KiotViet đang phản hồi chậm. Sẽ tự động thử lại và báo kết quả."` | Retry with backoff; max 3 retries |
| KiotViet auth expired | `"⚠ Kết nối KiotViet đã hết hạn."` (owner only) | Notify admin; pause jobs for tenant |
| Internal error | `"Có lỗi xảy ra. Đội kỹ thuật đã được thông báo."` | Alert ops, send to DLQ |
| Duplicate invoice detected | `"Hoá đơn này có vẻ đã xử lý trước đó (mã: INV-xxx). Bỏ qua?"` | Idempotency check |
| Invalid/expired/used/locked invite code | `"Mã mời không hợp lệ hoặc đã hết hạn."` (generic — same for all failure types) | Log attempt; per-code lockout (5/15min→30min); per-user lockout (5/60min→60min); Gateway rate-limit (10/min/user, 5/min/IP) |
| Unlinked user sends file | `"Bạn chưa kết nối cửa hàng. Nhắn 'Bắt đầu' để đăng ký."` | Do NOT process file |
| Revoked/suspended user | `"Tài khoản của bạn đã bị tạm ngưng. Liên hệ quản lý cửa hàng."` | Do NOT process |
| **Interaction window closed** | *(Cannot send)* | Store in `pending_notifications`; flush on next inbound |
| Webhook signature invalid | *(No response — 401)* | Log + alert; increment `webhook_auth_fail` |

---

### 5.6 Messaging Policy & Interaction Window

#### 5.6.1 Zalo OA Messaging Constraints

> **Note:** Exact Zalo OA messaging policy items are tracked in the Verification Checklist (§5.6.4). The values below are safe-default assumptions that are **implementable as-is**. Production go/no-go depends on verification.

| Rule | Assumption | Safe Default |
|---|---|---|
| Reply window | OA can reply for 48h after user's last message | Track `last_interaction_at` per `zalo_user`; only send within 48h |
| Message types in window | Text, file, image, list (interactive buttons) | Use text + list for mapping prompts |
| Messages outside window | NOT allowed without ZNS template pre-approval | Do NOT send; store for deferred delivery |
| ZNS templates | Require Zalo review/approval; transactional only | Not used in V2 Basic |
| Rate limits (outbound) | ~100 msg/min per OA | Global outbound limiter: 80 msg/min |
| Broadcast messages | Require explicit user opt-in + OA certification | Daily summary MUST be opt-in |

#### 5.6.2 Interaction State Machine

Each `zalo_user` has an interaction window tracked via `last_interaction_at`:

```
                    ┌──────────────┐
                    │   UNKNOWN    │  (no zalo_user row)
                    └──────┬───────┘
                           │ user sends first message
                    ┌──────▼───────┐
                    │  WINDOW_OPEN │  last_interaction_at = now()
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         user sends    system sends   48h elapsed
         message       reply          (no user msg)
              │            │            │
              ▼            ▼            ▼
         reset timer   (allowed)   ┌───────────────┐
         to now()                  │ WINDOW_CLOSED  │
                                   └───────┬────────┘
                                           │ user sends message
                                    ┌──────▼───────┐
                                    │ WINDOW_OPEN   │
                                    └───────────────┘
```

**Rules enforced by Notifier worker:**

1. Before ANY outbound message, notifier MUST check: `zalo_users.last_interaction_at > now() - INTERVAL '48 hours'`.
2. Window OPEN → send normally.
3. Window CLOSED → INSERT into `pending_notifications`; deliver on next inbound (max 3, most recent first; discard if > 72h old).
4. Daily summary: only if `config.daily_summary_enabled = true` AND window OPEN.
5. All outbound MUST pass through global OA rate limiter (80 msg/min).

#### 5.6.3 Opt-In / Opt-Out

- Daily summary: OFF by default. Owner enables via `"Bật tổng kết ngày"`, disables via `"Tắt tổng kết ngày"`.
- User replies `"Dừng"` or `"Stop"` → disable daily summary + ACK.

#### 5.6.4 Verification Checklist (Pre-GA)

- [ ] Confirm exact reply window duration from Zalo OA API docs
- [ ] Confirm allowed message types within reply window
- [ ] Confirm rate limits per OA
- [ ] Confirm whether "list message" supports interactive buttons
- [ ] Investigate ZNS template process for V2+
- [ ] Test actual behavior when sending outside window (expect API error; capture error code)

---

## 6. Success Metrics

| Metric | Target (V2 Beta) | Target (V2 GA) | How Measured |
|---|---|---|---|
| Auto-processed invoices | > 60% | > 80% | `completed_auto / total` |
| End-to-end latency (XML + sync), p95 | < 30 s | < 20 s | Job timestamps |
| Mapping error rate | < 10% | < 5% | `mapping_miss / total_line_items` |
| Incident debug time per tenant | < 30 min | < 15 min | Ops SLA tracking |
| Webhook ACK p95 | < 200 ms | < 100 ms | Gateway metrics |
| Job start latency p95 | < 2 s | < 1 s | Queue metrics |
| System error rate | < 2% | < 1% | `failed_system / total` |
| Onboarding success rate | > 90% | > 95% | Funnel tracking |
| Webhook auth false-positive rejection | < 0.1% | < 0.01% | `webhook_auth_fail` analysis |
| Notification delivery (within window) | > 95% | > 99% | `sent / attempted` |
| Cross-tenant data leak incidents | 0 | 0 | RLS alerts + integration tests |
| Invite code brute-force blocked | 100% | 100% | Rate-limit logs |

---

## 7. Release Scope & Phases

### Phase 1 — V2 Beta (8–10 weeks)

**Scope:** Gateway with HMAC verification · `zalo_users` + `tenant_users` with roles · Invitation-gated onboarding · XML parse + mapping · KiotViet sync · Notifier with interaction-window awareness · PostgreSQL with RLS on all tenant tables · Redis-backed queue (bullmq-lite shim) · Admin API with OIDC/SSO + RBAC · Envelope-encrypted secrets with versioning · Structured logging + Prometheus · Strangler migration flag.

**Definition of Done:**
- [ ] 10 tenants on V2, 100 invoices with zero duplicates
- [ ] All SLOs met at p95 under synthetic load
- [ ] **RLS test: wrong tenant context → zero rows (CI gate)**
- [ ] **Invalid webhook signature → 401, zero side-effects**
- [ ] **Unlinked user → onboarding prompt, NOT processing**
- [ ] **Notifier respects interaction window**
- [ ] **Admin API rejects without valid OIDC token**

### Phase 2 — V2 GA (4–6 weeks after Beta)

Hardening, load test at 1000 tenants, Vault integration, secret rotation automation, ZNS investigation.

### Phase 3 — V2+ (Future)

Image/PDF OCR, web portal, billing, multi-region, ZNS templates, `viewer` role.

---

## 8. Assumptions

| # | Assumption | Impact if Wrong | Verification |
|---|---|---|---|
| A1 | Zalo webhook is at-least-once | Idempotency still correct | Test with sandbox |
| A2 | KiotViet rate limit ~60 req/min per token | Need more aggressive throttling | Load test |
| A3 | V1 n8n has compose + workflow exports | Manual V1 inspection needed | Check repo |
| A4 | Supplier XML consistent per supplier | Need per-supplier adapters | Collect 10+ samples |
| A5 | PG sufficient at 1000 tenants | Revisit partitioning | Monitor |
| A6 | Team comfortable with TypeScript | Adjust stack | Survey |
| A7 | Single VPS initially | Adjust infra layout | Decision |
| A8 | **Zalo provides a verifiable webhook signature scheme (header + algorithm + signed base)** | Production is blocked until Mode 1 can be enabled; Mode 2 allowed only in staging unless compensating controls approved | **Verify pre-Beta** |
| A9 | **Zalo reply window is 48 hours** | Tighten/loosen window | **Verify pre-Beta** |
| A10 | **Zalo supports list messages for prompts** | Fall back to numbered text | **Test in sandbox** |
| A11 | **Zalo outbound limit ~100 msg/min per OA** | Reduce rate limiter | **Load test sandbox** |
