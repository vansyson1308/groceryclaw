#!/bin/sh

# --- Run database migrations before starting services ---
# Uses pg Node.js client (no psql CLI dependency)
if [ -n "$DB_APP_URL" ] || [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] Running V2 database migrations..."
  node scripts/v2/remote_migrate.mjs
  if [ $? -ne 0 ]; then
    echo "[entrypoint] WARNING: Migration failed — check logs above. Starting services anyway."
  fi
else
  echo "[entrypoint] WARNING: No DB_APP_URL or DATABASE_URL set — skipping migrations."
fi

# Start worker in background (processes BullMQ jobs)
node apps/worker/dist/index.js &
WORKER_PID=$!

# Start gateway in foreground (PID 1, handles signals)
exec node apps/gateway/dist/server.js
