# Deployment Guide (30-minute target)

## Environments

## Local (developer)
- Uses `docker compose` on a single machine.
- Good for import/testing workflows and migration validation.

## Production (minimum)
- Dedicated VM (or container host) with:
  - Docker + Compose plugin
  - Persistent volumes for Postgres and n8n data
  - HTTPS reverse proxy in front of n8n webhook endpoint
- Secrets injected via runtime env/secret manager (never from git).

## Required services
1. PostgreSQL (`postgres` service)
2. n8n (`n8n` service)

## Step-by-step deploy (docker compose)
1. Prepare env file:
   ```bash
   cp .env.example .env
   ```
2. Fill required values in `.env`:
   - Postgres credentials
   - Zalo/KiotViet/OpenAI secrets
   - security knobs (`WEBHOOK_REPLAY_WINDOW_SECONDS`, etc.)
3. Start services:
   ```bash
   docker compose up -d
   ```
4. Apply DB migrations:
   ```bash
   ./scripts/db_migrate.sh
   ```
5. (Optional) Seed sample FMCG data:
   ```bash
   ./scripts/import_global_fmcg_master.sh
   ```
6. Open n8n UI and import workflows from `n8n/workflows/*.json`.

## Workflow import + credentials setup
1. In n8n, import each workflow JSON from repository (`n8n/workflows`).
2. Configure Postgres credential and assign to all Postgres nodes.
3. Ensure HTTP nodes use env-backed secrets only.
4. Activate critical workflows in this order:
   1) `zalo_token_refresh`
   2) `kiotviet_product_sync`
   3) `zalo_webhook_receiver_v3`
   4) downstream flows (`invoice_*`, `mapping_*`, pricing, retention/ops)

## Health checklist
- Infrastructure:
  - `docker compose ps` shows `postgres` and `n8n` healthy/running.
- Database:
  - `./scripts/smoke_db.sh` passes.
  - `schema_migrations` contains expected migration files.
- Workflows:
  - `./scripts/validate_workflows.sh` passes.
  - manual test webhook returns 200 quickly.
  - token refresh workflow can run successfully.
- Security:
  - no real secrets in repo/workflow exports.
  - replay + signature checks enabled in webhook workflow.

## Verification commands
```bash
./scripts/validate_workflows.sh
./scripts/db_migrate.sh
./scripts/smoke_db.sh
```


## Related docs
- `docs/ops/WORKFLOW_IMPORT_ORDER.md`
- `docs/SMOKE_TESTS.md`
- `docs/ops/SECRETS.md`
- `docs/RUNBOOK.md`
