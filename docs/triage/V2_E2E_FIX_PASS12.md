# V2 E2E FIX PASS12 (Release Polish)

## 1. Cleanup audit
- Keep: queue mode startup fields (`queue_enabled_in_test`, `queue_transport`) because they are low-noise and high-value for CI/on-call triage.
- Keep: stage diagnostics in `run_e2e_compose.mjs` (inbound rows, canonical counts, queue depth, filtered logs), since they directly reduce MTTR when gates fail.
- Keep: PASS2..PASS11 triage docs as historical incident trail; no deletion needed pre-merge.
- Trim: none in runtime code. Existing diagnostics are justified and not overly risky.
- Leave for later: large aggregate triage report cleanup, if desired, can be done in a dedicated docs-only housekeeping PR.

## 2. Merge-readiness notes
- Added explicit env documentation for `WORKER_XML_ALLOW_HTTP_DOMAINS` in compose examples.
- Clarified that production should keep HTTP domain allowlist empty by default.
- Added E2E example env entries so compose expectations are explicit.
- With green checks and this doc polish, branch is merge-ready.

## 3. Deploy-readiness checklist
### Pre-deploy
- Confirm production env keeps `WORKER_XML_ALLOW_HTTP_DOMAINS` empty.
- Confirm `WORKER_XML_ALLOWED_DOMAINS` remains the expected public invoice domains.
- Confirm `ENABLE_QUEUE_IN_TEST` is **false/unset** outside test environments.

### Deploy
- Deploy gateway and worker together to keep queue + worker contract aligned.
- Ensure no prod compose/k8s manifest enables E2E-only HTTP stub domains.

### Post-deploy smoke
- Send a known-good invoice webhook with an HTTPS attachment in allowed domains.
- Verify worker logs show `PROCESS_INBOUND_EVENT` success path (no `unsafe_url`).
- Verify DB side effects: inbound status transitions and canonical invoice + item rows present.

### Rollback triggers
- Repeated `worker_job_failed` with `reason=unsafe_url` for known-good production URLs.
- Inbound events stuck at `received` with sustained zero canonical inserts.

## 4. PASS12 changes applied
- Documentation-only updates to env examples and release-polish artifact.
- No runtime behavior changes in this pass.

## 5. Expected outcome
- Merge/deploy operators have explicit guidance for strict production URL policy and E2E-only overrides.
- Incident diagnostics retained for future regressions.
