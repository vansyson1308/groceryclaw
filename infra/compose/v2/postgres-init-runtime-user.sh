#!/usr/bin/env sh
set -euo pipefail

APP_USER="${APP_DB_USER:?set APP_DB_USER in infra/compose/v2/.env}"
APP_PASSWORD="${APP_DB_PASSWORD:?set APP_DB_PASSWORD in infra/compose/v2/.env}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$APP_USER') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '$APP_USER', '$APP_PASSWORD');
  ELSE
    EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', '$APP_USER', '$APP_PASSWORD');
  END IF;

  -- admin_reader: used by admin service when DB_ADMIN_URL is set
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_reader') THEN
    EXECUTE format('CREATE ROLE admin_reader LOGIN PASSWORD %L', '$APP_PASSWORD');
  ELSE
    EXECUTE format('ALTER ROLE admin_reader LOGIN PASSWORD %L', '$APP_PASSWORD');
  END IF;
END
\$\$;"
