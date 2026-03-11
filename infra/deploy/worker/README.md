# Worker deploy unit

## Purpose
Worker is the background runtime that consumes queue jobs, processes inbound events, performs mapping/sync operations, and dispatches notifier work.

## Ownership boundary
- **Code path:** `apps/worker`
- **Dockerfile:** `apps/worker/Dockerfile`
- **Build context:** repository root (`.`)
- **Runtime command:** `node apps/worker/dist/index.js`

## Network exposure
- **Classification:** Internal-only worker service
- **No public ingress required**
- **Health port:** `3002` (`WORKER_PORT` / `WORKER_HEALTH_PORT`)
- **Metrics port:** `9090` (`WORKER_METRICS_PORT`)
- **Health endpoints:**
  - `GET /healthz`
  - `GET /readyz`
- **Metrics endpoint:** `GET /metrics` on metrics listener

## Dependencies
- **PostgreSQL:** required (`DB_APP_URL` or fallback URL)
- **Redis:** required (`REDIS_URL`) as queue transport
- **Shared package:** `@groceryclaw/common`

## Runtime behavior notes
- Worker is queue-driven (`BULLMQ_QUEUE_NAME`) and not user-facing.
- Health HTTP is for orchestrator checks only.
- External egress may be required for KiotViet/Zalo adapter calls.

## Required env groups
See `infra/deploy/worker/env.example` for minimal deploy surface.

## Health/readiness expectations
- Liveness: `GET /healthz` returns 200 when worker process is running.
- Readiness: `GET /readyz` validates DB/Redis reachability when strict mode enabled.
- Metrics: scrape internal metrics endpoint only.

## Safe deploy notes
1. Ensure queue connectivity and DB connectivity before scaling up worker replicas.
2. Keep worker service internal-only; do not attach public ingress.
3. Tune `WORKER_CONCURRENCY` conservatively and observe queue lag/error rates.

## Rollback notes
- Roll back worker image tag if job failure rate spikes after rollout.
- Preserve queue and DB compatibility when rolling back.
- Verify `/readyz` and job processing recovery (including retry/DLQ behavior).
