#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env && -f .env.example ]]; then
  echo "[db_migrate] .env not found, copying from .env.example"
  cp .env.example .env
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[db_migrate] docker command not found"
  exit 1
fi

if ! docker compose ps postgres >/dev/null 2>&1; then
  echo "[db_migrate] docker compose services are not running. Start with: docker compose up -d"
  exit 1
fi

MIGRATIONS_DIR="db/migrations"

docker compose exec -T postgres psql -U "${POSTGRES_USER:-app_user}" -d "${POSTGRES_DB:-kiotviet_taphoa}" <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT NOW()
);
SQL

for migration in $(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort); do
  version="$(basename "$migration")"
  applied=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-app_user}" -d "${POSTGRES_DB:-kiotviet_taphoa}" -tAc \
    "SELECT 1 FROM schema_migrations WHERE version='${version}'")

  if [[ "$applied" == "1" ]]; then
    echo "[db_migrate] skipping already applied: $version"
    continue
  fi

  echo "[db_migrate] applying: $version"
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-app_user}" -d "${POSTGRES_DB:-kiotviet_taphoa}" < "$migration"
  docker compose exec -T postgres psql -U "${POSTGRES_USER:-app_user}" -d "${POSTGRES_DB:-kiotviet_taphoa}" -c \
    "INSERT INTO schema_migrations(version) VALUES ('${version}')"
  echo "[db_migrate] applied: $version"
done

echo "[db_migrate] done"
