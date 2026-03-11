#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${DB_V2_BACKUP_DIR:-backups/v2}"
DB_URL="${DB_V2_BACKUP_URL:-${DATABASE_URL:-}}"
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
OUT_FILE="${1:-$BACKUP_DIR/v2_${TIMESTAMP}.dump}"

if [[ -z "$DB_URL" ]]; then
  echo "ERROR: DB_V2_BACKUP_URL or DATABASE_URL is required" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT_FILE")"

pg_dump \
  --dbname="$DB_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$OUT_FILE"

echo "backup_created=$OUT_FILE"
