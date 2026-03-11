# Gateway deploy unit

## Purpose
Gateway is the public HTTP ingress for V2. It receives webhook traffic, verifies request authenticity, and enqueues processing work for worker.

## Ownership boundary
- **Code path:** `apps/gateway`
- **Dockerfile:** `apps/gateway/Dockerfile`
- **Build context:** repository root (`.`)
- **Runtime command:** `node apps/gateway/dist/server.js`

## Network exposure
- **Classification:** Public web service
- **App port:** `8080` (`GATEWAY_PORT`)
- **Metrics port:** `9100` (`GATEWAY_METRICS_PORT`)
- **Expected public routes:**
  - `POST /webhooks/zalo`
  - `GET /healthz`
  - `GET /readyz`
- **Metrics endpoint:** `GET /metrics` on metrics listener

## Dependencies
- **PostgreSQL:** required (`DB_APP_URL`/`POSTGRES_URL` fallback)
- **Redis:** required (`REDIS_URL`) for queue operations
- **Shared package:** `@groceryclaw/common`

## Required env groups
See `infra/deploy/gateway/env.example` for a minimal deploy surface.

## Health/readiness expectations
- Liveness: `GET /healthz` returns 200 when process is alive.
- Readiness: `GET /readyz` returns 200 only when dependency checks pass (`READYZ_STRICT=true`).
- If strict readiness is disabled, `/readyz` can report ready without full dependency validation.

## Safe deploy notes
1. Deploy gateway only after private dependencies (DB/Redis) are reachable.
2. Ensure webhook secret and verify mode vars are configured before exposing ingress.
3. Keep body-size/rate-limit/auth settings aligned with upstream webhook provider behavior.

## Rollback notes
- Roll back to previous gateway image tag if webhook acceptance/errors regress.
- During rollback, keep queue and DB schema backward-compatible (avoid mixing incompatible migration state).
- Validate `/healthz`, `/readyz`, and signed webhook acceptance after rollback.
