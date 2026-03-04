#!/usr/bin/env bash
set -euo pipefail

APP_USER="${APP_DB_USER:?set APP_DB_USER in infra/compose/v2/.env}"
APP_PASSWORD="${APP_DB_PASSWORD:?set APP_DB_PASSWORD in infra/compose/v2/.env}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_USER}') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '${APP_USER}', '${APP_PASSWORD}');
  ELSE
    EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', '${APP_USER}', '${APP_PASSWORD}');
  END IF;
END
\$\$;
SQL
