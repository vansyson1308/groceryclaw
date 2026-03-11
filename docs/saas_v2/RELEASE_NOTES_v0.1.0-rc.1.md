# GroceryClaw V2 Release Notes — v0.1.0-rc.1

## Why this is an RC (not GA)

This release is tagged `v0.1.0-rc.1` because RC2 audit results in this sandbox were **NO-GO** due environment limitations (tooling/network constraints), not because of identified functional regressions. See:

- `docs/saas_v2/RELEASE_AUDIT_REPORT_RC2.md`
- `docs/saas_v2/RELEASE_AUDIT_CHECKLIST_RC2.md`

## What this release includes

- V2 runtime with strict readiness (`/readyz`) and liveness (`/healthz`) semantics.
- Private metrics endpoints for Gateway/Admin/Worker and Kubernetes observability manifests.
- Parameterized SQL coverage on high-risk paths and SQL interpolation guard in CI.
- Canonical invite-pepper flow using `INVITE_PEPPER_B64` and DB consume function migration.
- Private-by-default Kubernetes deployment templates:
  - Gateway public ingress only
  - Admin private by default
  - Postgres/Redis private only
- Smoke test and monitoring deployment docs for operators.
- Canary-by-tenant controls with rollback procedures.

## Deployment quick links

- Prerequisites: `docs/saas_v2/DEPLOY_K8S_PREREQS.md`
- Deploy overview: `docs/saas_v2/DEPLOY_K8S_OVERVIEW.md`
- Smoke job: `docs/saas_v2/DEPLOY_K8S_SMOKE.md`
- Monitoring: `docs/saas_v2/DEPLOY_K8S_MONITORING.md`
- K8s troubleshooting: `docs/saas_v2/TROUBLESHOOTING_K8S.md`

## Before onboarding customers

Complete:

- `docs/saas_v2/VERIFY_BEFORE_CUSTOMERS.md`
- `docs/saas_v2/RELEASE_CHECKLIST.md`
- `docs/saas_v2/SECURITY_CHECKLIST.md`
- `docs/saas_v2/SLO_GATES.md`

## Operational limitations / notes

- Production webhook recommendation is `WEBHOOK_VERIFY_MODE=mode1`; mode2 is for staged environments unless explicitly overridden.
- RC audit blockers in the sandbox were environmental:
  - SQL executor tooling unavailable for migration command execution
  - Docker/Compose unavailable for mandatory E2E in this runtime
  - `kustomize` binary unavailable locally
  - dependency audit API access restricted
- Alerting includes readiness/dependency/auth/backlog signals; ACK latency alert currently uses an average-latency proxy until histogram-based p95 is exported.

## Canary and rollback

Canary by tenant:

```bash
npm run canary:set-mode -- --tenants <tenant-uuid> --mode v2 --apply
npm run canary:status -- --tenants <tenant-uuid>
```

Rollback tenant:

```bash
npm run canary:set-mode -- --tenants <tenant-uuid> --mode legacy --apply
```

Deployment rollback if needed:

```bash
kubectl rollout undo deployment/gateway -n groceryclaw-v2
kubectl rollout undo deployment/worker -n groceryclaw-v2
kubectl rollout undo deployment/admin -n groceryclaw-v2
```
