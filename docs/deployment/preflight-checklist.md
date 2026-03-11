# Deployment Preflight Checklist (V2)

Use this checklist before the first real DevOps-run deployment.

## 1) Required tools
- `node` >= 20
- `docker`
- `git`
- `jq`
- `kubectl` (required for cluster checks/deploy helpers)
- `kustomize` or `kubectl kustomize` (required for manifest render helper)
- `curl` + `openssl` (required only for deep gateway webhook smoke)

## 2) Required access
- GitHub Actions permission to run `V2 Release` workflow.
- GHCR push permission for:
  - `ghcr.io/groceryclaw/gateway`
  - `ghcr.io/groceryclaw/admin`
  - `ghcr.io/groceryclaw/worker`
- Cluster access for target namespace (`groceryclaw-v2` by default).

## 3) Required secrets (platform-managed)
- Database:
  - `DB_APP_URL`
  - `DB_ADMIN_URL`
- Redis:
  - `REDIS_URL` (or equivalent password-based composition)
- Gateway auth:
  - `WEBHOOK_SIGNATURE_SECRET`
- Admin auth:
  - `ADMIN_OIDC_ISSUER`
  - `ADMIN_OIDC_AUDIENCE`
  - `ADMIN_OIDC_JWKS_URI`
- Crypto:
  - `INVITE_PEPPER_B64`
  - `ADMIN_MEK_B64`
  - `WORKER_MEK_B64`

## 4) Required environment variables for local operator runs
- `NAMESPACE` (default: `groceryclaw-v2`)
- `SERVICES` (default release order: `worker,admin,gateway`)
- `RUN_MIGRATIONS` (`true|false`)
- `DRY_RUN` (`true|false`)
- `RUN_GATEWAY_WEBHOOK_SMOKE` (`true|false`)

## 5) Cluster / namespace prerequisites
- Namespace exists (default `groceryclaw-v2`).
- Deployments exist:
  - `deploy/gateway`
  - `deploy/admin`
  - `deploy/worker`
- Migration source job exists if migration helper is used:
  - `job/db-v2-migrate`
- Baseline manifests already applied from `infra/k8s/overlays/prod`.

## 6) Registry prerequisites
- Docker daemon is available for local build/push operations.
- GHCR auth available in Actions (or manual operator shell).
- Release tag strategy decided (`sha-*` minimum).

## 7) Migration prerequisites
- DB connectivity validated from runtime environment.
- `DB_ADMIN_URL` secret present and valid.
- Migration policy understood: run before public gateway rollout when required.

## 8) Dry-run checklist (recommended first)
1. Run local preflight script (non-destructive):
   ```bash
   CHECK_CLUSTER=false CHECK_REGISTRY=false REQUIRE_ENV=false bash scripts/release/preflight_check.sh
   ```
2. Run workflow in safe mode:
   - `push_images=false`
   - `run_k8s_helpers=false`
   - `dry_run=true`
3. Inspect release artifact:
   - `artifacts/release/release-plan.json`
   - `artifacts/release/k8s-rendered.yaml`
4. Validate service selection and migration flag match intended change set.

## 9) Go / No-Go gates before first deploy

### GO
- Preflight script passes for your intended mode.
- All required secrets are present in platform secret manager.
- Release workflow builds expected images with immutable tag.
- Migration requirement is explicitly decided.
- Rollback owner and process are assigned.

### NO-GO
- Missing OIDC/DB/Redis/webhook/crypto secrets.
- No cluster context/namespace access.
- Migration required but DB access/plan unclear.
- Release artifact doesn’t match intended services/tag/order.

## 10) Fast preflight command matrix
- Tooling-only:
  ```bash
  bash scripts/release/preflight_check.sh
  ```
- Tooling + cluster shape checks:
  ```bash
  CHECK_CLUSTER=true TARGET_NAMESPACE=groceryclaw-v2 REQUIRE_DOCKER=true bash scripts/release/preflight_check.sh
  ```
- Full strict local env presence check:
  ```bash
  REQUIRE_ENV=true bash scripts/release/preflight_check.sh
  ```
