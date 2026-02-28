#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FORCE="false"
if [[ "${1:-}" == "--yes" ]]; then
  FORCE="true"
  shift
fi

DUMP_PATH="${1:-}"
if [[ -z "$DUMP_PATH" ]]; then
  echo "Usage: $0 [--yes] <path-to-dump-file>" >&2
  exit 1
fi
if [[ ! -f "$DUMP_PATH" ]]; then
  echo "[restore_postgres] dump file not found: $DUMP_PATH" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[restore_postgres] docker is required" >&2
  exit 1
fi

if ! docker compose ps postgres >/dev/null 2>&1; then
  echo "[restore_postgres] postgres service not running. Start with: docker compose up -d postgres" >&2
  exit 1
fi

DB_NAME="${POSTGRES_DB:-kiotviet_taphoa}"
DB_USER="${POSTGRES_USER:-app_user}"

if [[ "$FORCE" != "true" ]]; then
  read -r -p "[restore_postgres] This will overwrite database '$DB_NAME'. Continue? [y/N] " CONFIRM
  if [[ "${CONFIRM,,}" != "y" ]]; then
    echo "[restore_postgres] aborted"
    exit 1
  fi
fi

echo "[restore_postgres] terminating active connections"
docker compose exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();"

echo "[restore_postgres] recreating database"
docker compose exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 <<SQL
DROP DATABASE IF EXISTS ${DB_NAME};
CREATE DATABASE ${DB_NAME};
SQL

echo "[restore_postgres] restoring from $DUMP_PATH"
cat "$DUMP_PATH" | docker compose exec -T postgres pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges

echo "[restore_postgres] done"
