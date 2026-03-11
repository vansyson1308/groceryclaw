#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--yes" ]]; then
  echo "Usage: $0 --yes <dump_file>" >&2
  exit 1
fi

DUMP_FILE="${2:-}"
if [[ -z "$DUMP_FILE" || ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: dump file is required and must exist" >&2
  exit 1
fi

DB_URL="${DB_V2_RESTORE_URL:-${DATABASE_URL:-}}"
if [[ -z "$DB_URL" ]]; then
  echo "ERROR: DB_V2_RESTORE_URL or DATABASE_URL is required" >&2
  exit 1
fi

pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="$DB_URL" \
  "$DUMP_FILE"

# integrity/sanity checks
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -t -A -f - <<'SQL'
SELECT 'tenants=' || count(*)::text FROM tenants;
SELECT 'jobs=' || count(*)::text FROM jobs;
SELECT 'inbound_events=' || count(*)::text FROM inbound_events;
SQL

DATABASE_URL="$DB_URL" npm run db:v2:contract

echo "restore_completed_from=$DUMP_FILE"
