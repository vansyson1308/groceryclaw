# PostgreSQL Backup & Restore

## Scripts
- `scripts/backup_postgres.sh`
- `scripts/restore_postgres.sh`

## Backup
```bash
./scripts/backup_postgres.sh
# or custom path
./scripts/backup_postgres.sh backups/pre_release.dump
```

Behavior:
- Runs `pg_dump -Fc` inside `postgres` container.
- Writes dump file to host path.

## Restore
```bash
./scripts/restore_postgres.sh --yes backups/pre_release.dump
```

Behavior:
- Terminates active DB connections.
- Drops and recreates target DB.
- Restores from dump via `pg_restore`.

## Safety notes
- Restore is destructive to target DB content.
- Always take a fresh backup before restore.
- Re-run `./scripts/smoke_db.sh` after restore.
