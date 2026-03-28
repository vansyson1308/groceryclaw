#!/usr/bin/env bash
set -euo pipefail

# ==============================================================
# GroceryClaw PostgreSQL Backup Script (via Docker)
#
# Cron example (daily at 3am):
#   0 3 * * * /opt/groceryclaw/scripts/prod/backup.sh >> /var/log/groceryclaw-backup.log 2>&1
# ==============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_DIR="$PROJECT_ROOT/infra/compose/v2"
ENV_FILE="$COMPOSE_DIR/.env.prod"

DC="docker compose -f $COMPOSE_DIR/docker-compose.yml -f $COMPOSE_DIR/docker-compose.prod.yml --env-file $ENV_FILE"

DB_NAME="${GC_DB_NAME:-groceryclaw_v2}"
BACKUP_DIR="${GC_BACKUP_DIR:-/opt/groceryclaw-backups}"
RETENTION_DAYS="${GC_BACKUP_RETENTION_DAYS:-14}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date -Iseconds)] Starting backup: $DB_NAME -> $BACKUP_FILE"

# Get superuser name from env
SUPER_USER=$(grep '^POSTGRES_SUPERUSER=' "$ENV_FILE" | cut -d= -f2-)
SUPER_USER="${SUPER_USER:-groceryclaw_super}"

# pg_dump via docker exec
$DC exec -T postgres pg_dump -U "$SUPER_USER" -d "$DB_NAME" --no-owner --no-privileges | gzip > "$BACKUP_FILE"

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$(date -Iseconds)] Backup complete: $BACKUP_SIZE"

# Clean old backups
DELETED=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date -Iseconds)] Cleaned $DELETED backup(s) older than $RETENTION_DAYS days"
fi

TOTAL=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" | wc -l)
echo "[$(date -Iseconds)] Total backups: $TOTAL"
