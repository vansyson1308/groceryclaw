# Environment Variables

This file lists required runtime variables from the technical PRD.

> Security note: never commit real values. Use placeholders locally and secret managers in production.

## Required Variables

| Variable | Required | Used For | Notes |
|---|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connectivity for n8n/query nodes | Standard connection URI. Use least-privilege DB user. |
| `ZALO_APP_ID` | Yes | Zalo OAuth refresh and signature context | Must match OA app settings. |
| `ZALO_OA_SECRET` | Yes | Webhook signature verification | Treat as secret; rotate if exposed. |
| `ZALO_OA_ACCESS_TOKEN` | Yes (bootstrap) | Sending OA messages | Short-lived (~25h). Should be refreshed via Phase 0.5 workflow and DB-backed token store. |
| `KIOTVIET_CLIENT_ID` | Yes | KiotViet OAuth client credentials | Secret configuration. |
| `KIOTVIET_CLIENT_SECRET` | Yes | KiotViet OAuth client credentials | Secret configuration. |
| `KIOTVIET_RETAILER` | Yes | KiotViet tenant/retailer context in API headers | Not always secret, but protect operationally. |
| `OPENAI_API_KEY` | Yes (if image flow enabled) | OpenAI Vision calls for image invoice parsing | Scope key minimally and set usage limits. |

## Optional / Derived Operational Values

| Variable | Purpose | Notes |
|---|---|---|
| `N8N_WEBHOOK_BASE_URL` | Public callback URL for Zalo webhook registration | Often ngrok in dev; real domain + HTTPS in prod. |
| `LOG_LEVEL` | Structured logging verbosity | Prefer `info` in production, `debug` only for short-lived troubleshooting. |

## Example Placeholder Block
```env
DATABASE_URL=postgresql://app_user:CHANGEME@postgres:5432/kiotviet_taphoa

ZALO_APP_ID=YOUR_ZALO_APP_ID
ZALO_OA_SECRET=YOUR_ZALO_OA_SECRET
ZALO_OA_ACCESS_TOKEN=BOOTSTRAP_ONLY_REFRESH_LATER

KIOTVIET_CLIENT_ID=YOUR_KIOTVIET_CLIENT_ID
KIOTVIET_CLIENT_SECRET=YOUR_KIOTVIET_CLIENT_SECRET
KIOTVIET_RETAILER=YOUR_RETAILER_NAME

OPENAI_API_KEY=YOUR_OPENAI_API_KEY

N8N_WEBHOOK_BASE_URL=https://your-public-webhook-domain.example
LOG_LEVEL=info
```

## Handling Guidance
- Keep `.env` out of git.
- Store production secrets in deployment secret manager.
- For Zalo token lifecycle, prefer DB token store (`zalo_token_store`) as source of truth after initial bootstrap.
