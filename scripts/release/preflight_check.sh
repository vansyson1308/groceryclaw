#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage:
  CHECK_CLUSTER=false CHECK_REGISTRY=false REQUIRE_ENV=false REQUIRE_DOCKER=false TARGET_NAMESPACE=groceryclaw-v2 bash scripts/release/preflight_check.sh

Non-destructive preflight validation for release operators.
Checks local tooling always; cluster/registry/env checks are opt-in.

Flags:
  CHECK_CLUSTER=true   Validate kubectl context + namespace/deployments.
  CHECK_REGISTRY=true  Validate docker daemon and attempt GHCR manifest lookup.
  REQUIRE_ENV=true     Validate required secret/env vars are present in shell.
  REQUIRE_DOCKER=true  Fail if docker CLI is missing even when CHECK_REGISTRY=false.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

CHECK_CLUSTER="${CHECK_CLUSTER:-false}"
CHECK_REGISTRY="${CHECK_REGISTRY:-false}"
REQUIRE_ENV="${REQUIRE_ENV:-false}"
REQUIRE_DOCKER="${REQUIRE_DOCKER:-false}"
TARGET_NAMESPACE="${TARGET_NAMESPACE:-groceryclaw-v2}"

for b in CHECK_CLUSTER CHECK_REGISTRY REQUIRE_ENV REQUIRE_DOCKER; do
  v="${!b}"
  [[ "$v" == "true" || "$v" == "false" ]] || { echo "[FAIL] $b must be true|false"; exit 1; }
done

pass() { echo "[PASS] $*"; }
warn() { echo "[WARN] $*"; }
fail() { echo "[FAIL] $*"; exit 1; }

for cmd in node git jq; do
  command -v "$cmd" >/dev/null 2>&1 || fail "missing required tool: $cmd"
done
pass "core tools present (node, git, jq)"

if command -v docker >/dev/null 2>&1; then
  pass "docker CLI present"
else
  if [[ "$REQUIRE_DOCKER" == "true" || "$CHECK_REGISTRY" == "true" ]]; then
    fail "missing required tool: docker"
  fi
  warn "docker CLI missing (ok for docs/detect-only preflight)"
fi

[[ -f .github/workflows/v2-release.yml ]] || fail "missing release workflow .github/workflows/v2-release.yml"
[[ -f scripts/release/detect_changed_services.mjs ]] || fail "missing scripts/release/detect_changed_services.mjs"
[[ -f scripts/release/deploy_k8s.sh ]] || fail "missing scripts/release/deploy_k8s.sh"
[[ -f scripts/release/smoke_check.sh ]] || fail "missing scripts/release/smoke_check.sh"
[[ -f scripts/release/render_k8s_manifests.sh ]] || fail "missing scripts/release/render_k8s_manifests.sh"
pass "release assets present"

node scripts/release/detect_changed_services.mjs --base HEAD~1 --head HEAD >/tmp/gc-detect.json || fail "detector execution failed"
pass "changed-service detector executable"

if [[ "$CHECK_CLUSTER" == "true" ]]; then
  command -v kubectl >/dev/null 2>&1 || fail "kubectl required when CHECK_CLUSTER=true"
  kubectl config current-context >/dev/null 2>&1 || fail "no current kubectl context"
  kubectl get namespace "$TARGET_NAMESPACE" >/dev/null 2>&1 || fail "namespace not found: $TARGET_NAMESPACE"
  kubectl -n "$TARGET_NAMESPACE" get deploy gateway >/dev/null 2>&1 || fail "deployment missing: gateway"
  kubectl -n "$TARGET_NAMESPACE" get deploy admin >/dev/null 2>&1 || fail "deployment missing: admin"
  kubectl -n "$TARGET_NAMESPACE" get deploy worker >/dev/null 2>&1 || fail "deployment missing: worker"
  kubectl -n "$TARGET_NAMESPACE" get job db-v2-migrate >/dev/null 2>&1 || warn "job/db-v2-migrate missing (migration helper will fail until applied)"
  pass "cluster checks complete"
else
  warn "cluster checks skipped (CHECK_CLUSTER=false)"
fi

if [[ "$CHECK_REGISTRY" == "true" ]]; then
  docker info >/dev/null 2>&1 || fail "docker daemon not reachable"
  if docker manifest inspect ghcr.io/groceryclaw/gateway:latest >/dev/null 2>&1; then
    pass "GHCR gateway image reachable"
  else
    warn "could not verify GHCR image access (auth/private registry may be required)"
  fi
else
  warn "registry checks skipped (CHECK_REGISTRY=false)"
fi

if [[ "$REQUIRE_ENV" == "true" ]]; then
  required_env=(DB_APP_URL DB_ADMIN_URL REDIS_URL WEBHOOK_SIGNATURE_SECRET ADMIN_OIDC_ISSUER ADMIN_OIDC_AUDIENCE ADMIN_OIDC_JWKS_URI INVITE_PEPPER_B64 ADMIN_MEK_B64 WORKER_MEK_B64)
  missing=0
  for v in "${required_env[@]}"; do
    if [[ -z "${!v:-}" ]]; then
      echo "[MISSING_ENV] $v"
      missing=1
    fi
  done
  [[ "$missing" -eq 0 ]] || fail "required environment values missing"
  pass "required environment variables present"
else
  warn "secret/env presence checks skipped (REQUIRE_ENV=false)"
fi

echo "Preflight checks completed successfully."
