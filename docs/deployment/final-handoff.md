# Final Deployment Handoff (Operator Pack)

## Executive summary
GroceryClaw V2 is ready for deployment as a **single monorepo with independently deployable runtime units**. The deploy model is:
- `gateway` = public ingress web service
- `admin` = private web service (internal by default)
- `worker` = internal background worker
- `db-v2-migrate` = migration batch job
- `postgres`, `redis` = private dependencies

This handoff intentionally avoids repo split, business-logic changes, or legacy path removal at this stage.

## Final deployment model
- **Model:** Monorepo + separate deploy units per runtime.
- **Source of truth:**
  - service topology/decision/matrix/runbook docs under `docs/deployment/`
  - per-service deploy contracts under `infra/deploy/{gateway,admin,worker}/`
  - CI/CD templates under `infra/deploy/ci/`

## Deployable units
1. **gateway** (`apps/gateway`, `apps/gateway/Dockerfile`, `node apps/gateway/dist/server.js`, port `8080`, metrics `9100`)
2. **admin** (`apps/admin`, `apps/admin/Dockerfile`, `node apps/admin/dist/server.js`, port `3001`, metrics `9101`)
3. **worker** (`apps/worker`, `apps/worker/Dockerfile`, `node apps/worker/dist/index.js`, health `3002`, metrics `9090`)
4. **db-v2-migrate** (`npm run db:v2:migrate`, batch job)

## Public vs internal topology
- **Public:** gateway only (default V2 ingress)
- **Private/Internal:** admin (default), worker, migration job, postgres, redis
- **Optional/controlled exception:** admin ingress only with explicit network + auth controls

## Required dependencies
- `gateway`: PostgreSQL + Redis
- `admin`: PostgreSQL + Redis
- `worker`: PostgreSQL + Redis
- `db-v2-migrate`: PostgreSQL (admin URL)

## Deploy order
1. Ensure private dependencies and secrets are available (`postgres`, `redis`, app secrets)
2. Run migration stage when required (`db-v2-migrate`)
3. Deploy `worker`
4. Deploy `admin`
5. Deploy `gateway` last (public cutover last)

## Migration policy
Run migrations before public ingress rollout when DB contract could change, including when:
- `db/v2/migrations/**` changes
- migration scripts (`scripts/v2/db_v2_*`) change
- release includes explicit schema contract updates

Migration rollback remains manual/controlled (not auto in CI/CD).

## Rollback summary
- Prefer service-level rollback first (image tag rollback per service).
- If shared change impacts multiple services, rollback all affected service tags together.
- If schema incompatibility is involved, pause gateway traffic, execute controlled DB rollback procedure, then restore compatible service tags.

## CI/CD minimum viable flow
1. Detect changed services + shared triggers.
2. Build/publish required images (immutable `sha-*` tag minimum).
3. Run migration stage if required.
4. Deploy in order: worker -> admin -> gateway.
5. Execute smoke checks after each stage; stop on failure.

## What DevOps must provision
- Private PostgreSQL and Redis endpoints.
- Secret manager entries for service env contracts (`infra/deploy/*/env.example` as key map only).
- Container registry access for per-service images.
- Runtime deploy executor (k8s or equivalent) supporting ordered rollout and smoke gates.
- Monitoring/logging/alerting coverage for health/readiness and queue-processing signals.

## What is intentionally NOT being done yet
- No repository split.
- No business logic refactor.
- No removal of legacy root deployment assets yet.
- No vendor-specific production config generation in this handoff pack.

## Open questions requiring platform confirmation
1. Will release automation run as staged `workflow_dispatch` first, or direct branch-triggered CD?
2. Where will migration execution live operationally (pipeline stage vs platform job controller)?
3. What smoke endpoints/auth probes are required by platform for promotion gates?
4. Is admin permanently private-only, or conditionally exposed with restricted ingress policy?

## Consistency audit corrections applied
During final audit, one documentation inconsistency was found and corrected:
- `docs/deployment/ci-cd-plan.md` previously listed changed-service detection and release template as "missing" even though templates had already been added under `infra/deploy/ci/`.
- Updated to reflect current state: templates exist; missing items are active workflow wiring and environment integration.

## Go / No-Go checklist for first production deployment

### Go criteria
- [ ] V2 CI is green for release commit.
- [ ] `gateway`, `admin`, `worker` images built and pushed with immutable tags.
- [ ] Secrets provisioned for all required env groups.
- [ ] Private connectivity to postgres/redis verified from runtime environment.
- [ ] Migration step completed successfully (if required by change set).
- [ ] Worker readiness and startup checks pass.
- [ ] Admin readiness checks pass (private path).
- [ ] Gateway readiness checks pass before public cutover.
- [ ] Post-cutover webhook + core smoke checks pass.

### No-Go conditions
- [ ] Unverified DB schema compatibility with target service tags.
- [ ] Missing/invalid secrets for webhook, OIDC, DB, Redis, or crypto keys.
- [ ] Admin exposure policy unresolved but external ingress planned.
- [ ] Migration needed but not executed/validated.
