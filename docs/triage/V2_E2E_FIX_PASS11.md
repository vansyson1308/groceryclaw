# V2 E2E FIX PASS11

## 1. CI evidence used
- Worker consumes queue jobs and reaches `PROCESS_INBOUND_EVENT`.
- Worker logs show explicit failure: `worker_job_failed` with `reason:"unsafe_url"`.
- E2E diagnostics still show inbound event row present with `status="received"`, and canonical tables remain empty (`canonical_invoices=0`, `canonical_invoice_items=0`).
- Gateway and worker startup confirm queue test mode is enabled (`queue_enabled_in_test=true`, `queue_transport=redis`).

## 2. unsafe_url origin
- Validation is thrown in `packages/common/src/ssrf-fetcher.ts` by `fetchUrlSafely(...)` when `validateSafeAttachmentUrl(...)` returns `{ ok: false }`.
- Caller path is `apps/worker/src/process-inbound.ts` in `processInboundEventPipeline(...)` where XML is fetched via `fetchUrlSafely(xmlUrl, ...)`.
- E2E invoice payload uses `http://xml-stub:18082/invoice.xml` (compose service DNS + http + non-443 port) from `scripts/v2/run_e2e_compose.mjs`.

## 3. rejection rule explanation
- Existing policy only allowed `https:` and (if specified) port `443`.
- Therefore the compose stub URL (`http://xml-stub:18082/...`) was rejected even though host allowlisting already constrained the domain.
- This policy mismatch explains `unsafe_url` as the first blocker in PASS 11.

## 4. fix applied
- Added an explicit, opt-in `allowHttpDomains` parameter to safe fetch config and URL validator.
- `http:` URLs are now allowed only when hostname matches this dedicated allowlist.
- Kept existing host safety checks (no localhost / .local / private IPv4) and required host to remain within `allowedDomains`.
- Wired worker to read `WORKER_XML_ALLOW_HTTP_DOMAINS` (default empty), so production remains strict unless explicitly configured.
- Updated E2E compose env generation and E2E compose file to set `WORKER_XML_ALLOW_HTTP_DOMAINS=xml-stub`.

## 5. static validation
- `npm run typecheck` passed after changes.

## 6. exact expectation for next CI run
- `PROCESS_INBOUND_EVENT` should no longer fail at URL validation for `http://xml-stub:18082/invoice.xml` in compose E2E.
- Worker should proceed to XML parse + canonical writes + inbound status transition.
- If any downstream issue remains, CI should now expose the next concrete failure instead of `unsafe_url`.
