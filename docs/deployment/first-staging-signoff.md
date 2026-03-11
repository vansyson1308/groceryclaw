# First Staging Deployment Signoff (One-page)

## Purpose
Final go/no-go signoff before pressing deploy for the first staging release.

## Deployment summary
- Release tag: `__________________________`
- Target environment: `staging`
- Services selected: `__________________________`
- Migration required: `yes / no`
- Approver: `__________________________`
- Operator: `__________________________`
- Date/time window: `__________________________`

## Go / No-Go checks

### GO checks (must all be true)
- [ ] Preflight strict checks passed (`REQUIRE_DOCKER=true`, cluster checks enabled)
- [ ] `release-plan.json` reviewed and approved (services, migration flag, deploy order)
- [ ] Image tags built/pushed and recorded
- [ ] Secret set completeness confirmed (DB/Redis/webhook/OIDC/crypto)
- [ ] Migration owner and rollback owner confirmed
- [ ] Smoke plan confirmed (basic + optional deep gateway check)

### NO-GO triggers
- [ ] Any required secret missing/unverified
- [ ] Cluster namespace/deployments not present
- [ ] Migration decision unresolved
- [ ] Image tag apply method unresolved
- [ ] Rollback path/owner unresolved

## Deploy sequence summary
1. Migration (if required)
2. Worker rollout
3. Admin rollout
4. Gateway rollout
5. Smoke checks

## Rollback trigger summary
Trigger rollback if any of the following occur:
- rollout timeout/failure for selected service
- smoke checks fail
- migration job fails or introduces schema incompatibility symptoms
- gateway error rates spike immediately after rollout

Rollback action summary:
- revert deployment image tag(s) to last known-good SHA
- re-run rollout status + smoke checks
- if schema-related, coordinate DB rollback before re-opening gateway traffic

## Evidence to capture
- [ ] Workflow run URL
- [ ] `release-plan.json` artifact
- [ ] Deployed image tags (gateway/admin/worker)
- [ ] Migration job result/log (if run)
- [ ] Smoke output logs
- [ ] Incident/decision notes (if any deviations)

## Manual decisions to confirm before deploy
- [ ] Admin exposure mode for this staging run (private-only vs restricted ingress)
- [ ] Deep webhook smoke enabled or skipped (and why)
- [ ] Migration run now vs deferred (with explicit justification)
- [ ] Rollback threshold and who can execute rollback

## Final signoff
- Ready to deploy: `YES / NO`
- If NO, blocked by: `_____________________________________________`
- Approver signature/name: `_______________________________________`
- Operator signature/name: `_______________________________________`
