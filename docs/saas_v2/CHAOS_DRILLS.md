# V2 Light Chaos Drills

## Drill 1: Redis outage (queue unavailable)
Goal: validate fast detection and rollback readiness.

Steps:
1. Stop Redis in local compose (`docker compose ... stop redis`).
2. Send webhook traffic (`npm run load:light`).
3. Observe queue failures and error logs.
4. Execute canary rollback for impacted tenants.

Expected:
- ACK path may degrade only if enqueue path hard-fails.
- Alerts fire for queue failures.
- Rollback command restores legacy routing.

## Drill 2: DB slowness / lock contention
Goal: ensure queue lag and ack alarms trigger before tenant-wide impact.

Steps:
1. Introduce DB delay (e.g., heavy query/load on dev DB).
2. Monitor queue lag p95 and job duration trends.
3. Scale workers by policy and pause canary expansion.

Expected:
- queue lag alert triggers (`>2s` sustained).
- recovery actions reduce lag trend.

## Drill 3: KiotViet 429 storm
Goal: verify retry controls and DLQ handling.

Steps:
1. Point KiotViet stub to return 429.
2. Run inbound flow for canary cohort.
3. Inspect retries and DLQ entries.
4. Optionally replay subset from DLQ (dry-run first, then apply).

Expected:
- retriable errors backoff correctly.
- jobs move to DLQ after attempt cap.
- replay tooling emits audit records and avoids duplicate side effects.
