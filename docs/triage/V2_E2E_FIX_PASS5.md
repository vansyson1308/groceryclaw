# V2 E2E Fix Pass 5

## 1) Evidence received
From user-provided CI/runtime output in this conversation:
1. E2E timeout diagnostics show:
   - `inbound_events` contains one row for `msg-invoice-001` with status `received`.
   - `canonical_invoices count=0` and `canonical_invoice_items count=0`.
   - Redis queue depth `bull-process-inbound-wait=0`.
2. Filtered worker logs show no `worker_bullmq_started`, no job processing, no dequeue/queue lag lines.
3. Gateway filtered logs show webhook accepted and acked (`gateway_webhook_accepted`, `stage":"linked_flow_enqueued`).
4. Full gateway startup log shows:
   - `queue_enabled_in_test":false`
   - `queue_transport":"none"`.
5. Full worker startup log shows:
   - `queue_enabled_in_test":false`
   - `queue_transport":"none"`.
6. Final step failure: `timeout waiting for canonical invoice + items + idempotency`.

## 2) Normalized stage map
1. Gateway queue mode: **disabled at runtime** (`queue_enabled_in_test=false`, `queue_transport=none`).
2. Worker queue mode: **disabled at runtime** (`queue_enabled_in_test=false`, `queue_transport=none`).
3. Intake: **succeeds** (gateway accepted webhook).
4. `inbound_events` insert: **succeeds** (row exists, status `received`).
5. Enqueue evidence: **missing** (queue transport none at gateway runtime).
6. Queue depth: **0** (no queued work).
7. Dequeue/process: **no evidence of worker dequeue/processing**.
8. Canonical invoice persistence: **none** (`count=0`).
9. Canonical item persistence: **none** (`count=0`).
10. Assertion/idempotency: **fails by timeout**.

## 3) Chosen outcome
- **Outcome C — Bucket 2: enqueue failed**.
- First failing stage is enqueue/runtime queue activation: intake and inbound insert succeed, but both gateway and worker run with queue disabled in test mode, so no work reaches queue/worker.

## 4) Fix applied or no-code decision
- Applied one surgical fix for Bucket 2 only:
  - propagate `ENABLE_QUEUE_IN_TEST` into gateway and worker container environments in compose.
- No schema changes, no downstream pipeline refactor.

## 5) Why this bucket fix is minimal
- Root cause is env propagation mismatch: E2E runner writes `ENABLE_QUEUE_IN_TEST=true`, but compose service env blocks did not pass that variable to gateway/worker.
- Fix is two-line env passthrough in one compose file.

## 6) Validation result
- No Docker E2E executed in this environment (by pass constraint).
- Static-only confidence:
  - compose now forwards `ENABLE_QUEUE_IN_TEST` to gateway + worker.
- Runtime proof required from next CI run.

## 7) Merge readiness / next branch
- Current state: **READY FOR REVIEW BUT NEEDS USER-PROVIDED CI CONFIRMATION**.
- Next branch (single check): rerun `v2-ci` and confirm startup logs now show `queue_enabled_in_test=true` and `queue_transport=redis`; then verify either pass or next first failing bucket from diagnostics.
