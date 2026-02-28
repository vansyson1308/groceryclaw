# Release Checklist (Production-ish RC)

Use this before tagging or pilot rollout.

## 1) Secret scan + hygiene
- [ ] Run `./scripts/validate_workflows.sh`
- [ ] Confirm `.env` is not committed
- [ ] Confirm no real tokens/keys in docs/workflows

## 2) Smoke checks
- [ ] `./scripts/import_global_fmcg_master.sh --validate-only`
- [ ] `node --test src/logic/*.test.js`
- [ ] `./scripts/smoke_db.sh` (when Docker runtime available)
- [ ] Execute `docs/SMOKE_TESTS.md` scenarios

## 3) Webhook URL checklist (local/VPS)
- [ ] Local/ngrok: `N8N_WEBHOOK_BASE_URL=https://<ngrok>/`
- [ ] VPS/domain: `N8N_WEBHOOK_BASE_URL=https://<domain>/`
- [ ] Telegram webhook reachable and returns 200
- [ ] Zalo webhook remains active if Zalo channel is enabled

## 4) Operational readiness
- [ ] Backup script tested (`scripts/backup_postgres.sh`)
- [ ] Restore procedure reviewed (`docs/ops/BACKUP_RESTORE.md`)
- [ ] Retention workflow active with safe defaults
- [ ] Daily ops summary workflow active

## 5) Rollback checklist
- [ ] `git revert <release-commit>` planned
- [ ] `docker compose down -v` impact understood
- [ ] Test draft POs cleanup plan documented (KiotViet UI)
- [ ] Database restore dump available before release
