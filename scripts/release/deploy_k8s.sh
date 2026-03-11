#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-groceryclaw-v2}"
SERVICES_RAW="${SERVICES:-worker,admin,gateway}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-false}"
DRY_RUN="${DRY_RUN:-true}"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required" >&2
  exit 1
fi

IFS=',' read -r -a SERVICES <<< "$SERVICES_RAW"

echo "namespace=$NAMESPACE"
echo "services=${SERVICES[*]}"
echo "run_migrations=$RUN_MIGRATIONS"
echo "dry_run=$DRY_RUN"

run_cmd() {
  echo "+ $*"
  if [[ "$DRY_RUN" != "true" ]]; then
    "$@"
  fi
}

if [[ "$RUN_MIGRATIONS" == "true" ]]; then
  MIG_JOB="db-v2-migrate-manual-$(date +%Y%m%d%H%M%S)"
  echo "Migration stage requested."
  run_cmd kubectl -n "$NAMESPACE" create job --from=job/db-v2-migrate "$MIG_JOB"
  run_cmd kubectl -n "$NAMESPACE" wait --for=condition=complete --timeout=20m "job/$MIG_JOB"
fi

for svc in "${SERVICES[@]}"; do
  case "$svc" in
    worker|admin|gateway) ;;
    *) echo "Unsupported service: $svc" >&2; exit 1 ;;
  esac
  echo "Deploy stage: $svc"
  run_cmd kubectl -n "$NAMESPACE" rollout restart "deploy/$svc"
  run_cmd kubectl -n "$NAMESPACE" rollout status "deploy/$svc" --timeout=300s
done

echo "Deployment orchestration completed (or printed in dry-run mode)."
