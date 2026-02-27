# KiotViet–Taphoa Automation (PRD v4)

This repository provides a production-ish workflow automation stack for grocery/retail operations using **n8n + PostgreSQL**, integrated with **Zalo OA**, **KiotViet Public API**, and optional **Vision parsing** for invoice images.

It supports end-to-end journeys from receiving supplier invoices in chat to creating purchase orders, handling unmapped products with 3-tier fallback, applying pricing alerts, and operating with basic monitoring, retention, and backup discipline.

## Architecture (high level)
- **n8n**: orchestration layer (webhook ingestion, parsing, mapping, PO creation, alerts, cleanup)
- **PostgreSQL**: durable app state (mappings, sessions, invoice logs, token store, ops metrics/events)
- **Zalo OA**: inbound webhook + outbound bot replies
- **KiotViet**: product sync, PO creation/finalization, pricing updates
- **Vision LLM**: image invoice extraction with confidence gating

See: `docs/ARCHITECTURE.md`.

## Quickstart (copy/paste)
### 1) Prerequisites
- Docker Engine + Docker Compose plugin
- Bash, Node.js (for local unit tests)

### 2) Clone and enter repo
```bash
git clone <your-fork-or-repo-url>
cd groceryclaw
```

### 3) Configure environment
```bash
cp .env.example .env
```
Edit `.env` and set required values:
- Postgres credentials
- `ZALO_APP_ID`, `ZALO_OA_SECRET`
- `KIOTVIET_CLIENT_ID`, `KIOTVIET_CLIENT_SECRET`, `KIOTVIET_RETAILER`
- `OPENAI_API_KEY` (for image flow)

### 4) Start runtime
```bash
docker compose up -d
```

### 5) Run DB migrations + seed
```bash
./scripts/db_migrate.sh
./scripts/import_global_fmcg_master.sh
```

### 6) Validate workflow exports + DB smoke
```bash
./scripts/validate_workflows.sh
./scripts/smoke_db.sh
```

### 7) Open n8n and import workflows
- Open: `http://localhost:5678`
- Import all workflow JSON files from `n8n/workflows/`
- Recommended import/activation sequence: `docs/ops/WORKFLOW_IMPORT_ORDER.md`

### 8) Configure n8n credentials
- Postgres credential for all Postgres nodes
- Ensure HTTP nodes use env-backed secrets only (no plaintext tokens in workflow JSON)

### 9) Execute smoke tests
Follow: `docs/SMOKE_TESTS.md`.

## First-run checklist (expected outcomes)
- `docker compose ps` shows `postgres` and `n8n` running.
- Migrations applied (`schema_migrations` populated).
- `global_fmcg_master` contains rows after seed import.
- Zalo webhook returns 200 quickly and blocks invalid signatures.
- XML path can produce parsed invoice and (with mapping) PO payload.
- Image path routes by confidence to normal flow or draft confirmation flow.
- `ops_events` receives monitoring entries.

## Common errors / where to look
- n8n workflow execution logs in UI
- Postgres tables: `invoice_log`, `ops_events`, `user_sessions`
- Docker logs:
  ```bash
  docker compose logs -f n8n postgres
  ```
- Operational playbook: `docs/RUNBOOK.md`

## Safety notes
- Never commit real secrets.
- Use `.env` locally; production secrets should come from secret manager/runtime env.
- Use `scripts/backup_postgres.sh` before risky operations.
