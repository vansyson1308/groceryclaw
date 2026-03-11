#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage:
  NAMESPACE=groceryclaw-v2 RUN_MIGRATIONS=false SERVICES=worker,admin,gateway DRY_RUN=true bash scripts/release/deploy_k8s.sh

Behavior:
  - Orchestrates release order over selected services.
  - Optional migration job trigger (from existing job/db-v2-migrate).
  - DRY_RUN=true prints commands only (default, recommended first).
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

NAMESPACE="${NAMESPACE:-groceryclaw-v2}"
SERVICES_RAW="${SERVICES:-worker,admin,gateway}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-false}"
DRY_RUN="${DRY_RUN:-true}"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required" >&2
  exit 1
fi

if [[ "$DRY_RUN" != "true" && "$DRY_RUN" != "false" ]]; then
  echo "DRY_RUN must be true or false" >&2
  exit 1
fi

IFS=',' read -r -a SERVICES <<< "$SERVICES_RAW"

echo "[deploy] namespace=$NAMESPACE services=${SERVICES[*]} run_migrations=$RUN_MIGRATIONS dry_run=$DRY_RUN"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[deploy] DRY_RUN=true -> no cluster changes will be made"
fi

run_cmd() {
  echo "+ $*"
  if [[ "$DRY_RUN" == "false" ]]; then
    "$@"
  fi
}

# Read-only validations
run_cmd_readonly() {
  echo "+ $*"
  "$@"
}

run_cmd_readonly kubectl config current-context >/dev/null
run_cmd_readonly kubectl -n "$NAMESPACE" get namespace "$NAMESPACE" >/dev/null 2>&1 || {
  echo "Namespace not found: $NAMESPACE" >&2
  exit 1
}

if [[ "$RUN_MIGRATIONS" == "true" ]]; then
  run_cmd_readonly kubectl -n "$NAMESPACE" get job db-v2-migrate >/dev/null 2>&1 || {
    echo "Migration source job db-v2-migrate not found in namespace $NAMESPACE" >&2
    exit 1
  }
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
  run_cmd_readonly kubectl -n "$NAMESPACE" get deploy "$svc" >/dev/null 2>&1 || {
    echo "Deployment not found: $svc" >&2
    exit 1
  }

  echo "Deploy stage: $svc"
  run_cmd kubectl -n "$NAMESPACE" rollout restart "deploy/$svc"
  run_cmd kubectl -n "$NAMESPACE" rollout status "deploy/$svc" --timeout=300s
done

echo "Deployment orchestration completed."
