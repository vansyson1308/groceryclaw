# DevOps Execution Runbook (V2 deployment execution layer)

## 1. Purpose
This runbook describes **how to execute** build/release/deploy operations for GroceryClaw V2 using active repo assets.

Scope is intentionally limited to safe, grounded automation:
- no business-logic changes
- no repo split
- no legacy path removal in this phase
- no speculative vendor-specific production manifests

## 2. Execution assets added
- Changed-service detector: `scripts/release/detect_changed_services.mjs`
- K8s render helper: `scripts/release/render_k8s_manifests.sh`
- K8s deploy helper: `scripts/release/deploy_k8s.sh`
- Smoke helper: `scripts/release/smoke_check.sh`
- Active manual release workflow: `.github/workflows/v2-release.yml`

## 3. Prerequisites

### Repository and CI prerequisites
- Access to repository Actions workflows.
- Permission to read/write GHCR packages for:
  - `ghcr.io/groceryclaw/gateway`
  - `ghcr.io/groceryclaw/admin`
  - `ghcr.io/groceryclaw/worker`

### Tooling for local/manual execution
- `node` (>=20)
- `docker`
- `kubectl`
- `kustomize` (or `kubectl kustomize` support)
- `jq`

### Cluster prerequisites (for deploy helpers)
- Valid kube-context to target cluster.
- Namespace exists: `groceryclaw-v2` (or override `NAMESPACE`).
- Baseline resources already applied (`infra/k8s/overlays/prod`).
- Existing migration job template present in cluster (`job/db-v2-migrate`) if using automated migration trigger helper.

## 4. Secrets and env ownership

### Platform-owned secrets (must exist in target environment)
- DB connection secrets (`DB_APP_URL`, `DB_ADMIN_URL`)
- Redis secret (`REDIS_URL`/password form)
- Gateway webhook auth secret (`WEBHOOK_SIGNATURE_SECRET`)
- Admin OIDC settings (`ADMIN_OIDC_*`)
- Crypto keys (`INVITE_PEPPER_B64`, `ADMIN_MEK_B64`, `WORKER_MEK_B64`)

### Source files for env contracts
- `infra/deploy/gateway/env.example`
- `infra/deploy/admin/env.example`
- `infra/deploy/worker/env.example`

These are templates only; real values come from secret manager/platform env config.

## 5. First deployment flow (step-by-step)

1. **Run manual workflow** `.github/workflows/v2-release.yml` with:
   - `target_environment=staging` (or prod)
   - `push_images=true`
   - `run_k8s_helpers=false` (safe default)
   - `dry_run=true`
2. Download release artifact (`k8s-rendered.yaml`, `release-plan.json`) from workflow run.
3. Confirm services selected, release tag, and migration flag in `release-plan.json`.
4. Update environment deployment config to use built image tags.
5. Execute rollout in order:
   - migrate (if required)
   - worker
   - admin
   - gateway
6. Run smoke checks:
   - lightweight: `scripts/release/smoke_check.sh`
   - deep gateway webhook smoke (optional): `scripts/v2/k8s_prod_smoke.sh` with required secret.

## 6. Manual workflow usage

### Detect + build + publish only (recommended initial mode)
- Workflow: `V2 Release`
- Inputs:
  - `services_override`: blank (auto detect)
  - `push_images`: true
  - `run_k8s_helpers`: false

### Force one service deploy candidate
Set `services_override` to one of:
- `gateway`
- `admin`
- `worker`

### Coordinated release (all services)
Set `services_override=gateway,admin,worker` and use shared release tag output.

## 7. Running migration

### Via workflow plan
- `run_migrations=true` input forces migration stage flag in release plan.

### Via helper script (cluster connected)
```bash
NAMESPACE=groceryclaw-v2 RUN_MIGRATIONS=true SERVICES=worker,admin,gateway DRY_RUN=false bash scripts/release/deploy_k8s.sh
```

Notes:
- Helper uses `kubectl create job --from=job/db-v2-migrate ...`.
- If the source job is missing, apply baseline manifests first.

## 8. Deploy one service only

Example (admin only, no migration):
```bash
NAMESPACE=groceryclaw-v2 RUN_MIGRATIONS=false SERVICES=admin DRY_RUN=false bash scripts/release/deploy_k8s.sh
```
Then smoke-check:
```bash
NAMESPACE=groceryclaw-v2 SERVICES=admin bash scripts/release/smoke_check.sh
```

## 9. Coordinated deploy

```bash
# Preview
NAMESPACE=groceryclaw-v2 RUN_MIGRATIONS=true SERVICES=worker,admin,gateway DRY_RUN=true bash scripts/release/deploy_k8s.sh

# Execute
NAMESPACE=groceryclaw-v2 RUN_MIGRATIONS=true SERVICES=worker,admin,gateway DRY_RUN=false bash scripts/release/deploy_k8s.sh

# Smoke
NAMESPACE=groceryclaw-v2 SERVICES=worker,admin,gateway RUN_GATEWAY_WEBHOOK_SMOKE=false bash scripts/release/smoke_check.sh
```

## 10. Rollback image tags

High-level rollback approach:
1. Roll back affected Deployment image tags to prior known-good SHA tag.
2. Rollout status verify per service.
3. If schema incompatibility exists, coordinate DB rollback procedure before reopening gateway traffic.

This repo does not auto-apply prod image tag rollback manifests; keep rollback execution explicit and audited in platform tooling.

## 11. Automation boundary (important)

What is automated now:
- Changed-service detection.
- Safe manual workflow for build/tag/(optional)push.
- Optional k8s helper execution, dry-run by default.
- Release artifact generation for operator handoff.

What remains manual/platform-specific:
- Final environment image tag mutation/apply strategy.
- Cluster auth/bootstrap and secret provisioning.
- Promotion policies and change approvals.
- Full production rollout policy enforcement.

## 12. Consistency with source-of-truth docs
This execution runbook follows release order and policy from:
- `docs/deployment/final-handoff.md`
- `docs/deployment/release-flow.md`
- `docs/deployment/ci-cd-plan.md`
