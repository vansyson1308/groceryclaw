# CI/CD Plan for Monorepo Multi-Service Deployment (V2)

## Scope
This plan targets the current confirmed model:
- one code monorepo
- independently deployable runtime units: `gateway`, `admin`, `worker`
- migration job: `db-v2-migrate`
- private dependencies: `postgres`, `redis`

It is grounded in existing repo conventions (`apps/*` Dockerfiles, `package.json` scripts, `infra/k8s/*`, and existing GitHub Actions workflows).

## 1) Current state: what exists vs missing

### Already exists
- CI quality gates for V2 (lint/type/test/e2e/perf/docs/kustomize) in `.github/workflows/v2-ci.yml`.
- Manual release workflow exists in `.github/workflows/v2-release.yml` (safe `workflow_dispatch` with optional push/helper execution).
- Active changed-service detector exists at `scripts/release/detect_changed_services.mjs`.
- Per-service Dockerfiles:
  - `apps/gateway/Dockerfile`
  - `apps/admin/Dockerfile`
  - `apps/worker/Dockerfile`
- K8s deploy units and image names already split in `infra/k8s/overlays/prod/kustomization.yaml` (`ghcr.io/groceryclaw/{gateway,admin,worker}`).
- Migration job manifest exists (`infra/k8s/base/migrate-job.yaml`) and runs `npm run db:v2:migrate`.
- Deploy contracts for each service exist under `infra/deploy/{gateway,admin,worker}`.

### Missing for full per-service CD
- Environment-specific secret/registry/deploy executor integration for fully unattended production releases.
- Production-grade automated image-tag mutation/apply strategy per environment (currently emitted as release artifacts + helper scripts).
- Runtime smoke-gate integration against real environment endpoints in CI with managed credentials.

## 2) Target CI/CD model

Use two layers:
1. **Validation CI (already present):** full quality gates on PR/push.
2. **Release CD (to add incrementally):**
   - detect changed services from path diff,
   - build/publish only required service images,
   - run migration step when needed,
   - deploy in safe order,
   - run smoke checks after each stage.

## 3) Per-service build strategy

- Build each service from monorepo root with service Dockerfile:
  - gateway: `docker build -f apps/gateway/Dockerfile .`
  - admin: `docker build -f apps/admin/Dockerfile .`
  - worker: `docker build -f apps/worker/Dockerfile .`
- Publish to per-service registries already reflected in kustomize overlay:
  - `ghcr.io/groceryclaw/gateway`
  - `ghcr.io/groceryclaw/admin`
  - `ghcr.io/groceryclaw/worker`

## 4) Image tagging strategy (safe + traceable)

Recommended tags per built service:
- immutable commit tag: `sha-<short_sha>`
- branch/environment tag (optional): `<env>-latest`
- semver/release tag (optional): `<release_tag>`

Minimum viable required tag: `sha-<short_sha>`.

## 5) Changed-path detection strategy

### Service-specific paths
- gateway-only paths:
  - `apps/gateway/**`
  - `infra/deploy/gateway/**`
- admin-only paths:
  - `apps/admin/**`
  - `infra/deploy/admin/**`
- worker-only paths:
  - `apps/worker/**`
  - `infra/deploy/worker/**`

### Shared paths that should trigger all three rebuilds
- `packages/common/**` (shared runtime library imported by all services)
- root build/workspace config:
  - `package.json`, `package-lock.json`, `tsconfig.base.json`, `tsconfig.build.json`
- cross-service infra/runtime contracts:
  - `infra/k8s/base/**`
  - `infra/k8s/overlays/prod/**`
- migrations/runtime DB contract changes:
  - `db/v2/**`
  - `scripts/v2/db_v2_*.mjs`

### Docs-only paths (default: no image rebuild)
- `docs/**` except deploy contracts that explicitly alter runtime env contract expectations.

## 6) Release sequencing strategy

Default release order:
1. run migration job if migration-triggering files changed
2. deploy worker (internal)
3. deploy admin (private)
4. deploy gateway (public ingress last)

Reason: avoid accepting external traffic before backend processing + control-plane + schema are ready.

## 7) Migration sequencing policy

Run `db-v2-migrate` when any of these change:
- `db/v2/migrations/**`
- migration scripts (`scripts/v2/db_v2_migrate.mjs`, `scripts/v2/db_v2_lib.mjs`, related migration helpers)
- app changes that introduce new required DB contract (explicitly flagged in release PR)

Do not auto-run rollback in pipeline. Keep rollback manual + controlled.

## 8) Rollback strategy (high-level)

- Prefer rolling back service images independently to last known-good tag.
- If migration is backward-compatible, rollback only app images.
- If migration is not backward-compatible, invoke controlled DB rollback procedure and then restore compatible app tags.
- Always verify readiness/smoke checks before re-opening public traffic.

## 9) Rebuild triggers by service (explicit)

### Gateway rebuild triggers
- `apps/gateway/**`
- gateway deploy contract changes
- any shared-path trigger listed above

### Admin rebuild triggers
- `apps/admin/**`
- admin deploy contract changes
- any shared-path trigger listed above

### Worker rebuild triggers
- `apps/worker/**`
- worker deploy contract changes
- any shared-path trigger listed above

## 10) Safe defaults for partial deploys

- If exactly one service changed and no shared trigger changed: deploy only that service.
- If shared trigger changed: rebuild and release all three services.
- If migration changed: require migration stage before gateway rollout.
- If detection is uncertain: choose safer full rebuild/deploy of all three.

## 11) Explicit answers

### Can gateway/admin/worker be built and released independently today?
Yes. Each has its own Dockerfile, runtime command, k8s Deployment image, and deploy contract docs.

### What repo changes should trigger rebuild of all three services?
At minimum: `packages/common/**`, root workspace/build config files, shared k8s overlays/base, DB contract/migration files.

### What repo changes should trigger only one service rebuild?
Service-local changes under `apps/<service>/**` plus that service’s `infra/deploy/<service>/**` contract docs/templates (when runtime contract changed), with no shared trigger touched.

### Where does `packages/common` force shared rebuild behavior?
All three apps depend on `@groceryclaw/common` (`file:../../packages/common`) in their package manifests, so changes in `packages/common/**` should rebuild all runtime images.

### What is the minimum viable deployment pipeline for this repo?
1. detect changed services + shared triggers,
2. build/publish required images with commit tag,
3. run migration job if required,
4. deploy worker/admin/gateway in order,
5. run smoke checks and halt rollout on failure.

## 12) Implemented execution assets (current)
- Active detector: `scripts/release/detect_changed_services.mjs`
- Active manual release workflow: `.github/workflows/v2-release.yml`
- Active helper scripts: `scripts/release/render_k8s_manifests.sh`, `scripts/release/deploy_k8s.sh`, `scripts/release/smoke_check.sh`
- Templates retained for reference: `infra/deploy/ci/*`

