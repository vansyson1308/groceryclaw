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

## ShopVoice simulator (`apps/alexa-sim`)

The full annotated list is in `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `SIM_BRAIN` | `claude` if `ANTHROPIC_API_KEY` is set, else `rules` | `claude` (Anthropic API), `rules` (offline), or `bedrock` (implemented, not deployed: AWS account unavailable; untested). |
| `ANTHROPIC_API_KEY` | none | **Secret.** Key for the Claude brain. Set a spend limit in the Anthropic Console. |
| `CLAUDE_MODEL` | `sonnet` | `sonnet` → `claude-sonnet-5-5` (low effort), `haiku` → `claude-haiku-4-5-20251001`. Opus models are refused at start-up. |
| `CLAUDE_EFFORT` / `CLAUDE_MAX_TOKENS` | `low` / `2048` | Sonnet effort and the per-call output cap. |
| `CLAUDE_DAILY_TURN_CAP` / `CLAUDE_DAILY_BUDGET_USD` | `400` / `1` | Per-UTC-day limits. Past either, turns use the rules brain and the UI shows an "offline brain" badge. |
| `SIM_TURN_DEADLINE_MS` | `8000` | Claude's share of one turn. After it, the rules brain answers. |
| `SIM_MCP_URL` or `SIM_MCP_HOSTPORT` | `http://127.0.0.1:8090/mcp` | MCP endpoint the simulator calls; `SIM_MCP_HOSTPORT` is for Render's private network. |
| `SIM_PUBLIC_MCP_URL` | `SIM_MCP_URL` | MCP URL shown on the page. |
| `SIM_MCP_TOKEN` | `MCP_DEMO_TOKEN` | **Secret.** The simulator's bearer token for the demo tenant. |
| `SIM_TURNS_PER_MINUTE` / `SIM_GLOBAL_TURNS_PER_MINUTE` | `20` / `60` | Per-viewer and global turn rate limits. |
| `SIM_TRUST_PROXY` | `0` | Trusted proxy hops for the viewer IP (Render: `2`). |
| `SIM_ACCESS_CODE` | empty | Optional passcode for `/api/*`. Empty means open, rate limits still apply. |

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
