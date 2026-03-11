# V2 E2E Fix Pass 6

## 1) CI evidence used
Using only user-provided CI/runtime logs in this conversation:
- Queue path is active in latest run (`queue_enabled_in_test=true`, `queue_transport=redis` in gateway and worker startup logs).
- Gateway accepted linked invoice webhook (`gateway_webhook_accepted`, `stage=linked_flow_enqueued`).
- Worker consumed jobs and attempted `PROCESS_INBOUND_EVENT`, then failed with:
  - `could not determine data type of parameter $3`.
- Postgres error shows exact failing statement in jobs persistence:
  - `INSERT INTO jobs ... jsonb_build_object('correlation_id', $3) ...`.
- Downstream state remained empty (`canonical_invoices=0`, `canonical_invoice_items=0`) and gate timed out.

## 2) Exact query origin
- File: `apps/worker/src/process-inbound.ts`
- Function: `markJob(...)`
- Caller path:
  - `processInboundEventPipeline(...)` -> `markJob(..., 'processing')` / `markJob(..., 'completed'/'failed')`
  - called from worker `PROCESS_INBOUND_EVENT` handler.
- Parameter bindings in failing insert:
  - `$1` = `tenantId`
  - `$2` = lifecycle status (`processing|completed|failed`)
  - `$3` = `correlationId`
  - `$4` = `errorMessage|null`

## 3) Why `$3` was ambiguous
- In `jsonb_build_object('correlation_id', $3)`, Postgres could not infer a concrete type for placeholder `$3` in this query context, resulting in runtime error `could not determine data type of parameter $3`.

## 4) Fix applied
- Narrow SQL typing fix in `markJob(...)` only:
  - changed `jsonb_build_object('correlation_id', $3)`
  - to `jsonb_build_object('correlation_id', $3::text)`
- This makes parameter typing explicit while preserving payload shape and existing job lifecycle behavior.

## 5) Static validation
- Ran targeted static validation:
  - `npm run typecheck`
- Result: pass.

## 6) Exact expectation for next CI run
- `PROCESS_INBOUND_EVENT` should no longer fail at jobs insert with parameter `$3` ambiguity.
- E2E should proceed to canonical persistence, potentially passing or exposing the next true failing bucket (if any) after this Bucket 4 SQL typing failure is removed.
