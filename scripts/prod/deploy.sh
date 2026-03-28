#!/usr/bin/env bash
set -euo pipefail

# ==============================================================
# GroceryClaw Production Deploy Script
# Idempotent — safe to re-run on every deploy.
#
# Usage: bash scripts/prod/deploy.sh
# ==============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_DIR="$PROJECT_ROOT/infra/compose/v2"
ENV_FILE="$COMPOSE_DIR/.env.prod"

DC="docker compose -f $COMPOSE_DIR/docker-compose.yml -f $COMPOSE_DIR/docker-compose.prod.yml --env-file $ENV_FILE"

echo "==> GroceryClaw Production Deploy"
echo "    Project: $PROJECT_ROOT"

# --- Pre-checks ---
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found."
  echo "Copy .env.prod.example to .env.prod and fill all values."
  exit 1
fi

# --- Pull latest code ---
echo "==> Pulling latest code..."
cd "$PROJECT_ROOT"
git pull --ff-only origin main || echo "WARNING: git pull failed (maybe not a git repo or dirty state)"

# --- Build and start containers ---
echo "==> Building and starting containers..."
$DC up -d --build --remove-orphans

# --- Wait for postgres to be healthy ---
echo "==> Waiting for PostgreSQL to be healthy..."
for i in $(seq 1 30); do
  if $DC exec -T postgres pg_isready -U "$($DC exec -T postgres printenv POSTGRES_USER 2>/dev/null || echo postgres)" > /dev/null 2>&1; then
    echo "    PostgreSQL: ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "    ERROR: PostgreSQL not ready after 30 attempts"
    $DC logs postgres | tail -20
    exit 1
  fi
  sleep 2
done

# --- Run database migrations inside gateway container ---
echo "==> Running database migrations..."
$DC exec -T gateway node scripts/v2/remote_migrate.mjs || {
  echo "WARNING: Migration failed — check logs above."
}

# --- Health check ---
echo "==> Waiting 10s for services to stabilize..."
sleep 10

GATEWAY_PORT=$(grep '^GATEWAY_HOST_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo "8081")
GATEWAY_PORT="${GATEWAY_PORT:-8081}"

echo "==> Health check: http://127.0.0.1:${GATEWAY_PORT}/healthz"
if curl -sf "http://127.0.0.1:${GATEWAY_PORT}/healthz" > /dev/null 2>&1; then
  echo "    Gateway: OK"
else
  echo "    Gateway: FAILED — check logs:"
  $DC logs gateway | tail -20
fi

# --- Status ---
echo ""
echo "==> Container status:"
$DC ps

echo ""
echo "==> Deploy complete."
echo "    View logs: $DC logs -f"
