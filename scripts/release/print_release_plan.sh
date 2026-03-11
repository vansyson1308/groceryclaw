#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage:
  BASE_REF=HEAD~1 HEAD_REF=HEAD RELEASE_TAG=sha-<tag> TARGET_ENV=staging FORCE_ALL=false bash scripts/release/print_release_plan.sh

Generates a local release-plan JSON from changed-service detection without touching cluster state.
Notes:
  - BASE_REF defaults to HEAD~1 for local rehearsal convenience.
  - In CI/release branches you can set BASE_REF=origin/main.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

BASE_REF="${BASE_REF:-HEAD~1}"
HEAD_REF="${HEAD_REF:-HEAD}"
TARGET_ENV="${TARGET_ENV:-staging}"
FORCE_ALL="${FORCE_ALL:-false}"
RELEASE_TAG="${RELEASE_TAG:-sha-$(git rev-parse --short=12 HEAD)}"
OUT_FILE="${OUT_FILE:-artifacts/release/local-release-plan.json}"

mkdir -p "$(dirname "$OUT_FILE")"

if [[ "$FORCE_ALL" == "true" ]]; then
  node scripts/release/detect_changed_services.mjs --force-all true > /tmp/gc-release-detect.json
else
  node scripts/release/detect_changed_services.mjs --base "$BASE_REF" --head "$HEAD_REF" > /tmp/gc-release-detect.json
fi

SERVICES=$(jq -c '.services' /tmp/gc-release-detect.json)
RUN_MIGRATIONS=$(jq -r '.run_migrations' /tmp/gc-release-detect.json)
REASON=$(jq -r '.reason' /tmp/gc-release-detect.json)

cat > "$OUT_FILE" <<PLAN
{
  "target_environment": "$TARGET_ENV",
  "base_ref": "$BASE_REF",
  "head_ref": "$HEAD_REF",
  "services": $SERVICES,
  "release_tag": "$RELEASE_TAG",
  "run_migrations": $RUN_MIGRATIONS,
  "deploy_order": ["migrate(if required)", "worker", "admin", "gateway"],
  "detector_reason": "$REASON"
}
PLAN

cat "$OUT_FILE"
echo

echo "Release plan written to $OUT_FILE"
