# Admin deploy unit

## Purpose
Admin is the control-plane API for tenant/admin operations (tenant management, invite handling, secret rotation flows).

## Ownership boundary
- **Code path:** `apps/admin`
- **Dockerfile:** `apps/admin/Dockerfile`
- **Build context:** repository root (`.`)
- **Runtime command:** `node apps/admin/dist/server.js`

## Network exposure
- **Classification:** Private web service (default)
- **App port:** `3001` (`ADMIN_PORT`)
- **Metrics port:** `9101` (`ADMIN_METRICS_PORT`)
- **Service endpoints:**
  - `GET /healthz`
  - `GET /readyz`
  - `GET /admin/ping`
  - `GET /admin/ops-ping`
  - `POST/GET/PATCH /tenants...`
- **Metrics endpoint:** `GET /metrics` on metrics listener

### Exposure policy
- Default stance is **internal-only**.
- Optional public ingress is allowed only with explicit risk acceptance, IP allowlist, TLS, and OIDC controls.

## Dependencies
- **PostgreSQL:** required (`DB_ADMIN_URL`, with documented fallback behavior)
- **Redis:** required (`REDIS_URL`) for readiness/runtime dependencies
- **Shared package:** `@groceryclaw/common`

## Required auth/network expectations
- OIDC config must be set (`ADMIN_OIDC_*`) for normal operator access.
- Break-glass mode should be disabled unless incident-approved.
- If external ingress is enabled, enforce restricted source ranges and TLS.

## Required env groups
See `infra/deploy/admin/env.example` for a minimal deploy surface.

## Health/readiness expectations
- Liveness: `GET /healthz` returns 200 when process is alive.
- Readiness: `GET /readyz` validates DB/Redis reachability when `READYZ_STRICT=true`.

## Safe deploy notes
1. Keep admin private unless there is a formal access-control requirement.
2. Validate OIDC issuer/audience/JWKS before enabling operator access.
3. Roll out secrets endpoints only with MEK and audit logging expectations in place.

## Rollback notes
- Roll back to previous admin image tag if authz/authn regressions occur.
- Keep access path available via private network/port-forward during rollback.
- Re-verify `/readyz`, `/admin/ping`, and least-privilege role paths post-rollback.
