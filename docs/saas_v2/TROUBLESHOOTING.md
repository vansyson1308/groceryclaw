# V2 Troubleshooting (Operator-Friendly)

This guide is for local Docker runs and single-VPS deployments.

## Quick triage (copy/paste)

```bash
make v2-up
make v2-smoke
make v2-down
```

If `make v2-smoke` fails, use the sections below.

## 1) Port 8080 already in use

**Symptom**
- `gateway` container fails to start.
- Docker error mentions `0.0.0.0:8080` is already allocated.

**Fix**
```bash
# Linux/macOS
lsof -i :8080
# then stop the process OR choose another GATEWAY_PORT in infra/compose/v2/.env
```

## 2) Docker daemon not running

**Symptom**
- `docker compose` commands fail immediately.

**Fix**
- Start Docker Desktop (Windows/macOS) or Docker service (Linux).
- Re-run:
```bash
make v2-up
```

## 3) Migration fails

**Symptom**
- `npm run db:v2:migrate` exits non-zero.

**Fix sequence**
```bash
make v2-down
make v2-reset
make v2-up
npm run db:v2:migrate
```

If still failing, check logs:
```bash
docker compose --env-file infra/compose/v2/.env -f infra/compose/v2/docker-compose.yml logs postgres --tail=200
```

## 4) Webhook returns 401/403

**Symptom**
- POST `/webhooks/zalo` gets `401 unauthorized` or `403 forbidden`.

**Why**
- Signature mismatch (`mode1`) or wrong token (`mode2`).

**Fix**
- Ensure request is signed with `WEBHOOK_SIGNATURE_SECRET` from `infra/compose/v2/.env`.
- Keep `WEBHOOK_VERIFY_MODE=mode1` for production-like behavior.
- For local fallback tests only, `mode2` needs correct token header/value.

## 5) Queue length stays zero after webhook

**Symptom**
- Health endpoint is OK, webhook returns accepted, but no queued jobs.

**Checks**
```bash
docker compose --env-file infra/compose/v2/.env -f infra/compose/v2/docker-compose.yml logs gateway --tail=200

docker compose --env-file infra/compose/v2/.env -f infra/compose/v2/docker-compose.yml exec -T redis \
  redis-cli -a "${REDIS_PASSWORD:-redis_dev_password}" LLEN bull:process-inbound:wait
```

**Fix**
- Confirm Redis is healthy.
- Confirm `GATEWAY_QUEUE_CMD` points to Redis in compose env.

## 6) Admin endpoints unreachable from host

This is expected by design.
- Admin is private in compose (no host port published).
- Use internal/VPN/private access only.

## 7) Backup/restore tools fail

**Symptom**
- `db:v2:backup` or `db:v2:restore` command not found or SQL errors.

**Fix**
- Install required binaries: `pg_dump`, `pg_restore`, `psql`.
- Ensure `DB_V2_BACKUP_URL` / `DB_V2_RESTORE_URL` is valid.
- Re-run with the same DB version family where possible.

## 8) Still stuck? collect logs for incident response

```bash
docker compose --env-file infra/compose/v2/.env -f infra/compose/v2/docker-compose.yml ps
docker compose --env-file infra/compose/v2/.env -f infra/compose/v2/docker-compose.yml logs --tail=300 > v2-debug.log
```

Then follow:
- `docs/saas_v2/RUNBOOK.md`
- `docs/saas_v2/SECURITY_CHECKLIST.md`
- `docs/saas_v2/RELEASE_CHECKLIST.md`
