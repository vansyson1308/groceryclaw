# Environment Mapping Sheet (to be filled by DevOps/Platform)

Use this sheet to map runtime variables per deployable unit. Fill placeholders only in platform secret/config systems, not in git.

## Gateway

| Variable | Purpose | Required | Owner | Source | Staging placeholder | Production placeholder | Notes |
|---|---|---|---|---|---|---|---|
| NODE_ENV | Runtime mode | Required | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | production recommended |
| LOG_LEVEL | Logging verbosity | Required | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | info default |
| GATEWAY_HOST | Bind host | Required | DevOps | Config | `<set_by_platform>` | `<set_by_platform>` | typically `0.0.0.0` |
| GATEWAY_PORT | App port | Required | DevOps | Config | `<set_by_platform>` | `<set_by_platform>` | expected `8080` |
| DB_APP_URL | App DB connection | Required | DevOps | Secret | `<staging_secret_ref>` | `<prod_secret_ref>` | private DB endpoint |
| REDIS_URL | Queue/cache connection | Required | DevOps | Secret | `<staging_secret_ref>` | `<prod_secret_ref>` | private Redis endpoint |
| BULLMQ_QUEUE_NAME | Queue name | Required | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | default `process-inbound` |
| WEBHOOK_SIGNATURE_SECRET | Webhook verification secret | Required | DevOps | Secret | `<staging_secret_ref>` | `<prod_secret_ref>` | do not commit value |
| WEBHOOK_VERIFY_MODE | Webhook auth mode | Required | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | mode1/mode2 |
| WEBHOOK_SIGNATURE_HEADERS | Signature header names | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | comma-separated |
| WEBHOOK_REPLAY_TTL_SECONDS | Replay protection TTL | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | numeric seconds |
| V2_GATEWAY_WEBHOOK_ENABLED | Enable webhook route | Required | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | true for live ingress |
| INVITE_PEPPER_B64 | Invite hashing pepper | Required | DevOps | Secret | `<staging_secret_ref>` | `<prod_secret_ref>` | base64 secret |
| GATEWAY_METRICS_HOST | Metrics bind host | Optional | DevOps | Config | `<set_by_platform>` | `<set_by_platform>` | internal only |
| GATEWAY_METRICS_PORT | Metrics port | Optional | DevOps | Config | `<set_by_platform>` | `<set_by_platform>` | expected `9100` |
| READYZ_STRICT | Dependency-aware readiness | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | true recommended |
| READYZ_TIMEOUT_MS | Readiness timeout | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | numeric |

## Admin

| Variable | Purpose | Required | Owner | Source | Staging placeholder | Production placeholder | Notes |
|---|---|---|---|---|---|---|---|
| NODE_ENV | Runtime mode | Required | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | production recommended |
| LOG_LEVEL | Logging verbosity | Required | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | info default |
| ADMIN_HOST | Bind host | Required | DevOps | Config | `<set_by_platform>` | `<set_by_platform>` | internal bind |
| ADMIN_PORT | App port | Required | DevOps | Config | `<set_by_platform>` | `<set_by_platform>` | expected `3001` |
| DB_ADMIN_URL | Admin DB connection | Required | DevOps | Secret | `<staging_secret_ref>` | `<prod_secret_ref>` | private DB endpoint |
| REDIS_URL | Redis connection | Required | DevOps | Secret | `<staging_secret_ref>` | `<prod_secret_ref>` | private Redis endpoint |
| ADMIN_ENABLED | Enable admin API | Required | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | true unless disabled intentionally |
| ADMIN_OIDC_ISSUER | OIDC issuer | Required | DevOps | Secret/Config | `<staging_secret_ref>` | `<prod_secret_ref>` | authn prerequisite |
| ADMIN_OIDC_AUDIENCE | OIDC audience | Required | DevOps | Secret/Config | `<staging_secret_ref>` | `<prod_secret_ref>` | authn prerequisite |
| ADMIN_OIDC_JWKS_URI | OIDC JWKS URI | Required | DevOps | Secret/Config | `<staging_secret_ref>` | `<prod_secret_ref>` | authn prerequisite |
| ADMIN_OIDC_ROLES_CLAIM | Roles claim key | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | default `roles` |
| ADMIN_BREAKGLASS_ENABLED | Emergency auth path | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | false recommended |
| ADMIN_BREAKGLASS_API_KEY | Emergency API key | Optional | DevOps | Secret | `<staging_secret_ref>` | `<prod_secret_ref>` | only if enabled |
| ADMIN_TENANT_ENDPOINTS_ENABLED | Tenant endpoints toggle | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | true by default |
| ADMIN_SECRETS_ENABLED | Secret endpoints toggle | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | true by default |
| INVITE_PEPPER_B64 | Invite hashing pepper | Required | DevOps | Secret | `<staging_secret_ref>` | `<prod_secret_ref>` | shared crypto material |
| ADMIN_MEK_B64 | Admin encryption key | Required | DevOps | Secret | `<staging_secret_ref>` | `<prod_secret_ref>` | base64 key |
| ADMIN_METRICS_HOST | Metrics bind host | Optional | DevOps | Config | `<set_by_platform>` | `<set_by_platform>` | internal only |
| ADMIN_METRICS_PORT | Metrics port | Optional | DevOps | Config | `<set_by_platform>` | `<set_by_platform>` | expected `9101` |
| READYZ_STRICT | Dependency-aware readiness | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | true recommended |
| READYZ_TIMEOUT_MS | Readiness timeout | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | numeric |

## Worker

| Variable | Purpose | Required | Owner | Source | Staging placeholder | Production placeholder | Notes |
|---|---|---|---|---|---|---|---|
| NODE_ENV | Runtime mode | Required | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | production recommended |
| LOG_LEVEL | Logging verbosity | Required | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | info default |
| WORKER_HOST | Health server bind host | Required | DevOps | Config | `<set_by_platform>` | `<set_by_platform>` | internal bind |
| WORKER_PORT | Worker health port | Required | DevOps | Config | `<set_by_platform>` | `<set_by_platform>` | expected `3002` |
| WORKER_HEALTH_PORT | Explicit health port | Optional | DevOps | Config | `<set_by_platform>` | `<set_by_platform>` | expected `3002` |
| WORKER_HEALTH_SERVER_ENABLED | Enable health server | Required | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | true recommended |
| DB_APP_URL | App DB connection | Required | DevOps | Secret | `<staging_secret_ref>` | `<prod_secret_ref>` | private DB endpoint |
| REDIS_URL | Queue/cache connection | Required | DevOps | Secret | `<staging_secret_ref>` | `<prod_secret_ref>` | private Redis endpoint |
| BULLMQ_QUEUE_NAME | Queue name | Required | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | keep aligned with gateway |
| WORKER_CONCURRENCY | Queue worker concurrency | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | tune per env |
| WORKER_XML_PARSE_ENABLED | XML parse feature flag | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | true by default |
| WORKER_MAPPING_ENABLED | Mapping feature flag | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | true by default |
| WORKER_KIOTVIET_SYNC_ENABLED | KiotViet sync flag | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | true by default |
| WORKER_NOTIFIER_ENABLED | Notifier flag | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | true by default |
| KIOTVIET_STUB_BASE_URL (or equivalent) | Upstream integration URL | Required | DevOps | Config/Secret | `<staging_value>` | `<production_value>` | replace stub naming as needed |
| KIOTVIET_STUB_TOKEN (or equivalent) | Upstream auth token | Required | DevOps | Secret | `<staging_secret_ref>` | `<prod_secret_ref>` | secret |
| ZALO_STUB_BASE_URL (or equivalent) | Upstream integration URL | Required | DevOps | Config/Secret | `<staging_value>` | `<production_value>` | replace stub naming as needed |
| ZALO_STUB_TOKEN (or equivalent) | Upstream auth token | Required | DevOps | Secret | `<staging_secret_ref>` | `<prod_secret_ref>` | secret |
| WORKER_MEK_B64 | Worker encryption key | Required | DevOps | Secret | `<staging_secret_ref>` | `<prod_secret_ref>` | base64 key |
| WORKER_METRICS_HOST | Metrics bind host | Optional | DevOps | Config | `<set_by_platform>` | `<set_by_platform>` | internal only |
| WORKER_METRICS_PORT | Metrics port | Optional | DevOps | Config | `<set_by_platform>` | `<set_by_platform>` | expected `9090` |
| READYZ_STRICT | Dependency-aware readiness | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | true recommended |
| READYZ_TIMEOUT_MS | Readiness timeout | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | numeric |

## Migration job (`db-v2-migrate`)

| Variable | Purpose | Required | Owner | Source | Staging placeholder | Production placeholder | Notes |
|---|---|---|---|---|---|---|---|
| DATABASE_URL | DB admin migration connection | Required | DevOps | Secret | `<staging_secret_ref>` | `<prod_secret_ref>` | maps to `DB_ADMIN_URL` secret |
| NODE_ENV | Runtime mode | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | production recommended |
| LOG_LEVEL | Migration logging level | Optional | Shared | Config | `<set_by_platform>` | `<set_by_platform>` | keep consistent with app logs |

---

## Fill-in ownership notes
- **Owner: DevOps/Platform** = set and rotate in secret/config management.
- **Owner: Shared** = app defaults exist but platform should explicitly set environment policy.
- **Owner: App** = provided by application defaults; override only when needed.

## Related references
- `infra/deploy/gateway/env.example`
- `infra/deploy/admin/env.example`
- `infra/deploy/worker/env.example`
- `docs/deployment/preflight-checklist.md`
- `docs/deployment/platform-handoff-checklist.md`
