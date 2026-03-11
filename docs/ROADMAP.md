# KIOTVIET-TAPHOA Roadmap (PRD v4.0.0)

## Scope and Source of Truth
This roadmap is derived from `KIOTVIET-TAPHOA_TECHNICAL_PRD_V4.md`, especially Section 5 (Phases 0→8), with architecture and flow references from Sections 1, 3, 4, and reliability/security constraints from Section 6.

## MVP Slice (Happy Path Proof)
**Objective:** Prove the asynchronous ingestion path before full automation:
1. Zalo webhook receives message.
2. System responds HTTP 200 immediately.
3. Signature verification runs asynchronously.
4. Scaffold next pipeline stages: XML parsing, mapping, and KiotViet PO creation integration points.

This corresponds to PRD flow sequence and async webhook constraint (Section 1.2 + Phase 2), with downstream goals from Flow 1 and Node 11 pipeline (Sections 3.3 and 4.1/4.2).

## Milestones by PRD Phase

### Milestone 0 — Foundation setup (Phase 0)
- **Goal:** Prepare execution environment (n8n + PostgreSQL + credentials).
- **Deliverables:** Running n8n instance, PostgreSQL reachable, environment variables configured, webhook endpoint publicly reachable for testing.
- **Acceptance Criteria:**
  - Webhook URL responds 200 to ping.
  - Required env vars are defined (non-empty placeholders acceptable in dev).
  - Database connectivity confirmed.
- **PRD refs:** Section 5, Phase 0.

### Milestone 0.5 — Zalo token lifecycle (Phase 0.5)
- **Goal:** Eliminate token-expiry outages.
- **Deliverables:** Dedicated refresh workflow every 20h, persistent token store, `getZaloAccessToken()` usage pattern.
- **Acceptance Criteria:**
  - Refresh workflow updates active token record.
  - Failed refresh generates alert and logs token error.
  - Other flows consume fresh token source.
- **PRD refs:** Section 5, Phase 0.5; Section 6 (`E011`, `E012`).

### Milestone 1 — KiotViet auth + product cache (Phase 1)
- **Goal:** Build reliable local cache for product lookup and pricing baseline.
- **Deliverables:** OAuth token fetch, paginated `/products` sync, scheduled refresh.
- **Acceptance Criteria:**
  - `kiotviet_product_cache` upsert works for barcode/name/price/cost/category fields.
  - Scheduled sync reruns without data duplication issues.
- **PRD refs:** Section 5, Phase 1; Section 3.1/3.2.

### Milestone 1.5 — Global FMCG seed (Phase 1.5)
- **Goal:** Solve cold-start via shared master data.
- **Deliverables:** Seed pipeline for `global_fmcg_master` with conversion defaults and searchable text vectors.
- **Acceptance Criteria:**
  - Seed count >500 for MVP.
  - Fuzzy/full-text queries return expected products.
  - Data quality checks for duplicate barcodes and missing names.
- **PRD refs:** Section 5, Phase 1.5; Section 2.1 (`global_fmcg_master`); Section 6 (`E014`, `E015`).

### Milestone 2 — Async webhook + signature verification (Phase 2)
- **Goal:** Implement secure ingress respecting Zalo timeout behavior.
- **Deliverables:** Webhook + immediate respond node + async signature verification + inbound logging + reply smoke test.
- **Acceptance Criteria:**
  - 200 response within ~1 second.
  - Invalid signature rejected from processing and logged.
  - Valid payload continues asynchronously.
- **PRD refs:** Section 1.2; Section 4.2 Node 2; Section 5, Phase 2; Section 6 (`E001`).

### Milestone 3 — XML invoice parser and PO happy path (Phase 3)
- **Goal:** Convert XML invoices into normalized items and create KiotViet PO for mapped products.
- **Deliverables:** XML parser, normalization, Tier-1 mapping lookup, PO creation.
- **Acceptance Criteria:**
  - Parsed XML produces `InvoiceItem[]` normalized output.
  - Mapped items create KiotViet completed PO.
  - Unit conversion (`conversion_rate`) preserves totals.
- **PRD refs:** Sections 1.2/1.3, 3.3, 4.2 Node 11a/11c, 5 Phase 3.

### Milestone 4 — Image OCR with LLM confidence gate (Phase 4)
- **Goal:** Support image invoices with controlled confidence threshold.
- **Deliverables:** Vision prompt integration, JSON parse, confidence scoring, fallback to draft/manual path.
- **Acceptance Criteria:**
  - Valid JSON extraction for common invoice formats.
  - Confidence >=70% continues automatically.
  - Low confidence follows defined safe fallback.
- **PRD refs:** Section 4.2 Node 6b; Section 5 Phase 4; Section 6 (`E004`, `E005`).

### Milestone 5 — Flow 2: new product mapping with 3-tier fallback (Phase 5)
- **Goal:** Resolve unknown products through progressive matching.
- **Deliverables:** Session handling and Tier 1/2/3 lookup interactions.
- **Acceptance Criteria:**
  - Tier 2 confirmation from global master can auto-create mapping and product.
  - Tier 3 barcode path creates product when Tier 1/2 fail.
  - Repeated invoice hits Tier 1 after learned mapping.
- **PRD refs:** Sections 1.1/1.2, 2.1, 4.1/4.2, 5 Phase 5.

### Milestone 6 — Flow 3: pricing alert/update (Phase 6)
- **Goal:** Detect cost changes and update retail pricing via user confirmation.
- **Deliverables:** Price delta detection + Zalo decision UI + `PUT /products/{id}` update path.
- **Acceptance Criteria:**
  - Cost-change alerts trigger with context.
  - Confirm action updates KiotViet selling price.
  - Decline/custom price branches are captured in session state.
- **PRD refs:** Section 3.5; Section 4.1; Section 5 Phase 6.

### Milestone 7 — Hardening and resilience (Phase 7)
- **Goal:** Improve safety under real-world failures.
- **Deliverables:** Retry policy, dedup, TTL cleanup, health checks, rate-limit handling, data-quality checks.
- **Acceptance Criteria:**
  - Duplicate msg_id skipped safely.
  - Expired token handling emits actionable alerts.
  - Simulated timeout/API failure paths recover gracefully.
- **PRD refs:** Section 5 Phase 7; Section 6 error table and edge cases.

### Milestone 8 — Monitoring and production rollout (Phase 8)
- **Goal:** Operate reliably in production.
- **Deliverables:** Structured logs, daily summaries, backup/versioning, SSL webhook deployment.
- **Acceptance Criteria:**
  - Operational metrics visible (incl. Tier 1/2/3 hit rates).
  - Production webhook configured and end-to-end test passes.
  - Backup and restore plan tested.
- **PRD refs:** Section 5 Phase 8.

## Suggested MVP Delivery Order (small, reversible)
1. Milestones 0 + 0.5 (platform readiness + token safety).
2. Milestone 2 (secure async ingress).
3. Milestone 3 (XML happy path → PO create).
4. Milestone 5 subset (Tier 1 + minimal Tier 2 confirmation only).
5. Milestone 6 minimal (alert-only first, update action second).

## Out-of-Scope for first MVP cut
- Full multi-image orchestration.
- Rich admin panel for mapping overrides.
- Large-scale global master curation automation beyond initial seed.
