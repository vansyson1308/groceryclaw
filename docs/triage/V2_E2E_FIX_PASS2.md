# V2 E2E Fix Pass 2

## Root cause addressed
- Addressed hypothesis #1 from first-pass triage: compose E2E generated `NODE_ENV=test`, which disabled queue initialization in gateway/worker, allowing webhook ACK without guaranteed enqueue in E2E queue path.

## Patch summary
1. **E2E env now explicitly enables queue in test mode**
   - `scripts/v2/run_e2e_compose.mjs` now writes `ENABLE_QUEUE_IN_TEST=true` into the generated E2E env.
2. **Gateway queue init is conditionally allowed in test mode via explicit flag**
   - `apps/gateway/src/server.ts` now uses `ENABLE_QUEUE_IN_TEST` to allow Redis queue init under `NODE_ENV=test` only when explicitly set.
3. **Gateway no-op enqueue is now fail-loud in queue-expected test mode**
   - If queue is expected (flag on) but unavailable and no queueCmd fallback exists, gateway throws `queue_not_configured` instead of silently returning.
4. **Worker queue init uses same explicit test override**
   - `apps/worker/src/index.ts` now also honors `ENABLE_QUEUE_IN_TEST`, keeping behavior consistent for worker-side enqueue paths during compose E2E.
5. **Startup logs now expose queue mode**
   - Gateway/worker startup logs include `queue_enabled_in_test` and `queue_transport` for easy CI confirmation.
6. **E2E timeout diagnostics are stage-specific**
   - On canonical timeout, harness now prints:
     - inbound event rows for invoice message id,
     - canonical invoice/item counts,
     - Redis queue depth (`bull-<queue>-wait`),
     - filtered worker logs for dequeue/processing/failure markers,
     - filtered gateway logs for webhook accepted/enqueue-related markers.

## Evidence added
- New explicit queue mode switch in E2E env and service startup logs.
- New timeout-stage forensic output in E2E harness to isolate where the chain breaks.

## Validation result
- Performed targeted static validation: `npm run typecheck`.
- Performed exactly one E2E attempt: `npm run e2e`.
- In this execution environment, E2E still cannot run due to missing Docker CLI (`spawnSync docker ENOENT`), so compose runtime behavior remains to be confirmed in CI/docker-capable host.

## If CI still fails: precise next investigation branch
1. Use the newly printed timeout diagnostics to classify failure stage:
   - no inbound rows => webhook/membership path,
   - inbound exists + queue depth > 0 => worker consumption path,
   - queue depth 0 + no canonical rows => worker processing failure or parse/fetch issues,
   - canonical invoice exists but no items => XML parsing/item extraction contract issue.
2. If queue path is proven live, next likely branch is worker-side processing/runtime constraints (XML fetch allowlist, adapter/network, or tenant-scoped DB write errors) using filtered worker logs and inbound status/error_message.
