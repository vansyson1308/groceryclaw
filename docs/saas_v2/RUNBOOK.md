# V2 Ops Runbook (Reliability)

## DLQ inspection
```bash
node --experimental-strip-types scripts/dlq_list.ts \
  --tenant-id <tenant-id> \
  --status dead_letter \
  --limit 100
```

## DLQ replay (safe-by-default)
Dry-run (no mutation):
```bash
node scripts/dlq_replay.mjs \
  --tenant-id <tenant-id> \
  --job-ids <job1,job2>
```

Apply replay (requires queue+db commands configured):
```bash
node scripts/dlq_replay.mjs \
  --tenant-id <tenant-id> \
  --job-ids <job1,job2> \
  --apply
```

Safeguards:
- requires explicit tenant and explicit job IDs
- replays only `dead_letter` rows
- writes `admin_audit_logs` action `dlq_replay`

## V2 backup
```bash
DB_V2_BACKUP_URL="$DATABASE_URL" ./scripts/db_v2_backup.sh
```

## V2 restore + integrity checks
```bash
DB_V2_RESTORE_URL="$DATABASE_URL" ./scripts/db_v2_restore.sh --yes backups/v2/<dump>.dump
```

Restore performs:
- pg_restore with clean/if-exists
- row-count sanity checks (`tenants`, `jobs`, `inbound_events`)
- schema contract test (`npm run db:v2:contract`)

## Notes
- Backup/restore scripts require `pg_dump`, `pg_restore`, and `psql` binaries available in PATH.
- Do not print full DB URLs in shared logs.
- Prefer break-glass/admin role for replay operations.
- Combine with canary rollback runbook when incidents affect live tenants.
