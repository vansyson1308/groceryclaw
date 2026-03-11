# Docs-to-Code Map (V2 runtime)

| Service | Bind / Port | Endpoints | Readiness behavior | Env vars | Code | Deploy manifests |
|---|---|---|---|---|---|---|
| Gateway | `0.0.0.0:8080` (default) | `POST /webhooks/zalo`, `GET /healthz`, `GET /readyz` | `/readyz` returns 200 only when DB ping + Redis ping succeed (strict by default) | `GATEWAY_HOST`, `GATEWAY_PORT`, `GATEWAY_METRICS_PORT`, `READYZ_STRICT`, `READYZ_TIMEOUT_MS`, `REDIS_URL`, `DB_APP_URL` | `apps/gateway/src/server.ts` | `infra/compose/v2/docker-compose.yml`, `infra/k8s/base/gateway-deployment.yaml` |
| Admin (private) | `127.0.0.1:3001` (default) | `GET /healthz`, `GET /readyz`, `/tenants/*` admin APIs | `/readyz` returns 200 only when DB ping + Redis ping succeed (strict by default) | `ADMIN_HOST`, `ADMIN_PORT`, `ADMIN_METRICS_PORT`, `READYZ_STRICT`, `READYZ_TIMEOUT_MS`, `REDIS_URL`, `DB_ADMIN_URL` | `apps/admin/src/server.ts` | `infra/compose/v2/docker-compose.yml`, `infra/k8s/base/admin-deployment.yaml` |
| Worker (private) | health server on `WORKER_HEALTH_PORT` (default `3002`), metrics on `9090` | `GET /healthz`, `GET /readyz` (health server); `/metrics` (metrics server) | `/readyz` returns 200 only when DB ping + Redis ping succeed (strict by default) | `WORKER_HEALTH_SERVER_ENABLED`, `WORKER_HEALTH_PORT`, `WORKER_METRICS_PORT`, `READYZ_STRICT`, `READYZ_TIMEOUT_MS`, `REDIS_URL`, `DB_APP_URL` | `apps/worker/src/index.ts`, `apps/worker/src/health-server.ts` | `infra/compose/v2/docker-compose.yml`, `infra/k8s/base/worker-deployment.yaml` |
| Queue runtime | Redis list queue (`bull:process-inbound:wait`) | Producer: `Queue.add`; Consumer: `Worker` loop | No separate probe endpoint; availability checked via Redis `PING` in service `/readyz` | `REDIS_URL` (+ db/password parsed) | `packages/common/src/bullmq-lite.ts`, `packages/common/src/redis.ts` | `infra/compose/v2/docker-compose.yml` |

## Notes
- Runtime HTTP implementation is Node's built-in `node:http` server, not Fastify.
- Queue implementation is a lightweight Redis-list shim (`RPUSH` / `BRPOP`), with retry/DLQ semantics handled by service logic and DB job status, not full BullMQ server-side features.

| Observability | Cluster-private ServiceMonitors | Prometheus scrape `/metrics` | Alerts on readiness/dependency/auth/lag/backlog | n/a | `apps/gateway/src/server.ts`, `apps/admin/src/server.ts`, `apps/worker/src/metrics.ts` | `infra/k8s/observability/servicemonitors.yaml`, `infra/k8s/observability/prometheusrules.yaml` |
