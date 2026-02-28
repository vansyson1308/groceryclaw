# GroceryClaw — Ultra-Detailed Beginner Guide (Windows + Telegram + ngrok)

> If you can copy/paste commands in Windows and follow steps slowly, you can run this project.
> This README is the **main source of truth** for setup. Deeper docs are linked where needed.

---

## A) What is GroceryClaw? (1-minute explanation)

GroceryClaw is an automation system for shop owners and operators.
It receives invoices from chat (Telegram now, Zalo also supported), parses invoice lines (XML or image AI), maps items to KiotViet products, and helps create purchase orders.

Think of it like this:
1. You send invoice data.
2. Bot + workflows process it.
3. Results are saved in a database.
4. KiotViet actions are triggered safely (with confirmation flows when confidence is low).

This repo includes:
- n8n workflows (the automation logic)
- PostgreSQL schema + migrations
- scripts for setup, validation, backup/restore
- docs for deployment/security/operations

---

## B) Architecture (ASCII)

```text
                    ┌───────────────────────────────┐
                    │        Telegram / Zalo        │
                    │  (text, photo, XML document)  │
                    └───────────────┬───────────────┘
                                    │ webhook/update
                                    ▼
                         ┌────────────────────┐
                         │        n8n         │
                         │ ingress + routers  │
                         │ parse + mapping    │
                         │ PO + pricing + ops │
                         └───────┬─────┬──────┘
                                 │     │
                     SQL read/write     │ HTTP APIs
                                 │     │
                                 ▼     ▼
                      ┌──────────────────────┐
                      │      PostgreSQL      │
                      │ invoice_log, mapping │
                      │ sessions, ops_events │
                      └──────────────────────┘
                                       │
                                       ▼
                 ┌──────────────────────────────────────┐
                 │ External Services                    │
                 │ - KiotViet Public API               │
                 │ - OpenAI Vision (image extraction)  │
                 └──────────────────────────────────────┘
```

---

## C) Prerequisites (Windows 10/11)

### Required software
1. **Git for Windows**
2. **Docker Desktop** (with WSL2 backend enabled)
3. **WSL Ubuntu** (recommended shell environment)
4. **ngrok account + ngrok CLI** (for public HTTPS webhook in local dev)

### Why WSL?
This repository scripts are Bash (`.sh`) and run easiest in Ubuntu WSL.

### You should see this
- Docker Desktop is running.
- In WSL terminal, `docker --version` prints a version.
- In WSL terminal, `git --version` prints a version.

---

## D) Install steps (copy/paste)

> All commands below run in **WSL Ubuntu terminal** (not PowerShell).

### 1) Clone repository
```bash
git clone <YOUR_REPO_URL>
cd groceryclaw
```

### 2) Create `.env` from template
```bash
cp .env.example .env
```

Now edit `.env` using nano:
```bash
nano .env
```
Save: `Ctrl+O`, Enter. Exit: `Ctrl+X`.

### 3) Plain-language explanation of `.env` keys
- `POSTGRES_DB` = database name (keep default)
- `POSTGRES_USER` = database username (keep default locally)
- `POSTGRES_PASSWORD` = database password (**change from default**)
- `N8N_PORT` = n8n UI port (default 5678)
- `N8N_WEBHOOK_BASE_URL` = public base URL for webhook callbacks (important for Telegram/ngrok)
- `ZALO_*` = Zalo integration keys (for later when enabling Zalo)
- `KIOTVIET_CLIENT_ID` = KiotViet API client id
- `KIOTVIET_CLIENT_SECRET` = KiotViet API client secret
- `KIOTVIET_RETAILER` = your retailer identifier/name in KiotViet API
- `OPENAI_API_KEY` = key for image invoice vision parsing
- `TELEGRAM_BOT_TOKEN` = token from BotFather
- `WEBHOOK_REPLAY_WINDOW_SECONDS` = anti-replay window for webhook security
- `INVOICE_PARSED_DATA_RETENTION_DAYS` = redaction retention for parsed payloads
- `OPS_EVENTS_RETENTION_DAYS` = retention for operational logs

### 4) Start services
```bash
docker compose up -d
```

### 5) Run migrations + seed + smoke
```bash
./scripts/db_migrate.sh
./scripts/import_global_fmcg_master.sh
./scripts/smoke_db.sh
./scripts/validate_workflows.sh
```

### You should see this
- `docker compose ps` shows `postgres` and `n8n` as running.
- migration script prints applied/skipped migration files.
- seed script reports imported row count.
- smoke script says all checks passed.

---

## E) ngrok setup (default local Telegram path)

### Why ngrok is needed
Telegram must call a **public HTTPS URL**.
Your local `http://localhost:5678` is private, so Telegram cannot reach it directly.
ngrok gives you a temporary public HTTPS URL that forwards to local n8n.

### 1) Start ngrok
```bash
ngrok http 5678
```

Copy the HTTPS URL (example: `https://abcd-12-34-56-78.ngrok-free.app`).

### 2) Put ngrok URL into `.env`
Set:
```env
N8N_WEBHOOK_BASE_URL=https://YOUR-NGROK-URL/
```
(Important: keep trailing slash `/`)

### 3) Restart containers
```bash
docker compose down
docker compose up -d
```

### You should see this
- ngrok shows active forwarding to `http://localhost:5678`.
- n8n is still reachable at `http://localhost:5678`.

---

## F) Telegram bot setup (BotFather)

### 1) Create bot
1. Open Telegram app.
2. Search `@BotFather`.
3. Send command: `/newbot`.
4. Follow prompts for bot name and username.
5. BotFather gives you a token.

### 2) Where to put token
Put token in `.env`:
```env
TELEGRAM_BOT_TOKEN=123456:ABCDEF...
```

### IMPORTANT safety rule
- Never commit real token into git.
- Never paste token inside workflow JSON files.
- Use `.env` + n8n credentials only.

---

## G) Import workflows into n8n (step-by-step)

Open n8n UI: `http://localhost:5678`

### 1) Import order
Use this exact order document:
- `docs/ops/WORKFLOW_IMPORT_ORDER.md`

### 2) Import files
In n8n: **Workflows → Import from File**
Import from `n8n/workflows/*.json` following import order.

### 3) Configure Postgres credential in n8n
When a Postgres node asks for credential:
- Host: `postgres`  (**not** localhost)
- Port: `5432`
- Database: value from `.env` (`POSTGRES_DB`)
- User: value from `.env` (`POSTGRES_USER`)
- Password: value from `.env` (`POSTGRES_PASSWORD`)

### 4) Configure OpenAI credential (if using image flow)
Use your OpenAI API key.

### 5) Activate Telegram ingress
Activate workflow: `telegram_ingress_router`.

### 6) (Optional) Activate other schedules carefully
Activate in order; start with token refresh/product sync before higher-level business flows.

### You should see this
- Imported workflows show no missing node errors.
- Telegram ingress workflow can be activated successfully.

---

## H) Smoke tests (quick checks + expected outcomes)

Detailed version: `docs/SMOKE_TESTS.md`

### 1) DB ready check
```bash
./scripts/smoke_db.sh
```
Expected: table counts and “all checks passed”.

### 2) Telegram text message
- Send text to your bot.
Expected:
- n8n execution appears in `telegram_ingress_router`
- `ops_events` row with Telegram ingress info.

### 3) Telegram photo
- Send a clear invoice photo.
Expected:
- image parse flow triggered
- `invoice_log` written with Telegram source type/url
- may route to Draft flow if confidence is low.

### 4) XML path (if used)
- Send XML as document.
Expected:
- XML parse normalization runs
- parsed invoice stored in `invoice_log`.

### 5) Pricing alert (optional)
Expected:
- price rule evaluation and decision path (confirm/keep/custom) works when prerequisites are met.

---

## I) Getting KiotViet credentials (plain explanation)

You need 3 values:
1. `KIOTVIET_CLIENT_ID` — app identifier for KiotViet API.
2. `KIOTVIET_CLIENT_SECRET` — app secret (private password-like value).
3. `KIOTVIET_RETAILER` — your retailer code/name used in KiotViet API requests.

### General steps
1. Login to KiotViet developer/API area.
2. Create/register API application.
3. Copy client ID + secret.
4. Identify retailer value used by API docs.
5. Put values into `.env`.

### Official docs
- KiotViet API docs: https://developers.kiotviet.vn/

### Test product sync
Run `kiotviet_product_sync` workflow manually in n8n.
Expected: product cache rows updated in DB.

---

## J) Troubleshooting (common errors)

### 1) Telegram webhook HTTPS error
Symptoms:
- Telegram bot not triggering n8n.
Fix:
- ngrok must be running.
- `N8N_WEBHOOK_BASE_URL` must be HTTPS ngrok URL with trailing slash.
- restart `docker compose up -d` after changing `.env`.

### 2) n8n cannot connect Postgres
Symptoms:
- Postgres nodes fail connection.
Fix:
- In n8n credential host, use `postgres` (container name), **not** `localhost`.
- verify DB user/password/database match `.env`.

### 3) OpenAI Vision invalid JSON
Symptoms:
- image parse fails validation.
Fix:
- retry with clearer invoice photo.
- check OpenAI key/model config.
- low confidence should go to Draft/needs_review path.

### 4) KiotViet 401/403
Symptoms:
- KiotViet HTTP nodes unauthorized.
Fix:
- check `KIOTVIET_CLIENT_ID/SECRET/RETAILER` values.
- verify account/app permission scope.
- rerun token fetch node/workflow.

More operations playbook: `docs/RUNBOOK.md`

---

## K) Safety notes (must read)

1. **DO NOT commit `.env`**.
2. Workflow exports must be secret-free (`./scripts/validate_workflows.sh`).
3. Do not persist Telegram tokenized file URLs; store `file_id`-based references only.
4. Backup before risky operations:
   ```bash
   ./scripts/backup_postgres.sh
   ```

Security details: `docs/SECURITY.md` and `docs/ops/SECRETS.md`

---

## L) Switching to Zalo later (high-level)

Telegram and Zalo can co-exist.

- Keep existing Zalo workflows intact (`zalo_webhook_receiver_v3` etc.).
- Keep channel-specific ingress, but route into shared core parse/mapping/PO flows.
- Use channel-aware identity linking (`tenant_links`, channel sender/msg fields) to map users/tenants cleanly.

See:
- `docs/workflows/ZALO_WEBHOOK_V3.md`
- `docs/workflows/TELEGRAM_INGRESS.md`

---

## Optional: VPS (domain) path (instead of ngrok)

If you move from local to VPS:
1. Deploy same stack with Docker Compose on VPS.
2. Configure real domain + HTTPS reverse proxy.
3. Set `N8N_WEBHOOK_BASE_URL=https://your-domain/`.
4. Reconfigure Telegram/Zalo webhooks to the domain URL.

Deployment details:
- `docs/DEPLOYMENT.md`

---


## One-command checklist (WSL copy/paste)

Run these in WSL after editing `.env`:

```bash
docker compose up -d
./scripts/db_migrate.sh
./scripts/import_global_fmcg_master.sh
./scripts/validate_workflows.sh
./scripts/smoke_db.sh
```

Then:
1. Import workflows in n8n (see `docs/ops/WORKFLOW_IMPORT_ORDER.md`)
2. Run smoke tests (`docs/SMOKE_TESTS.md`)

## Extra docs map
- Architecture: `docs/ARCHITECTURE.md`
- Deployment: `docs/DEPLOYMENT.md`
- Local smoke tests: `docs/SMOKE_TESTS.md`
- Workflow import order: `docs/ops/WORKFLOW_IMPORT_ORDER.md`
- Runbook: `docs/RUNBOOK.md`
- Security: `docs/SECURITY.md`
- Secrets handling: `docs/ops/SECRETS.md`
