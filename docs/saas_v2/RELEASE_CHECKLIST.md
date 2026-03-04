# V2 Release Checklist (Canary-by-tenant)

## 1) Preconditions (must be green)
- [ ] CI workflow `v2-ci` is green.
- [ ] `load:light` and `perf:gate` pass.
- [ ] Security checks completed:
  - [ ] webhook auth mode configured correctly (`mode1` preferred; `mode2` restricted)
  - [ ] admin boundary private only
  - [ ] break-glass key disabled or rotated
  - [ ] no plaintext secret leakage in logs
- [ ] DB migration status clean (`npm run db:v2:status`).

## 2) Prepare canary cohort
1. Select initial cohort (1-5% tenants, low-risk profiles first).
2. Confirm each tenant health baseline (errors/queue lag/notification backlog normal).
3. Dry-run processing_mode change:

```bash
node --experimental-strip-types scripts/canary_set_mode.ts \
  --base-url http://127.0.0.1:3001 \
  --tenants <id1,id2> \
  --mode v2
```

## 3) Execute canary rollout
Apply mode switch:

```bash
node --experimental-strip-types scripts/canary_set_mode.ts \
  --base-url http://127.0.0.1:3001 \
  --token "$ADMIN_BEARER_TOKEN" \
  --tenants <id1,id2> \
  --mode v2 \
  --apply
```

Verify cohort status:

```bash
node --experimental-strip-types scripts/canary_status.ts \
  --base-url http://127.0.0.1:3001 \
  --token "$ADMIN_BEARER_TOKEN" \
  --tenants <id1,id2> \
  --apply
```

## 4) Observe metrics before expansion
Monitor for 15-30 minutes after each cohort step:
- Gateway ACK p95 (`< 200ms`)
- Queue lag p95 (`< 2s`)
- Error rate (`< 1%`)
- DLQ growth (flat/near-zero)
- Pending notification backlog trend (non-explosive)

If stable, expand progressively (e.g., 5% → 15% → 35% → 100%).

## 5) Immediate backout (no data loss)
1. Flip impacted cohort to `legacy`:

```bash
node --experimental-strip-types scripts/canary_set_mode.ts \
  --base-url http://127.0.0.1:3001 \
  --token "$ADMIN_BEARER_TOKEN" \
  --tenants <id1,id2> \
  --mode legacy \
  --apply
```

2. If needed, disable high-risk worker features via env toggles (notifier/sync flags).
3. Keep Gateway ingress up; preserve inbound records.
4. Re-run cohort status and verify queue stabilization.

## 6) Sign-off criteria
- [ ] No SLO gate violations across final canary stage.
- [ ] No unexplained DLQ or duplicate side effects.
- [ ] Rollback command validated in drill environment.
- [ ] Ops on-call acknowledges runbook readiness.
