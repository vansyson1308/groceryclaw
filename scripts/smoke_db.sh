#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "[smoke_db] docker is required" >&2
  exit 1
fi

if ! docker compose ps postgres >/dev/null 2>&1; then
  echo "[smoke_db] postgres service not running. Start with: docker compose up -d postgres" >&2
  exit 1
fi

required_tables=(
  global_fmcg_master
  mapping_dictionary
  pricing_rules
  user_sessions
  invoice_log
  kiotviet_product_cache
  zalo_token_store
)

for table in "${required_tables[@]}"; do
  exists=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-app_user}" -d "${POSTGRES_DB:-kiotviet_taphoa}" -tAc \
    "SELECT to_regclass('public.${table}') IS NOT NULL")

  if [[ "$exists" != "t" ]]; then
    echo "[smoke_db] missing table: ${table}"
    exit 1
  fi

  count=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-app_user}" -d "${POSTGRES_DB:-kiotviet_taphoa}" -tAc \
    "SELECT COUNT(*) FROM ${table}")
  echo "[smoke_db] ${table}: count=${count}"
done

fts_index=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-app_user}" -d "${POSTGRES_DB:-kiotviet_taphoa}" -tAc \
  "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='global_fmcg_master' AND indexname='idx_global_fmcg_name'")

if [[ "$fts_index" != "idx_global_fmcg_name" ]]; then
  echo "[smoke_db] missing full-text index idx_global_fmcg_name"
  exit 1
fi

echo "[smoke_db] all checks passed"
