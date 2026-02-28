# Onboarding (Local + Telegram)

This is a short companion to `README.md` for the default local path.

## Steps
1. `cp .env.example .env` and fill required keys.
2. `docker compose up -d`
3. `./scripts/db_migrate.sh`
4. `./scripts/import_global_fmcg_master.sh`
5. `./scripts/smoke_db.sh`
6. `./scripts/validate_workflows.sh`
7. Start ngrok: `ngrok http 5678`
8. Set `N8N_WEBHOOK_BASE_URL=https://<ngrok-url>/` in `.env`
9. Restart compose: `docker compose down && docker compose up -d`
10. Import workflows in order from `docs/ops/WORKFLOW_IMPORT_ORDER.md`
11. Configure Telegram bot token and activate `telegram_ingress_router`
12. Send Telegram text/photo/XML and verify execution logs.

For full beginner-friendly explanation, see `README.md`.
