#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-groceryclaw-v2}"
GATEWAY_PORT="${GATEWAY_PORT:-18080}"
REDIS_LABEL="${REDIS_POD_LABEL:-app=redis}"
WEBHOOK_SIGNATURE_SECRET="${WEBHOOK_SIGNATURE_SECRET:-}"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required" >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

if [ -z "$WEBHOOK_SIGNATURE_SECRET" ]; then
  echo "Set WEBHOOK_SIGNATURE_SECRET in environment before running smoke." >&2
  exit 1
fi

echo "[1/6] checking deployment readiness"
kubectl -n "$NAMESPACE" rollout status deploy/gateway --timeout=180s >/dev/null
kubectl -n "$NAMESPACE" rollout status deploy/worker --timeout=180s >/dev/null

echo "[2/6] checking migrate job template exists"
kubectl -n "$NAMESPACE" get job db-v2-migrate >/dev/null

echo "[3/6] port-forward gateway service"
kubectl -n "$NAMESPACE" port-forward svc/gateway "${GATEWAY_PORT}:80" >/tmp/gc-k8s-gw-pf.log 2>&1 &
GW_PF_PID=$!
trap 'kill "$GW_PF_PID" >/dev/null 2>&1 || true' EXIT
sleep 2

BODY_FILE=$(mktemp)
cp tests/fixtures/zalo_webhook_valid.json "$BODY_FILE"
SIG=$(openssl dgst -sha256 -hmac "$WEBHOOK_SIGNATURE_SECRET" "$BODY_FILE" | awk '{print $2}')

echo "[4/6] gateway /healthz"
HEALTH_CODE=$(curl -sS -o /tmp/gc-k8s-health.out -w '%{http_code}' "http://127.0.0.1:${GATEWAY_PORT}/healthz")
if [ "$HEALTH_CODE" != "200" ]; then
  echo "health check failed: HTTP ${HEALTH_CODE}" >&2
  cat /tmp/gc-k8s-health.out >&2 || true
  exit 1
fi

echo "[5/6] post signed webhook fixture"
WEBHOOK_CODE=$(curl -sS -o /tmp/gc-k8s-webhook.out -w '%{http_code}' -X POST "http://127.0.0.1:${GATEWAY_PORT}/webhooks/zalo" \
  -H 'content-type: application/json' \
  -H "x-zalo-signature: ${SIG}" \
  --data-binary @"$BODY_FILE")
if [ "$WEBHOOK_CODE" != "200" ]; then
  echo "webhook failed: HTTP ${WEBHOOK_CODE}" >&2
  cat /tmp/gc-k8s-webhook.out >&2 || true
  exit 1
fi

echo "[6/6] enqueue evidence"
REDIS_POD=$(kubectl -n "$NAMESPACE" get pod -l "$REDIS_LABEL" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [ -n "$REDIS_POD" ]; then
  LENGTH=$(kubectl -n "$NAMESPACE" exec "$REDIS_POD" -- redis-cli LLEN bull:jobs:wait 2>/dev/null || echo "0")
  echo "redis queue wait length: ${LENGTH}"
  if [ "${LENGTH}" -lt 1 ]; then
    echo "queue length did not increase (expected >=1 waiting job)" >&2
    exit 1
  fi
else
  echo "no redis pod matched ${REDIS_LABEL}; checking worker logs for PROCESS_INBOUND_EVENT instead"
  kubectl -n "$NAMESPACE" logs deploy/worker --tail=200 | grep -E 'PROCESS_INBOUND_EVENT|worker job started' >/dev/null || {
    echo "could not confirm enqueue from worker logs" >&2
    exit 1
  }
fi

echo "PASS: k8s smoke succeeded (gateway healthy, webhook accepted, enqueue evidence found)."
