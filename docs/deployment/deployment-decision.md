# Deployment Decision (Minimal-change, repo as-is)

## Decision
**Recommended canonical model: B. monorepo with independently deployable apps.**

This means:
- Keep source code in one repository.
- Treat `gateway`, `admin`, and `worker` as separate deploy targets with independent image build/deploy/release controls.
- Keep shared code (`packages/common`) and shared migration assets in-repo for now.

## Why this is the minimal-risk path

1. **Service boundaries already exist in code and infra**
   - `apps/gateway`, `apps/admin`, `apps/worker` each have their own package and Dockerfile.
   - Kubernetes base already defines separate Deployments and Services for these apps.

2. **Monorepo coupling is explicit today**
   - Workspaces include `apps/*` and `packages/*`.
   - All three apps depend on `@groceryclaw/common` via local workspace path (`file:../../packages/common`).
   - Shared DB migration flow (`npm run db:v2:migrate`) is already used by dedicated migrate job.

3. **Public exposure model is already split by role**
   - Gateway is public by default.
   - Admin is internal by default (optional restricted ingress overlay exists).
   - Worker is internal/background with health + metrics only.

4. **No hard evidence that separate repos are required now**
   - The repository already supports multi-image deployment and multi-deployment manifests.
   - The current blocker is deployment packaging/clarity, not source-repo count.

## "3 endpoints" ambiguity resolution

### Actual external HTTP services
- **Gateway** (intended public ingress; webhook/API edge).
- **Admin** can be external only if optional admin ingress overlay is intentionally enabled.
- **Legacy n8n** is externally exposed only in legacy root compose mode, not in V2 canonical path.

### Internal-only services/processes
- **Worker** (queue consumer/background jobs).
- **Migrate job** (`db-v2-migrate`) run as a batch job.
- **Worker/admin/gateway metrics services** are cluster-internal.

### Non-HTTP dependencies
- **PostgreSQL** (stateful DB).
- **Redis** (queue/cache broker).

### Likely DevOps/platform objection
Most likely objection is to **multiple deployable runtimes in one repo/one app slot** (gateway + admin + worker), not literally three public URLs. Platform constraints often require one deployment definition per runtime process.

## Mismatches and blockers to clean platform deployment

1. **Legacy vs V2 ambiguity in root deployment path**
   - Root `docker-compose.yml` defines legacy `n8n` + postgres.
   - V2 runtime is defined under `infra/compose/v2` and `infra/k8s`.

2. **Shared build context for all app Dockerfiles**
   - Each app Dockerfile copies whole `apps` + `packages` and runs root build; operationally fine but can blur strict per-service ownership.

3. **Shared env model across services**
   - DB/Redis and several feature flags are shared, increasing config coupling risk if teams treat services as fully isolated.

4. **Migration ownership tied to shared runtime/tooling**
   - Migrations are centralized in `db/v2/migrations` and executed via root script/job; requires coordinated rollout discipline.

5. **Internal service exposure must remain explicit**
   - Admin optional public ingress exists and should remain disabled unless access controls are confirmed.

## What NOT to do yet

- Do **not** split into separate repos now.
- Do **not** move business logic between apps.
- Do **not** remove legacy assets until V2 deploy path documentation and service ownership are finalized.
- Do **not** make admin publicly reachable by default.

## Assumptions

- Target deployment is V2 architecture (`gateway`, `admin`, `worker`) rather than legacy `n8n` mode.
- Platform can host multiple services from one repository as separate deploy definitions (or can be made to do so with per-service deploy configs).
- DB and Redis remain managed as private dependencies.

## Open questions requiring DevOps confirmation

1. Does platform require **separate repos**, or just **separate deploy specs/services**?
2. Is admin intended to be strictly private (VPN/port-forward) or exposed with allowlist + OIDC?
3. Will DB migration run as a predeploy job per release, or centralized pipeline step?
4. Which deployment path is canonical for production governance: `infra/k8s/overlays/prod` only, or compose-on-VPS fallback?

## Minimal-change phased implementation plan

### Phase 1 — Docs/config cleanup only
- **Goal:** remove ambiguity, declare canonical path.
- **Files to touch:**
  - `README.md` (deployment section clarifying V2 canonical path vs legacy)
  - `docs/deployment/deployment-decision.md`
  - `docs/deployment/deployment-matrix.md`
- **Expected outcome:** one agreed deployment model and service boundaries.
- **Rollback safety:** docs-only; no runtime impact.

### Phase 2 — Per-service deploy assets (no app-logic refactor)
- **Goal:** explicit deploy units for gateway/admin/worker.
- **Files to touch (new or adjusted):**
  - `infra/deploy/gateway/*`
  - `infra/deploy/admin/*`
  - `infra/deploy/worker/*`
  - optional CI workflow files for per-service build/publish
- **Expected outcome:** platform can map one deploy definition per runtime.
- **Rollback safety:** retain existing `infra/k8s` and compose files during transition.

### Phase 3 — Legacy path quarantine/removal
- **Goal:** prevent accidental deploy of legacy mode.
- **Files to touch:**
  - root `docker-compose.yml` (archive/deprecate guidance)
  - `README.md` legacy notes + explicit deprecation banner
  - optional `docs/deployment/legacy-path.md`
- **Expected outcome:** reduced operational confusion.
- **Rollback safety:** quarantine first; remove only after confirmed cutover.

### Phase 4 — Optional repo split only if platform truly requires it
- **Goal:** split only after boundaries/contracts are hardened.
- **Files to touch (future):**
  - package publishing/versioning config for `packages/common`
  - migration ownership/runbook docs
  - extraction plan per service
- **Expected outcome:** low-risk split if mandated.
- **Rollback safety:** keep monorepo as source of truth until parity checks pass.

## Recommended target structure for deploy configs (no code moves now)

```text
apps/
  gateway/
  admin/
  worker/
infra/
  deploy/
    gateway/        # platform service config + env contract
    admin/          # platform service config + private ingress policy
    worker/         # platform worker config + queue dependency
  k8s/
  compose/
```

This structure isolates deployment ownership while preserving monorepo code and shared packages.
