# Platform Deploy Runbook (V2 canonical)

## 1) Canonical model (operator view)

GroceryClaw remains a **code monorepo** but is deployed as **separate runtime units**:
- **Public service:** `gateway`
- **Private service:** `admin`
- **Worker service:** `worker`
- **Batch job:** `db-v2-migrate`
- **Private dependencies:** `postgres`, `redis`

> Repo split is **not required now**. The current repo already supports independent runtime deployment via separate app directories, Dockerfiles, and Kubernetes deployments.

## 2) Key distinction to avoid confusion

### Code monorepo
One source repository contains all app code, shared package(s), infra manifests, and migration scripts.

### Deploy units
Runtime units are independently deployable services/jobs built from the same repository.

### Public endpoints
Public exposure is a network policy decision, not a repo-count decision:
- Gateway is public by default in V2.
- Admin is private by default (optional restricted ingress only).
- Worker has no public ingress.

## 3) Platform resource mapping

| Platform resource type | GroceryClaw unit | Source/Dockerfile | Exposure |
|---|---|---|---|
| Public web service | gateway | `apps/gateway` / `apps/gateway/Dockerfile` | Public |
| Private web service | admin | `apps/admin` / `apps/admin/Dockerfile` | Private by default |
| Worker/background service | worker | `apps/worker` / `apps/worker/Dockerfile` | Internal only |
| Batch/release job | db-v2-migrate | `scripts/v2/db_v2_migrate.mjs` (invoked via `npm run db:v2:migrate`) | Internal only |
| Private managed DB | postgres | infra-managed | Internal only |
| Private managed cache/queue | redis | infra-managed | Internal only |

## 4) Deploy order (first / next / last)

1. **First:** provision/update private dependencies (`postgres`, `redis`) and secrets.
2. **Next:** run migration job (`db-v2-migrate`).
3. **Then:** deploy `worker` (internal) and `admin` (private) with readiness checks.
4. **Last:** deploy/shift traffic to `gateway` (public ingress).

Rationale: public ingress should be last so external traffic arrives only after dependencies and processing path are healthy.

## 5) Minimal deployment checklist

- [ ] Confirm deploy target is V2 path (not legacy root `docker-compose.yml` mode).
- [ ] Build/publish service images independently: gateway/admin/worker.
- [ ] Apply env contracts per service from `infra/deploy/<service>/env.example`.
- [ ] Keep secrets in platform secret manager (do not commit secret values).
- [ ] Ensure network policy: gateway public, admin private-default, worker internal-only.
- [ ] Run migration job before opening gateway traffic.
- [ ] Validate health/readiness:
  - gateway: `/healthz`, `/readyz`
  - admin: `/healthz`, `/readyz`
  - worker: `/healthz`, `/readyz`
- [ ] Validate metrics scraping on internal ports only.

## 6) Common mistakes to avoid

1. Treating "3 endpoints" as "must split into 3 repos".
2. Deploying from root legacy `docker-compose.yml` unintentionally when target is V2.
3. Exposing admin publicly without explicit allowlist + auth controls.
4. Routing public traffic to worker (worker is not a public API service).
5. Rolling out gateway before DB/Redis/migration readiness is confirmed.
6. Mixing incompatible app image versions with unverified migration state.

## 7) High-level rollback guidance

If release issues occur:
1. Stop/shift public gateway traffic first (or route to previous stable gateway image).
2. Roll back affected runtime unit(s) independently (gateway/admin/worker).
3. Keep DB schema compatibility in mind; if migration rollback is required, follow controlled DB rollback procedure.
4. Re-check readiness endpoints and core flow before re-opening public ingress.

## 8) Service deploy asset index

- `infra/deploy/gateway/README.md`
- `infra/deploy/gateway/env.example`
- `infra/deploy/gateway/service-manifest.example.yaml`
- `infra/deploy/admin/README.md`
- `infra/deploy/admin/env.example`
- `infra/deploy/admin/service-manifest.example.yaml`
- `infra/deploy/worker/README.md`
- `infra/deploy/worker/env.example`
- `infra/deploy/worker/service-manifest.example.yaml`
