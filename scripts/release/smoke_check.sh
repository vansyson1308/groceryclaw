#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-groceryclaw-v2}"
SERVICES_RAW="${SERVICES:-worker,admin,gateway}"
RUN_GATEWAY_WEBHOOK_SMOKE="${RUN_GATEWAY_WEBHOOK_SMOKE:-false}"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required" >&2
  exit 1
fi

IFS=',' read -r -a SERVICES <<< "$SERVICES_RAW"

for svc in "${SERVICES[@]}"; do
  case "$svc" in
    worker|admin|gateway)
      echo "[smoke] rollout status deploy/$svc"
      kubectl -n "$NAMESPACE" rollout status "deploy/$svc" --timeout=180s >/dev/null
      ;;
    *)
      echo "Unsupported service: $svc" >&2
      exit 1
      ;;
  esac
done

if [[ "$RUN_GATEWAY_WEBHOOK_SMOKE" == "true" ]]; then
  echo "[smoke] running deep gateway webhook smoke (requires WEBHOOK_SIGNATURE_SECRET)"
  NAMESPACE="$NAMESPACE" bash scripts/v2/k8s_prod_smoke.sh
else
  echo "[smoke] deep webhook smoke skipped (set RUN_GATEWAY_WEBHOOK_SMOKE=true to enable)"
fi

echo "Smoke checks completed."
