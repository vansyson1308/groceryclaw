# First Staging Deployment (Staging-first execution guide)

This guide runs the first staging deployment with minimum risk and maximum observability.

## 1) Sequence overview
1. Run preflight checks.
2. Run release workflow in dry-run planning mode.
3. Run release workflow with image push enabled.
4. Execute cluster rollout in controlled order.
5. Run smoke checks.
6. Collect deployment evidence.

## 2) Step-by-step

### Step A — Preflight
```bash
CHECK_CLUSTER=true TARGET_NAMESPACE=groceryclaw-v2 bash scripts/release/preflight_check.sh
```
Expected output:
- `[PASS] core tools present...`
- `[PASS] release assets present`
- `[PASS] changed-service detector executable`
- `[PASS] cluster checks complete`

If it fails:
- Missing tool => install tool first.
- Namespace/deployment missing => apply baseline manifests first.
- No kube context => fix kube auth/context.

### Step B — Workflow dry-run planning
Run GitHub workflow `V2 Release` with:
- `target_environment=staging`
- `push_images=false`
- `run_k8s_helpers=false`
- `dry_run=true`
- `services_override=` (empty, unless forcing scope)

Expected output/artifacts:
- image build logs (no push)
- `release-plan.json`
- `k8s-rendered.yaml`

Check in `release-plan.json`:
- selected `services`
- `release_tag`
- `run_migrations`
- deploy order includes `worker -> admin -> gateway`

### Step C — Build + push staging images
Re-run `V2 Release` with:
- `push_images=true`
- `run_k8s_helpers=false`
- `dry_run=true`

Expected:
- pushed images tagged with `sha-<short_sha>`
- release artifact updated

If push fails:
- check GHCR permissions
- confirm package namespace/image name

### Step D — Cluster rollout (manual/controlled)
Preview first:
```bash
NAMESPACE=groceryclaw-v2 RUN_MIGRATIONS=true SERVICES=worker,admin,gateway DRY_RUN=true bash scripts/release/deploy_k8s.sh
```

Execute:
```bash
NAMESPACE=groceryclaw-v2 RUN_MIGRATIONS=true SERVICES=worker,admin,gateway DRY_RUN=false bash scripts/release/deploy_k8s.sh
```

Expected output:
- migration job creation/wait logs (if enabled)
- rollout restart + rollout status per service
- completion message

Failure points:
- `job/db-v2-migrate` not found -> apply baseline manifests.
- rollout timeout -> inspect `kubectl describe` + pod logs for target service.

### Step E — Smoke checks
Basic smoke:
```bash
NAMESPACE=groceryclaw-v2 SERVICES=worker,admin,gateway RUN_GATEWAY_WEBHOOK_SMOKE=false bash scripts/release/smoke_check.sh
```

Optional deep gateway smoke (requires webhook secret):
```bash
export WEBHOOK_SIGNATURE_SECRET='<secret>'
NAMESPACE=groceryclaw-v2 RUN_GATEWAY_WEBHOOK_SMOKE=true SERVICES=gateway bash scripts/release/smoke_check.sh
```

Expected output:
- rollout status success for selected services
- optional deep smoke pass line from `scripts/v2/k8s_prod_smoke.sh`

## 3) Deploy only one service (staging)
Example: gateway only, no migration
```bash
NAMESPACE=groceryclaw-v2 RUN_MIGRATIONS=false SERVICES=gateway DRY_RUN=false bash scripts/release/deploy_k8s.sh
NAMESPACE=groceryclaw-v2 SERVICES=gateway RUN_GATEWAY_WEBHOOK_SMOKE=false bash scripts/release/smoke_check.sh
```

## 4) Rollback notes (staging)
- Roll back deployment image tag to prior known-good SHA tag.
- Re-run rollout status checks.
- If schema mismatch is suspected, stop gateway exposure and coordinate DB rollback procedure before retry.

## 5) Evidence to collect after successful staging deploy
- Workflow run URL + inputs used.
- `release-plan.json` artifact.
- Rendered manifest artifact hash (`k8s-rendered.yaml`).
- Final deployed image tags for gateway/admin/worker.
- Smoke check command outputs.
- Any migration job logs/status.
