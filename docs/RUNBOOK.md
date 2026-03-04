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

## V2 Ship-Ready Incident Playbooks

### 1) Webhook auth failures spike
Symptoms:
- sudden rise in `webhook_auth_fail`
- high 401/403 at `/webhooks/zalo`

Actions:
1. Verify signature/token configuration and rollout changes.
2. Confirm Gateway is only public ingress and no rogue proxy headers.
3. If attack suspected, tighten allowlists and rotate webhook secrets.
4. If tenant impact rises, move cohort back to `legacy` with `canary_set_mode.ts`.

### 2) Queue backlog surge / job-start latency breach
Symptoms:
- queue lag p95 > 2s for 5+ minutes
- worker throughput below expected capacity model

Actions:
1. Scale workers +30% (min +1).
2. Reduce optional heavy features if needed.
3. Pause canary expansion.
4. If still degraded, rollback cohort to `legacy`.

### 3) Notifier storm / pending backlog growth
Symptoms:
- `pending_notifications` backlog climbing rapidly
- notifier failures or DLQ growth

Actions:
1. Check interaction-window enforcement and rate limiter flags.
2. Increase flush backoff / reduce notify concurrency.
3. If user-impacting, disable notifier feature flag temporarily.

### 4) Secret compromise (tenant credential leak risk)
Actions:
1. Revoke compromised secret version (`revoke_secret.ts --apply`).
2. Rotate new secret version via Admin API.
3. Audit affected jobs and rotate upstream provider credentials if required.
4. Ensure no plaintext secret appears in logs/audits.

### 5) KiotViet rate-limit storm (429)
Actions:
1. Reduce worker concurrency and increase backoff.
2. Keep ACK path healthy (async queue preserved).
3. Roll back impacted tenants to `legacy` if sustained.
4. Re-run rollback drill checklist and log timeline.
