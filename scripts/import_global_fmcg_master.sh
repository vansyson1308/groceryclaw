#!/usr/bin/env bash
set -euo pipefail

# Import CSV seed data into global_fmcg_master using docker compose postgres service.
#
# Usage:
#   ./scripts/import_global_fmcg_master.sh
#   ./scripts/import_global_fmcg_master.sh data/global_fmcg_master_sample.csv
#   ./scripts/import_global_fmcg_master.sh --validate-only
#
# Upsert strategy:
#   ON CONFLICT (barcode) DO UPDATE
# This makes the script safe to rerun and lets corrected seed rows refresh existing values.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CSV_FILE="${1:-data/global_fmcg_master_sample.csv}"
VALIDATE_ONLY="false"
if [[ "${1:-}" == "--validate-only" ]]; then
  VALIDATE_ONLY="true"
  CSV_FILE="data/global_fmcg_master_sample.csv"
fi

EXPECTED_HEADER="barcode,standard_name,brand,category,supplier_unit,pos_unit,default_conversion_rate"

if [[ ! -f "$CSV_FILE" ]]; then
  echo "[import_global_fmcg_master] CSV not found: $CSV_FILE"
  exit 1
fi

header_line="$(head -n 1 "$CSV_FILE" | tr -d '\r')"
if [[ "$header_line" != "$EXPECTED_HEADER" ]]; then
  echo "[import_global_fmcg_master] Invalid CSV header."
  echo "Expected: $EXPECTED_HEADER"
  echo "Actual:   $header_line"
  exit 1
fi

echo "[import_global_fmcg_master] CSV header validated."

if [[ "$VALIDATE_ONLY" == "true" ]]; then
  row_count="$(( $(wc -l < "$CSV_FILE") - 1 ))"
  echo "[import_global_fmcg_master] validate-only mode: rows=$row_count"
  exit 0
fi

if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[import_global_fmcg_master] docker command not found"
  exit 1
fi

docker compose ps postgres >/dev/null

table_exists=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-app_user}" -d "${POSTGRES_DB:-kiotviet_taphoa}" -tAc "SELECT to_regclass('public.global_fmcg_master') IS NOT NULL")
if [[ "$table_exists" != "t" ]]; then
  echo "[import_global_fmcg_master] Table global_fmcg_master does not exist. Run migrations first."
  exit 1
fi

TMP_PATH="/tmp/global_fmcg_master_seed.csv"
docker compose cp "$CSV_FILE" "postgres:$TMP_PATH" >/dev/null

SQL=$(cat <<'SQL'
BEGIN;
CREATE TEMP TABLE global_fmcg_master_stage (
  barcode VARCHAR(50),
  standard_name VARCHAR(500),
  brand VARCHAR(100),
  category VARCHAR(100),
  supplier_unit VARCHAR(50),
  pos_unit VARCHAR(50),
  default_conversion_rate INT
);

COPY global_fmcg_master_stage (barcode, standard_name, brand, category, supplier_unit, pos_unit, default_conversion_rate)
FROM '/tmp/global_fmcg_master_seed.csv' WITH (FORMAT csv, HEADER true);

INSERT INTO global_fmcg_master (barcode, standard_name, brand, category, supplier_unit, pos_unit, default_conversion_rate)
SELECT barcode, standard_name, brand, category, supplier_unit, pos_unit, COALESCE(default_conversion_rate, 1)
FROM global_fmcg_master_stage
ON CONFLICT (barcode) DO UPDATE
SET standard_name = EXCLUDED.standard_name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    supplier_unit = EXCLUDED.supplier_unit,
    pos_unit = EXCLUDED.pos_unit,
    default_conversion_rate = EXCLUDED.default_conversion_rate;
COMMIT;
SQL
)

docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-app_user}" -d "${POSTGRES_DB:-kiotviet_taphoa}" -c "$SQL"
docker compose exec -T postgres rm -f "$TMP_PATH" >/dev/null || true

count=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-app_user}" -d "${POSTGRES_DB:-kiotviet_taphoa}" -tAc "SELECT COUNT(*) FROM global_fmcg_master")
echo "[import_global_fmcg_master] Import completed. global_fmcg_master rows=$count"
