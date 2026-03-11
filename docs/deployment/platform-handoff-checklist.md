# Platform Handoff Checklist (Final DevOps-Owned Prerequisites)

## Purpose
This checklist captures the **final platform/devops-owned prerequisites** required to move from repo-ready deployment assets to first staging execution.

> Use with:
> - `docs/deployment/devops-execution-runbook.md`
> - `docs/deployment/preflight-checklist.md`
> - `docs/deployment/first-staging-signoff.md`

---

## 1) Platform/DevOps-owned prerequisites
- [ ] Deployment target environment selected (`staging` / `production`)
- [ ] Release operator(s) assigned
- [ ] Rollback approver assigned
- [ ] Change window approved
- [ ] Incident contact channel defined

## 2) Kube/cluster prerequisites
- [ ] Valid kube context configured for target cluster
- [ ] `kubectl config current-context` verified by operator
- [ ] Cluster networking allows app->DB/Redis connectivity
- [ ] Ingress controller path for gateway confirmed
- [ ] Admin exposure mode confirmed (private-default vs restricted ingress)

## 3) Namespace/bootstrap prerequisites
- [ ] Namespace exists (default: `groceryclaw-v2`)
- [ ] Deployments exist: `gateway`, `admin`, `worker`
- [ ] Base/overlay manifests applied from `infra/k8s/overlays/prod`
- [ ] Migration source job exists: `job/db-v2-migrate`
- [ ] ServiceAccounts/RBAC present for migration and services

## 4) Registry / GHCR prerequisites
- [ ] GHCR org/repo permissions validated for CI runner and operators
- [ ] Push access confirmed for:
  - [ ] `ghcr.io/groceryclaw/gateway`
  - [ ] `ghcr.io/groceryclaw/admin`
  - [ ] `ghcr.io/groceryclaw/worker`
- [ ] Pull permissions validated from cluster runtime
- [ ] Image tag policy agreed (`sha-*` immutable required)

## 5) Secret ownership checklist

### Shared runtime secrets
- [ ] `DB_APP_URL` (owner: DevOps/Platform)
- [ ] `DB_ADMIN_URL` (owner: DevOps/Platform)
- [ ] `REDIS_URL` (owner: DevOps/Platform)

### Gateway secrets
- [ ] `WEBHOOK_SIGNATURE_SECRET` provisioned
- [ ] `INVITE_PEPPER_B64` provisioned

### Admin secrets
- [ ] `ADMIN_OIDC_ISSUER` provisioned
- [ ] `ADMIN_OIDC_AUDIENCE` provisioned
- [ ] `ADMIN_OIDC_JWKS_URI` provisioned
- [ ] `ADMIN_MEK_B64` provisioned

### Worker secrets
- [ ] `WORKER_MEK_B64` provisioned
- [ ] Integration tokens provisioned (`KIOTVIET_STUB_TOKEN`, `ZALO_STUB_TOKEN` or real equivalents)

## 6) Image tag mutation/apply checklist (platform-owned)
- [ ] Method selected for updating image tags (to be filled by platform/devops)
  - [ ] kustomize image set pipeline
  - [ ] Helm values update
  - [ ] GitOps patch update
  - [ ] Manual kubectl patch (temporary only)
- [ ] Tag source pinned to workflow output (`sha-...`)
- [ ] Same release tag applied consistently across selected services
- [ ] Promotion rule defined for staging -> production

## 7) Migration ownership checklist
- [ ] Migration trigger owner assigned
- [ ] Rule for when migration runs agreed (db/migration-script changes or explicit DB contract change)
- [ ] Migration monitoring path agreed (job logs / completion check)
- [ ] Rollback decision owner for schema incompatibility assigned

## 8) Staging deploy approval checklist
- [ ] `scripts/release/preflight_check.sh` passes in strict mode for staging
- [ ] `V2 Release` workflow dry run reviewed
- [ ] `release-plan.json` approved (services, migration flag, tag)
- [ ] Rollout order approved: `migrate -> worker -> admin -> gateway`
- [ ] Smoke plan approved (basic + optional deep gateway webhook smoke)

## 9) Post-deploy evidence checklist
- [ ] Workflow run URL captured
- [ ] `release-plan.json` archived
- [ ] Deployed image tags recorded per service
- [ ] Rollout status output captured
- [ ] Smoke outputs captured
- [ ] Migration job status/log captured (if run)

## 10) Signoff
- [ ] **Ready for dry-run**
- [ ] **Ready for staging deploy**
- [ ] **Blocked by:** __________________________________________
- [ ] **Owner/Date:** _________________________________________
