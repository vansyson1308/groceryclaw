# Operator Acceptance Report (Staging Deployment Rehearsal Audit)

## Rehearsal scope
This audit validates the full execution chain for the first staging deployment rehearsal, from preflight through smoke/rollback guidance, using active repo assets only.

## Assets audited
- `scripts/release/preflight_check.sh`
- `scripts/release/detect_changed_services.mjs`
- `.github/workflows/v2-release.yml`
- `scripts/release/render_k8s_manifests.sh`
- `scripts/release/deploy_k8s.sh`
- `scripts/release/smoke_check.sh`
- `scripts/release/print_release_plan.sh`
- `docs/deployment/devops-execution-runbook.md`
- `docs/deployment/staging-first-deploy.md`
- `docs/deployment/preflight-checklist.md`

## Operator flow status by stage

| Stage | Status | Notes |
|---|---|---|
| Preflight | ✅ Ready | Non-destructive checks implemented; cluster/registry/env checks are opt-in. |
| Change detection | ✅ Ready | Machine-readable JSON output; safe fallback to deploy-all on ambiguity. |
| Build/push plan | ✅ Ready | `v2-release.yml` builds and optionally pushes images; release artifacts emitted. |
| Migration decision | ✅ Ready | Driven by detector output or manual override in workflow input. |
| Render | ✅ Ready | Render-only helper script grounded in `infra/k8s/overlays/prod`. |
| Deploy order orchestration | ✅ Conditionally ready | Scripted order and migration invocation; requires kube context/namespace/deployments. |
| Smoke checks | ✅ Conditionally ready | Rollout checks executable; deep gateway smoke requires `WEBHOOK_SIGNATURE_SECRET` and cluster access. |
| Rollback path | ✅ Documented | Explicit manual rollback guidance (image tag rollback + DB rollback procedure coordination). |

## What is executable from repo right now
- Local preflight and detection.
- Local release-plan generation.
- Manual workflow dispatch for detect/build/(optional)push/artifact output.
- K8s render helper execution.
- K8s deploy/smoke helper execution in dry-run mode.

## What still depends on platform/manual setup
- Valid kube context and namespace resources.
- Platform secret manager population.
- GHCR auth/permissions for push.
- Environment-specific image tag mutation/apply strategy.
- Production promotion policy and approvals.

## Exact blockers for first real staging deploy
1. Missing cluster access/context or namespace bootstrap.
2. Missing required runtime secrets (DB/Redis/webhook/OIDC/crypto).
3. Missing registry write access for image push.
4. Undefined process for applying newly built image tags in target environment.

## Recommended first dry-run sequence
1. `bash scripts/release/preflight_check.sh`
2. `node scripts/release/detect_changed_services.mjs --base HEAD~1 --head HEAD`
3. `bash scripts/release/print_release_plan.sh`
4. Run `V2 Release` workflow with dry settings:
   - `push_images=false`
   - `run_k8s_helpers=false`
   - `dry_run=true`
5. Review `release-plan.json` + rendered manifest artifact.

## Recommended first real staging sequence
1. `CHECK_CLUSTER=true TARGET_NAMESPACE=groceryclaw-v2 REQUIRE_DOCKER=true bash scripts/release/preflight_check.sh`
2. Run `V2 Release` workflow with:
   - `target_environment=staging`
   - `push_images=true`
   - `run_k8s_helpers=false`
   - `dry_run=true`
3. Apply image tag updates using platform’s approved method.
4. Execute rollout helper:
   - preview (`DRY_RUN=true`) then execute (`DRY_RUN=false`)
5. Run smoke helper; optionally run deep gateway smoke when webhook secret is available.

## Acceptance verdict
- **Ready for DevOps dry-run:** **yes**.
- **Ready for first staging deploy:** **yes, conditionally** (after platform prerequisites are satisfied).
- **Ready for unattended production deploy:** **no** (manual platform integration boundaries remain by design).
