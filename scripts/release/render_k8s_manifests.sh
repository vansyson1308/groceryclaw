#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage: OVERLAY_PATH=infra/k8s/overlays/prod OUT_FILE=artifacts/release/k8s-rendered.yaml DRY_RUN=true bash scripts/release/render_k8s_manifests.sh

Renders kustomize manifests to a file. This script does not apply to cluster.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

OVERLAY_PATH="${OVERLAY_PATH:-infra/k8s/overlays/prod}"
OUT_FILE="${OUT_FILE:-artifacts/release/k8s-rendered.yaml}"
DRY_RUN="${DRY_RUN:-true}"

if [[ ! -d "$OVERLAY_PATH" ]]; then
  echo "Overlay path does not exist: $OVERLAY_PATH" >&2
  exit 1
fi

if ! command -v kustomize >/dev/null 2>&1 && ! command -v kubectl >/dev/null 2>&1; then
  echo "kustomize or kubectl is required" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT_FILE")"

echo "[render] overlay=$OVERLAY_PATH out=$OUT_FILE dry_run=$DRY_RUN"
if command -v kustomize >/dev/null 2>&1; then
  kustomize build "$OVERLAY_PATH" > "$OUT_FILE"
else
  kubectl kustomize "$OVERLAY_PATH" > "$OUT_FILE"
fi

echo "Rendered manifests -> $OUT_FILE"
echo "Safe behavior: render only (no cluster apply)."
