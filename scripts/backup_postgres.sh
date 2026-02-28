#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

OUTPUT_PATH="${1:-backups/postgres_$(date +%Y%m%d_%H%M%S).dump}"
mkdir -p "$(dirname "$OUTPUT_PATH")"

if ! command -v docker >/dev/null 2>&1; then
  echo "[backup_postgres] docker is required" >&2
  exit 1
fi

if ! docker compose ps postgres >/dev/null 2>&1; then
  echo "[backup_postgres] postgres service not running. Start with: docker compose up -d postgres" >&2
  exit 1
fi

echo "[backup_postgres] creating backup at $OUTPUT_PATH"
docker compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-app_user}" \
  -d "${POSTGRES_DB:-kiotviet_taphoa}" \
  -Fc > "$OUTPUT_PATH"

echo "[backup_postgres] done"
