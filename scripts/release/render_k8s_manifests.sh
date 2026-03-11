#!/usr/bin/env bash
set -euo pipefail

OVERLAY_PATH="${OVERLAY_PATH:-infra/k8s/overlays/prod}"
OUT_FILE="${OUT_FILE:-artifacts/release/k8s-rendered.yaml}"
DRY_RUN="${DRY_RUN:-true}"

if ! command -v kustomize >/dev/null 2>&1 && ! command -v kubectl >/dev/null 2>&1; then
  echo "kustomize or kubectl is required" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT_FILE")"

if command -v kustomize >/dev/null 2>&1; then
  kustomize build "$OVERLAY_PATH" > "$OUT_FILE"
else
  kubectl kustomize "$OVERLAY_PATH" > "$OUT_FILE"
fi

echo "Rendered manifests -> $OUT_FILE"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "DRY_RUN=true (render only; no cluster apply performed)"
fi
