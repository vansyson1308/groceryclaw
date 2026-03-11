# Deployment Matrix (repo state as-is)

## Canonical target
- Canonical deploy target is **V2 multi-service** (`gateway`, `admin`, `worker`) from one monorepo.
- Legacy root compose (`n8n`) is a separate/older mode and should not be the default production path.

## Service / unit matrix

| Unit name | Code path | Runtime type | Start command | Port | Public/Internal | Requires DB? | Requires Redis? | Shared package dependencies | Can deploy independently today? | Needed changes to deploy independently |
|---|---|---|---|---|---|---|---|---|---|---|
| gateway | `apps/gateway` | HTTP stateless app (ingress/webhook edge) | `node apps/gateway/dist/server.js` (Docker CMD) | 8080 app, 9100 metrics | Public (default public ingress in k8s prod overlay) | Yes | Yes | `@groceryclaw/common` | Yes (as separate image/deployment already) | Add explicit platform service spec + env contract doc for gateway |
| admin | `apps/admin` | HTTP admin/control-plane API | `node apps/admin/dist/server.js` (Docker CMD) | 3001 app, 9101 metrics | Internal by default; optional restricted public ingress | Yes | Yes | `@groceryclaw/common` | Yes (as separate image/deployment already) | Keep private ingress defaults explicit; add admin deploy spec with auth/network policy |
| worker | `apps/worker` | Background worker (queue consumer) + health/metrics HTTP | `node apps/worker/dist/index.js` (Docker CMD) | 3002 health, 9090 metrics | Internal-only | Yes | Yes | `@groceryclaw/common` | Yes (as separate image/deployment already) | Define worker-type deploy target (non-public service) in platform config |
| db-v2-migrate | `scripts/v2/db_v2_migrate.mjs` + `infra/k8s/base/migrate-job.yaml` | Batch/job (migration runner) | `npm run db:v2:migrate` | N/A | Internal-only job | Yes | No | root scripts + DB assets | Yes (k8s job exists) | Define release sequencing (predeploy/postdeploy) per environment |
| postgres | infra-managed (`docker-compose*`, cluster service) | Stateful DB | image entrypoint | 5432 | Internal-only dependency (host-exposed in local compose variants) | N/A | No | N/A | Depends on platform-managed DB posture | For managed platforms, map to private DB service and remove public exposure outside local dev |
| redis | infra-managed (`infra/compose/v2`, cluster service) | Stateful cache/queue broker | image entrypoint | 6379 | Internal-only dependency | No | N/A | N/A | Depends on platform-managed Redis posture | Map to private Redis service and bind worker/gateway/admin via secret URL |
| n8n (legacy mode) | root `docker-compose.yml`, `n8n/workflows` | Legacy workflow engine HTTP app | image entrypoint (`n8nio/n8n`) | 5678 | Public in legacy compose mode | Yes (legacy compose postgres) | No (in root compose) | N/A | Technically yes, but not canonical V2 deploy unit | Quarantine/deprecate from default deployment docs to avoid ambiguity |

## Required env groups per service (minimal grouping)

### gateway
- Core runtime: `NODE_ENV`, `LOG_LEVEL`, `GATEWAY_HOST`, `GATEWAY_PORT`
- Webhook/auth: `WEBHOOK_VERIFY_MODE`, `WEBHOOK_SIGNATURE_SECRET`, related mode/timestamp flags
- Data/queue: `DB_APP_URL` or `POSTGRES_URL`, `REDIS_URL`, `BULLMQ_QUEUE_NAME`
- Readiness/ops: `READYZ_STRICT`, `READYZ_TIMEOUT_MS`, metrics host/port
- Optional onboarding: `V2_ONBOARDING_ENABLED`, invite rate limits, `INVITE_PEPPER_B64`

### admin
- Core runtime: `NODE_ENV`, `LOG_LEVEL`, `ADMIN_HOST`, `ADMIN_PORT`
- AuthN/AuthZ: `ADMIN_OIDC_*`, optional break-glass vars
- Data/queue: `DB_ADMIN_URL` (or fallback DB URL), `REDIS_URL`
- Feature controls: tenant endpoints, secrets toggles, invite TTL/rate
- Crypto: `ADMIN_MEK_B64`, `INVITE_PEPPER_B64`
- Readiness/ops: `READYZ_STRICT`, `READYZ_TIMEOUT_MS`, metrics host/port

### worker
- Core runtime: `NODE_ENV`, `LOG_LEVEL`, `WORKER_HOST`, `WORKER_PORT`
- Queue processing: `REDIS_URL`, `BULLMQ_QUEUE_NAME`, concurrency, retry flags
- Data: `DB_APP_URL` (or fallback DB URL)
- Integration adapters: KiotViet and Zalo stub/base/token vars
- Health/metrics: `WORKER_HEALTH_SERVER_ENABLED`, `WORKER_HEALTH_PORT`, metrics host/port
- Feature controls: XML parsing, mapping, notifier, DLQ/rate-limit flags
- Crypto: `WORKER_MEK_B64`

### migrate job
- `DATABASE_URL` / admin DB credentials
- runtime env needed by migration scripts

## Public vs internal network topology (intended minimal-risk)

```text
Internet
  -> Gateway (public ingress)
      -> Redis (private)
      -> Postgres (private)

Operators (private access / allowlisted ingress)
  -> Admin (internal-default; optional restricted ingress)
      -> Redis (private)
      -> Postgres (private)

Worker (no public ingress)
  -> Redis (private queue)
  -> Postgres (private)
  -> External APIs (KiotViet/Zalo over egress)

Migration Job (internal batch)
  -> Postgres (private)
```

## Minimal platform mapping

- **Public app/service:** `gateway`
- **Private app/service:** `admin`
- **Worker/background service:** `worker`
- **Release/batch job:** `db-v2-migrate`
- **Private managed dependencies:** `postgres`, `redis`
- **Legacy/non-canonical:** root-compose `n8n` path (quarantine from default deploy flow)

## Independency assessment summary

- The three V2 apps are already separable at deployment time (distinct Dockerfiles, images, deployments).
- They are **not fully independent at source/runtime contract level** due to shared package, shared env conventions, and shared migration lifecycle.
- Therefore, independent deployment is feasible **today**, while repo split is **not required now**.
