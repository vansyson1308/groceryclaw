# Known Good Commands (Deployment Rehearsal)

All commands are grounded in current repo scripts and workflow.

## 1) Preflight (non-destructive)
```bash
bash scripts/release/preflight_check.sh
```

Stricter preflight with cluster checks:
```bash
CHECK_CLUSTER=true TARGET_NAMESPACE=groceryclaw-v2 REQUIRE_DOCKER=true bash scripts/release/preflight_check.sh
```

## 2) Change detection
```bash
node scripts/release/detect_changed_services.mjs --base HEAD~1 --head HEAD
```

Force deploy-all detector output:
```bash
node scripts/release/detect_changed_services.mjs --force-all true
```

## 3) Local dry-run helper flow
```bash
# Print local release plan from detector
bash scripts/release/print_release_plan.sh

# Render manifests only (no apply)
DRY_RUN=true OVERLAY_PATH=infra/k8s/overlays/prod OUT_FILE=artifacts/release/local-rendered.yaml bash scripts/release/render_k8s_manifests.sh

# Deploy helper preview (no cluster mutation)
NAMESPACE=groceryclaw-v2 RUN_MIGRATIONS=true SERVICES=worker,admin,gateway DRY_RUN=true bash scripts/release/deploy_k8s.sh
```

## 4) workflow_dispatch release kickoff
### GitHub UI
- Go to **Actions → V2 Release → Run workflow**
- Suggested first run inputs:
  - `target_environment=staging`
  - `services_override=` (empty)
  - `push_images=false`
  - `run_migrations=false`
  - `run_k8s_helpers=false`
  - `dry_run=true`

### GitHub CLI (if configured)
```bash
gh workflow run v2-release.yml \
  -f target_environment=staging \
  -f services_override= \
  -f push_images=false \
  -f run_migrations=false \
  -f run_k8s_helpers=false \
  -f dry_run=true
```

## 5) Render-only manifest check
```bash
DRY_RUN=true OVERLAY_PATH=infra/k8s/overlays/prod OUT_FILE=artifacts/release/test-render.yaml bash scripts/release/render_k8s_manifests.sh
```

## 6) Deploy helper dry-run
```bash
NAMESPACE=groceryclaw-v2 RUN_MIGRATIONS=true SERVICES=worker,admin,gateway DRY_RUN=true bash scripts/release/deploy_k8s.sh
```

## 7) Smoke-check invocation
Basic:
```bash
NAMESPACE=groceryclaw-v2 SERVICES=worker,admin,gateway RUN_GATEWAY_WEBHOOK_SMOKE=false bash scripts/release/smoke_check.sh
```

Deep gateway webhook smoke (requires `WEBHOOK_SIGNATURE_SECRET`):
```bash
export WEBHOOK_SIGNATURE_SECRET='<secret>'
NAMESPACE=groceryclaw-v2 SERVICES=gateway RUN_GATEWAY_WEBHOOK_SMOKE=true bash scripts/release/smoke_check.sh
```
