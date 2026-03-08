# V2 E2E Triage Report (First-Pass Diagnostic)

## Scope and discipline
- Pass type: **diagnostic only** (no code fixes).
- Gate investigated: **GitHub Actions job `v2-ci` -> step `Mandatory V2 E2E integration gate`**.
- Constraints followed:
  - Workflow-first static analysis.
  - One E2E execution attempt only (`npm run e2e`) after code-path mapping.
  - Structured evidence capture.

---

## A) Failure summary (plain English)
The CI failure symptom (`timeout waiting for canonical invoice + items + idempotency`) is most likely caused by a **queueing dead path in E2E mode**:

1. The E2E runner explicitly writes `NODE_ENV=test` into its ephemeral compose env.
2. In gateway startup, `NODE_ENV=test` makes `queue = null`.
3. The enqueue function then **returns early without pushing jobs** when queue is null and no `queueCmd` is configured.
4. As a result, linked webhook events can be accepted and inserted into `inbound_events`, but no `PROCESS_INBOUND_EVENT` worker job is ever queued.
5. Worker-side canonical invoice writes never happen, so the polling condition (`canonical_invoices==1 && canonical_invoice_items>=1 && inbound_events==1`) times out.

This aligns tightly with the observed CI symptom wording.

---

## B) System flow map of V2 E2E path

### CI flow
`v2-ci workflow` -> install/build/test gates -> migrate DB -> integration gates -> **`npm run e2e`** -> E2E compose runner starts stack and validates end-to-end invoice path.

### E2E runtime flow (intended)
1. `scripts/v2/run_e2e_compose.mjs` creates ephemeral `.env` + compose project.
2. Starts `postgres`, `redis`, `gateway`, `admin`, `worker`, XML/KiotViet/Zalo stubs.
3. Runs V2 migrations against compose Postgres.
4. Seeds tenant + invite.
5. Posts invite webhook -> waits for membership creation.
6. Seeds linked user + tenant membership.
7. Posts invoice webhook twice (idempotency check).
8. Polls DB for:
   - exactly one canonical invoice,
   - one-or-more canonical invoice items,
   - exactly one inbound event row for that message id.

### Request-to-persistence chain
`POST /webhooks/zalo` (gateway) -> auth/validation -> membership resolution -> `insert inbound_events` (dedupe on `(tenant_id, zalo_msg_id)`) -> enqueue `PROCESS_INBOUND_EVENT` -> worker dequeues -> fetch XML -> parse -> insert `canonical_invoices` (dedupe on `(tenant_id, invoice_fingerprint)`) -> insert `canonical_invoice_items` -> update `inbound_events.status=completed` -> polling assertion succeeds.

---

## C) Ranked hypotheses for root cause

### Hypothesis 1 — **High probability**
**`NODE_ENV=test` in E2E disables gateway queue producer, dropping jobs silently.**
- Supporting evidence:
  - E2E env generator sets `NODE_ENV=test`.
  - Gateway sets `queue = null` when `NODE_ENV==='test'`.
  - Gateway `enqueue()` returns without error when queue is null and no `queueCmd`.
  - Poll target requires worker processing that depends on queue delivery.
- Disconfirming evidence:
  - None found in current codepath (no alternate enqueue path configured in E2E script).
- Cheapest verification:
  - Add one diagnostic query after invoice webhook in E2E: Redis queue length for `bull-process-inbound-wait` plus gateway log check for `linked_flow_enqueued` without downstream worker job.

### Hypothesis 2 — **Medium probability**
**Worker readiness is not equivalent to processing readiness in E2E; worker health is intentionally bypassed.**
- Supporting evidence:
  - E2E waits only for worker *running* (not healthy), explicitly commenting health may fail.
  - If worker starts but cannot consume, test still proceeds.
- Disconfirming evidence:
  - Even with worker issues, canonical timeout alone doesn’t prove this unless queue has pending jobs.
- Cheapest verification:
  - During timeout window, inspect Redis list length and worker logs for dequeue/processing events.

### Hypothesis 3 — **Medium/Low probability**
**RLS/runtime role scoping causes worker write/query mismatch under app role.**
- Supporting evidence:
  - Heavy RLS policies + tenant scoped tx semantics are in play.
  - E2E script manually disables RLS on some tables only.
- Disconfirming evidence:
  - If job is never enqueued, RLS is not first blocker.
- Cheapest verification:
  - Confirm job reaches worker first; if yes, inspect worker log for DB errors and query `jobs/audit` status rows.

### Hypothesis 4 — **Low probability**
**Test assertion contract drift (polling wrong table/criteria).**
- Supporting evidence:
  - Architecture has MAP_RESOLVE/KIOTVIET/notify side paths that evolved.
- Disconfirming evidence:
  - Poll checks core canonical tables still directly written by `PROCESS_INBOUND_EVENT` pipeline.
- Cheapest verification:
  - One SQL trace per stage (`inbound_events`, `canonical_invoices`, `canonical_invoice_items`) with timestamps.

---

## D) Concrete fix plan (ordered by probability, blast radius, leverage)

1. **Fix E2E env mode (small blast radius, highest probability):**
   - In E2E runner ephemeral env, change `NODE_ENV=test` to `NODE_ENV=development` (or introduce an explicit `ENABLE_QUEUE_IN_TEST=true` gate used by gateway/worker queue init).
   - Expected effect: queue producer/consumer paths become active during compose E2E.

2. **Add queue-path diagnostics to E2E script (small blast radius, high leverage):**
   - On timeout or after webhook post, print:
     - Redis queue length,
     - `inbound_events` status rows,
     - worker recent logs filtered for job processing.
   - This turns future failures from “timeout” into stage-specific breakages.

3. **Strengthen readiness semantics (small/medium blast radius):**
   - Replace/augment worker `running` wait with processing readiness signal (e.g., worker `waitUntilReady` log marker or a canary queue roundtrip).

4. **Add explicit E2E contract assertions before long poll (medium leverage):**
   - Assert that second invoice webhook is deduped at `inbound_events` layer quickly.
   - Assert at least one queue push happened before waiting for canonical rows.

5. **Only if still failing:** investigate RLS/runtime role mismatch in worker transaction path with tenant context.

---

## E) Timeout points, async waits, and race surfaces

### Timeout/poll points identified
- `waitForServiceHealthy(...)` for postgres/redis/gateway/admin: 120s each.
- `waitForServiceRunning(worker)`: 120s.
- `waitFor gateway readyz`: 120s.
- `waitFor admin healthz`: 120s.
- `waitFor invite membership created`: 60s.
- **`waitFor canonical invoice + items + idempotency`: 120s (failing symptom).**

### Race/fragility surfaces
- Worker health bypassed in E2E even though downstream processing depends on it.
- Queue producer disabled in test mode without hard failure signal.
- Polling checks DB state only; does not assert intermediate queue/worker stage.
- Replay cache and DB dedupe interplay can hide repeated webhook effects while still passing HTTP 200.

---

## CI vs local mismatch map (focused)

| Area | Expected by test/CI | Actual in code/runtime | Impact | Recommended fix |
|---|---|---|---|---|
| Runtime mode in E2E compose | Queue-backed async processing active | E2E script sets `NODE_ENV=test`; gateway queue object disabled | Jobs silently not enqueued -> canonical poll timeout | Run E2E compose in non-test mode or explicitly force queue enable in test mode |
| Queue failure visibility | Immediate fail if queue path unavailable | `enqueue()` early-returns when queue missing in test mode | False-positive ACKs with no downstream work | Make enqueue missing-path fail hard in E2E mode |
| Worker readiness gate | Ready means can consume jobs | E2E only waits for worker process running | Race/false ready; delayed failures | Add queue canary or worker-ready signal check |
| Failure diagnostics | Stage-specific fail output | Final timeout without queue-depth snapshot by default | Slow triage in CI | Emit Redis len + worker logs + inbound statuses on timeout |

---

## Evidence index (file -> behavior -> why it matters)

1. `.github/workflows/v2-ci.yml`
   - Contains failing step name `Mandatory V2 E2E integration gate` running `npm run e2e`.
   - Matters: defines exact CI gate and failure context.

2. `package.json`
   - Maps `e2e` script to `node scripts/v2/run_e2e_compose.mjs`.
   - Matters: identifies e2e entrypoint.

3. `scripts/v2/run_e2e_compose.mjs`
   - Generates ephemeral env with `NODE_ENV=test`; starts compose; posts webhooks; polls for canonical rows + idempotency.
   - Matters: direct source of failing timeout condition and runtime mode.

4. `apps/gateway/src/server.ts`
   - Queue init disabled when `NODE_ENV==='test'`; enqueue function may no-op in that scenario.
   - Matters: likely event path break between webhook intake and worker execution.

5. `apps/worker/src/index.ts`
   - Worker consumer startup and readiness checks; queue producer object also disabled in `NODE_ENV==='test'`.
   - Matters: worker behavior and readiness semantics in E2E path.

6. `apps/worker/src/process-inbound.ts`
   - Defines canonical invoice/item writes and inbound status update.
   - Matters: this is the exact persistence path required by failing poll assertion.

7. `infra/compose/v2/docker-compose.yml` + `infra/compose/v2/docker-compose.e2e.yml`
   - Service env wiring, health checks, and e2e overrides.
   - Matters: confirms queue/DB/Redis dependencies and startup assumptions.

8. `packages/common/src/bullmq-lite.ts`
   - Redis queue keying and blocking pop loop implementation.
   - Matters: validates expected queue transport behavior/key names for producer/consumer parity.

---

## Dynamic run notes (single E2E run)
- Command run once: `npm run e2e`.
- Outcome in this environment: failed immediately (`spawnSync docker ENOENT`) because Docker CLI is unavailable.
- Interpretation: local dynamic validation of compose runtime is limited here; static evidence remains primary.

---

## Safe next coding action (what to do / what not to do)

### Do next
1. Implement smallest change to ensure E2E compose uses active queue path (prefer env-only change first).
2. Add minimal diagnostics around queue depth + worker processing markers in `run_e2e_compose.mjs` timeout branch.
3. Re-run only targeted E2E gate once in CI or docker-capable local environment.

### Do **not** do next
- Do not broad-refactor worker/gateway architecture.
- Do not repeatedly spam full `npm run e2e` loops without added stage diagnostics.
- Do not change DB schema/contracts before confirming queue-stage behavior.

---

## Machine-readable companion artifact
- `docs/triage/V2_E2E_TRIAGE_ARTIFACT.json`
