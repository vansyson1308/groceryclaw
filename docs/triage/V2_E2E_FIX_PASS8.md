# V2 E2E Fix Pass 8

## 1) CI evidence used
Using only the provided CI/runtime evidence in conversation:
- Queue path is active (gateway/worker show `queue_enabled_in_test=true`, `queue_transport=redis`).
- Gateway enqueues linked flow (`stage=linked_flow_enqueued`) with `PROCESS_INBOUND_EVENT` payload.
- Worker dequeues and runs `PROCESS_INBOUND_EVENT` but fails with `inbound_event_not_found`.
- E2E diagnostics still show inbound row exists for `msg-invoice-001` while canonical tables remain empty.

## 2) Enqueue-to-lookup path
1. Gateway `enqueueLinkedFlow(...)` enqueues job payload containing:
   - `job_type: 'PROCESS_INBOUND_EVENT'`
   - `tenant_id`
   - `inbound_event_id` (returned by `insertInboundEvent(...)`)
2. Worker dispatches `PROCESS_INBOUND_EVENT` jobs into `processInboundEventPipeline(...)`.
3. Pipeline loads inbound event row by `id = $1::uuid` from `inbound_events`.

## 3) Contradiction explanation
- Primary cause: **wrong context** (tenant session context absent during inbound-event lookup).
- The lookup used `deps.queryOne(...)` directly (pool query), which does not set `app.current_tenant`.
- With RLS policies keyed on `_rls_tenant_id()` from `app.current_tenant`, the row is invisible to that query context, so worker sees `inbound_event_not_found` even though row exists (confirmed by E2E diagnostics query from postgres superuser context).

## 4) Fix applied
- Narrow context fix only for inbound lookup:
  - changed inbound event SELECT to run inside `withTenantTransaction(deps, job.tenant_id, 'PROCESS_INBOUND_EVENT', ...)`.
- This ensures tenant session context is set before resolving inbound row.
- No queue logic changes; no schema/policy changes.

## 5) Static validation
- `npm run typecheck` -> pass.
- `node --test tests/v2/worker-process-inbound.test.mjs` -> pass.

## 6) Exact expectation for next CI run
- Worker should resolve `inbound_events` by `inbound_event_id` successfully under tenant-scoped context.
- `inbound_event_not_found` failure should disappear for this path, allowing processing to continue to canonical persistence (or expose next distinct downstream blocker if present).
