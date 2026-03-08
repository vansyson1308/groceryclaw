# V2 E2E Fix Pass 3

## 1) Preflight findings (PASS 2 audit)

### A. Env propagation status — PASS
- `run_e2e_compose.mjs` writes `ENABLE_QUEUE_IN_TEST=true` into the generated env file used by docker compose (`--env-file <temp>`) for gateway/worker containers.

### B. Queue mode visibility status — PASS
- Gateway startup log includes:
  - `queue_enabled_in_test`
  - `queue_transport`

### C. Worker queue mode visibility status — PASS
- Worker startup log includes:
  - `queue_enabled_in_test`
  - `queue_transport`

### D. Producer/consumer parity status — PASS
- Both producer (`Queue.add`) and consumer (`Worker` BRPOP loop) use the same Redis list key shape:
  - `bull-${queueName}-wait`
- E2E diagnostics query the same queue key for depth.

### E. Enqueue failure mode in expected-E2E mode — PASS
- Gateway enqueue path is fail-loud (`queue_not_configured`) when queue is expected by test override but missing.

### F. Timeout diagnostics sufficiency — PASS
- E2E timeout branch now emits stage data for:
  - inbound event rows for target message id,
  - canonical invoice and item counts,
  - Redis queue depth,
  - filtered worker logs for dequeue/processing/failure markers,
  - filtered gateway logs for webhook acceptance/enqueue-related markers.

## 2) Runtime classification
- Validation command executed once: `npm run e2e`.
- Runtime execution in this environment: **blocked** (Docker CLI missing: `spawnSync docker ENOENT`).
- Because compose services never started, no stage bucket (1–5) can be truthfully classified from runtime evidence here.
- Classification for this environment: **Runtime blocked before Bucket 1 intake stage**.

## 3) First failing bucket
- **Not classifiable in current environment** due to pre-intake infrastructure failure (`docker` binary unavailable).

## 4) Surgical fix applied in PASS 3
- **No production code fix applied in PASS 3**.
- Reason: preflight A–F checks pass in source, and runtime proof is blocked by environment tooling rather than application logic.

## 5) Revalidation result
- Per PASS 3 rules, exactly one runtime validation was attempted.
- Result: blocked at Docker invocation level; no additional reruns performed.

## 6) Exact next investigation branch (if still failing in CI)
Run `npm run e2e` in CI/docker-capable environment and classify with the new diagnostics:
1. Confirm startup logs show `queue_enabled_in_test=true` and `queue_transport=redis` for gateway and worker.
2. If timeout occurs, use emitted stage diagnostics to identify first bucket:
   - no inbound rows => Bucket 1 intake,
   - inbound rows but no queue evidence => Bucket 2 enqueue,
   - queue depth/pending + no worker processing lines => Bucket 3 dequeue/processing,
   - worker processing lines but canonical counts missing => Bucket 4 persistence,
   - canonical data exists but assertion still fails => Bucket 5 assertion/query drift.
3. Apply one surgical fix to the first proven bucket only.
