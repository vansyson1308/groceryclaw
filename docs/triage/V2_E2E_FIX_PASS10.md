# V2 E2E Fix Pass 10

## 1) CI evidence used
Using only provided CI evidence in conversation:
- Queue path is active and PROCESS_INBOUND_EVENT is consumed.
- Worker logs show PROCESS_INBOUND_EVENT duration but no worker_job_failed for that attempt.
- E2E diagnostics show no canonical rows and inbound row still `received`.
- This indicates false-success behavior (job treated as success without required side effects).

## 2) Required side-effects contract
For PROCESS_INBOUND_EVENT to be successful, code intent requires:
1. inbound event is resolved,
2. canonical invoice/item writes are performed (or explicitly handled),
3. inbound_events status is transitioned away from `received` (completed/failed),
4. only then lifecycle should be marked completed.

## 3) False-success explanation
Primary cause category: **C (error caught/suppressed and not rethrown)**.
- In `processInboundEventPipeline`, the catch block performed compensating writes (`inbound_events failed`, notify enqueue, markJob failed) but then returned without rethrow.
- Worker wrapper therefore recorded successful completion (`job_duration_ms`) and did not emit `worker_job_failed`, even though required side effects were absent.

## 4) Invalid-envelope interpretation
- **Relevant symptom, not direct cause.**
- `worker_job_invalid_envelope` lines likely come from malformed follow-up jobs (e.g., MAP_RESOLVE envelope shape mismatch), but the first proven contradiction in this pass is false-success suppression in PROCESS_INBOUND_EVENT catch path.

## 5) Fix applied
- Made catch path explicit-failure instead of swallow:
  - after `markJob(..., 'failed', ...)`, rethrow the original error (or `xml_parse_failed` fallback).
- This prevents silent success and forces worker failure accounting/logs when core side effects do not complete.

## 6) Static validation
- `npm run typecheck` -> pass.
- `node --test tests/v2/worker-process-inbound.test.mjs` -> pass.

## 7) Exact expectation for next CI run
- PROCESS_INBOUND_EVENT can no longer finish as silent success when an error path is taken.
- If canonical writes still do not happen, CI should now surface explicit `worker_job_failed` for the underlying cause, enabling deterministic next-bucket fixing.
