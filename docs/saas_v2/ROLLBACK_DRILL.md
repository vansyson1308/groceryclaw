# V2 Rollback Drill (Scripted)

## Goal
Practice immediate tenant rollback from `v2` to `legacy` during a simulated incident, without data loss and without duplicate side effects.

## Scenario
Simulate KiotViet 429 storm for canary cohort and validate rollback execution path.

## Drill steps

### A. Setup drill cohort
1. Pick 1-2 non-production test tenants.
2. Switch to `v2` with canary script (`--apply`).
3. Confirm mode by running `canary_status.ts --apply`.

### B. Induce failure
1. Point KiotViet adapter to 429 stub profile (or force transient 429s in test env).
2. Generate inbound burst via `npm run load:light` (or focused replay set).

### C. Detect and alert conditions
Trigger incident when any is true for 5+ minutes:
- Queue lag p95 > 2000ms
- Error rate > 1%
- KiotViet 429 share > 5%
- DLQ rising continuously

### D. Execute rollback
```bash
node --experimental-strip-types scripts/canary_set_mode.ts \
  --base-url http://127.0.0.1:3001 \
  --token "$ADMIN_BEARER_TOKEN" \
  --tenants <id1,id2> \
  --mode legacy \
  --apply
```

Optional containment:
- Disable KiotViet sync flag.
- Increase backoff / reduce concurrency.

### E. Secret incident branch (if compromise suspected)
1. List secret metadata via Admin API.
2. Revoke compromised version:
```bash
node --experimental-strip-types scripts/revoke_secret.ts \
  --base-url http://127.0.0.1:3001 \
  --token "$ADMIN_BEARER_TOKEN" \
  --tenant-id <tenant-id> \
  --secret-id <secret-id> \
  --apply
```
3. Rotate fresh secret version.

### F. Verify recovery
Success criteria:
- processing_mode confirmed `legacy` for impacted tenants
- queue lag trend returns below threshold
- no new duplicate side effects observed
- ACK latency returns within budget
- incident timeline and commands logged
