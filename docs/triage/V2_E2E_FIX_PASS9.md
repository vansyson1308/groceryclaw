# V2 E2E Fix Pass 9

## 1) CI evidence used
Using only the provided CI evidence in conversation:
- Queue path is active and processing job is consumed (`PROCESS_INBOUND_EVENT` has `job_duration_ms` and no hard worker failure).
- Inbound row exists for `msg-invoice-001` and remains `status=received`.
- `canonical_invoices=0` and `canonical_invoice_items=0`.
- E2E times out waiting for canonical data.

## 2) PROCESS_INBOUND_EVENT control-flow map
1. Worker dispatches `PROCESS_INBOUND_EVENT` in `apps/worker/src/index.ts`.
2. `processInboundEventPipeline(...)` validates `tenant_id` and `inbound_event_id`.
3. `markJob(..., 'processing')` writes lifecycle row.
4. Inbound row is loaded by `id` in tenant-scoped context.
5. XML URL is extracted; XML fetched and parsed.
6. Canonical invoice insert attempted with `ON CONFLICT DO NOTHING RETURNING id::text`.
7. If invoice id exists: item inserts run; inbound status updated to `completed`.
8. If invoice id was empty before this fix, function returned silently from transaction block (no item inserts, no inbound status update, no thrown error).

## 3) Silent/no-op branch explanation
- Primary no-op branch was the empty `invoiceId` early-return after `ON CONFLICT DO NOTHING RETURNING id`.
- That branch can finish the worker job without canonical writes and without changing inbound status, matching observed evidence (`received`, counts 0, no hard error).

## 4) Fix applied
- Replaced silent early return with explicit resolution/error behavior:
  1. If `RETURNING id` is empty, lookup existing invoice by `(tenant_id, invoice_fingerprint)`.
  2. If existing row found, continue with item insert + inbound status update.
  3. If still missing, throw `canonical_invoice_insert_skipped` so path is explicit (not silent).

## 5) Static validation
- `npm run typecheck` -> pass.
- `node --test tests/v2/worker-process-inbound.test.mjs` -> pass.

## 6) Exact expectation for next CI run
- `PROCESS_INBOUND_EVENT` should no longer complete as a silent no-op when invoice insert returns empty id.
- Either canonical path proceeds (and inbound status advances), or an explicit error is raised (`canonical_invoice_insert_skipped`) that makes the blocker visible instead of hidden timeout behavior.
