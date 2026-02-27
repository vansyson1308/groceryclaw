# Operational Runbook

## Stop the bleeding (first actions)
1. In n8n, **deactivate schedule workflows** first:
   - `zalo_token_refresh`
   - `kiotviet_product_sync`
   - `daily_ops_summary`
   - `data_retention_cleanup`
2. Temporarily disable ingress processing:
   - deactivate `zalo_webhook_receiver_v3` (or gate with maintenance mode upstream).
3. Preserve evidence:
   - export recent executions
   - snapshot DB backup before major fixes (`scripts/backup_postgres.sh`).

## Incident: Zalo token refresh failing
Symptoms:
- message send failures from Zalo nodes
- refresh workflow logs errors

Steps:
1. Run `zalo_token_refresh` manually in n8n.
2. Validate env: `ZALO_APP_ID`, `ZALO_OA_SECRET`.
3. Check `zalo_token_store` active row/expiry.
4. If broken, rotate Zalo secret and re-run refresh.
5. Re-enable dependent workflows after success.

## Incident: KiotViet 429 storm
Symptoms:
- many `429`/`5xx` errors in KiotViet HTTP nodes
- backlog grows (`needs_mapping`/`draft`/failed)

Steps:
1. Pause high-frequency workflows (sync, bulk operations).
2. Reduce schedule frequency / batch size.
3. Verify retry/backoff paths.
4. Resume gradually and monitor `ops_events` + daily summary.

## Incident: Vision returns invalid JSON
Symptoms:
- image parse workflow fails schema validation
- increased `needs_review`/failed image parsing

Steps:
1. Inspect failed execution payload and model output.
2. Verify image URL validation and MIME/size preflight.
3. Route affected invoices to draft/manual confirmation flow.
4. Ask user to resend clearer image or XML invoice.

## Incident: DB migration mismatch
Symptoms:
- workflow DB queries fail with missing columns/tables
- migration script skips unexpectedly

Steps:
1. Check migration history:
   ```sql
   SELECT * FROM schema_migrations ORDER BY applied_at;
   ```
2. Re-run migrations:
   ```bash
   ./scripts/db_migrate.sh
   ```
3. If drift exists, restore from backup and re-apply in order.
4. Never hot-edit production schema manually without recording migration.


## Recovery helpers
- Backup DB: `./scripts/backup_postgres.sh`
- Restore DB (non-interactive): `./scripts/restore_postgres.sh --yes <dump-file>`
