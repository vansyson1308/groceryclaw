#!/bin/sh
# Start worker in background (processes BullMQ jobs)
node apps/worker/dist/index.js &

# Start gateway in foreground (PID 1, handles signals)
exec node apps/gateway/dist/server.js
