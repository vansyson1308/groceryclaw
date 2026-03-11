# Secrets Inventory Template (DevOps Fill-in)

> Template only. Do not commit real secret values.

| Secret key | Service(s) | Environment | Owner | Rotation policy | Last rotated | Source system (vault/secret manager) | Notes |
|---|---|---|---|---|---|---|---|
| DB_APP_URL | gateway,worker | staging | `<owner>` | `<policy>` | `<date>` | `<system>` | |
| DB_ADMIN_URL | admin,migrate | staging | `<owner>` | `<policy>` | `<date>` | `<system>` | |
| REDIS_URL | gateway,admin,worker | staging | `<owner>` | `<policy>` | `<date>` | `<system>` | |
| WEBHOOK_SIGNATURE_SECRET | gateway | staging | `<owner>` | `<policy>` | `<date>` | `<system>` | |
| ADMIN_OIDC_ISSUER | admin | staging | `<owner>` | `<policy>` | `<date>` | `<system>` | |
| ADMIN_OIDC_AUDIENCE | admin | staging | `<owner>` | `<policy>` | `<date>` | `<system>` | |
| ADMIN_OIDC_JWKS_URI | admin | staging | `<owner>` | `<policy>` | `<date>` | `<system>` | |
| INVITE_PEPPER_B64 | gateway,admin | staging | `<owner>` | `<policy>` | `<date>` | `<system>` | |
| ADMIN_MEK_B64 | admin | staging | `<owner>` | `<policy>` | `<date>` | `<system>` | |
| WORKER_MEK_B64 | worker | staging | `<owner>` | `<policy>` | `<date>` | `<system>` | |

Repeat rows for production environment.
