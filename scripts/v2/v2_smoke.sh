#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="infra/compose/v2/.env"
ENV_EXAMPLE="infra/compose/v2/.env.example"
COMPOSE_FILE="infra/compose/v2/docker-compose.yml"

for cmd in docker curl openssl rg; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
done

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "Created $ENV_FILE from $ENV_EXAMPLE"
fi

set -a
source "$ENV_FILE"
set +a

echo "[1/5] Ensure compose stack is running..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build >/dev/null

echo "[2/5] Apply V2 migrations..."
npm run -s db:v2:migrate

echo "[3/5] Health checks..."
health_body="$(curl -sS -w '\n%{http_code}' "http://127.0.0.1:${GATEWAY_PORT:-8080}/healthz")"
health_code="$(echo "$health_body" | tail -n1)"
health_json="$(echo "$health_body" | sed '$d')"
if [[ "$health_code" != "200" ]]; then
  echo "Gateway health check failed with HTTP $health_code"
  exit 1
fi

echo "$health_json" | rg -q '"status":"ok"'

ready_body="$(curl -sS -w '\n%{http_code}' "http://127.0.0.1:${GATEWAY_PORT:-8080}/readyz")"
ready_code="$(echo "$ready_body" | tail -n1)"
if [[ "$ready_code" != "200" ]]; then
  echo "Gateway readiness check failed with HTTP $ready_code"
  exit 1
fi

echo "[4/5] Send signed webhook fixture..."
tmp_payload="$(mktemp)"
node -e "const fs=require('node:fs');const payload=JSON.parse(fs.readFileSync('tests/fixtures/zalo_webhook_valid.json','utf8'));payload.zalo_msg_id='smoke-'+Date.now();fs.writeFileSync(process.argv[1], JSON.stringify(payload));" "$tmp_payload"

signature="$(openssl dgst -sha256 -hmac "${WEBHOOK_SIGNATURE_SECRET}" "$tmp_payload" | awk '{print $2}')"
webhook_body="$(curl -sS -w '\n%{http_code}' -X POST "http://127.0.0.1:${GATEWAY_PORT:-8080}/webhooks/zalo" \
  -H 'content-type: application/json' \
  -H "x-zalo-signature: ${signature}" \
  --data-binary "@$tmp_payload")"
rm -f "$tmp_payload"

webhook_code="$(echo "$webhook_body" | tail -n1)"
webhook_json="$(echo "$webhook_body" | sed '$d')"
if [[ "$webhook_code" != "200" ]]; then
  echo "Webhook smoke failed with HTTP $webhook_code"
  echo "$webhook_json"
  exit 1
fi

echo "$webhook_json" | rg -q '"status":"accepted"'

echo "[5/5] Verify queue received at least one job..."
queue_len="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T redis redis-cli -a "${REDIS_PASSWORD:-redis_dev_password}" LLEN bull:process-inbound:wait | tr -d '\r' | tail -n1)"
if ! [[ "$queue_len" =~ ^[0-9]+$ ]]; then
  echo "Could not read queue length"
  exit 1
fi
if (( queue_len < 1 )); then
  echo "Expected queue length >= 1, got $queue_len"
  exit 1
fi

echo "Smoke check passed: gateway healthy, signed webhook accepted, queue length=$queue_len"
