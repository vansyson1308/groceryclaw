# V2 Capacity Model (Phase 6B)

## Purpose
This model converts measured SLO telemetry into practical worker sizing guidance for SaaS V2 (Gateway + Queue + Workers).

## Core formula
For one worker process handling one job at a time:

- `per_worker_capacity_rps ≈ 1 / p95_job_time_seconds`

For `N` workers with concurrency `C` and safety headroom `H`:

- `cluster_capacity_rps ≈ N * C * (1 / p95_job_time_seconds) * H`

Where:
- `H` defaults to `0.7` (30% reserve) for burst absorption and external API jitter.
- `p95_job_time_seconds` should come from load report `job_duration_ms` (p95 / 1000).

## Inputs to collect
- Gateway ACK p95 (`gateway_ack_ms`) — budget `< 200ms`.
- Queue lag p95 (`queue_lag_ms`) — budget `< 2000ms`.
- Worker job duration p95 (`job_duration_ms`) per critical job type.
- Error rate (`http_req_failed.rate`) — budget `< 1%`.

## Baseline assumptions for planning
- Active inbound users at peak minute: **2%** of tenant count.
- Average webhook burst multiplier: **10x** sustained for 30 seconds.
- Worker queue concurrency (`C`) starts at **5** per process.
- Safety headroom (`H`) is **0.7**.
- Example observed p95 job duration for XML path: **450ms** (0.45s).

Derived example:
- `per_worker_capacity_rps ≈ 5 * (1 / 0.45) * 0.7 ≈ 7.8 rps`

## Recommended worker sizing
These are starting points; tune with `load:full` evidence before production cutover.

| Tenant scale | Baseline target ingest | Burst target ingest (10x/30s) | Initial worker processes | Notes |
|---|---:|---:|---:|---|
| 100 tenants | 8 rps | 80 rps | 2 | Keep queue lag p95 under 2s; scale to 3 if lag trend rises. |
| 500 tenants | 25 rps | 250 rps | 5 | Use at least 2 hosts/availability zones equivalent. |
| 1000 tenants | 50 rps | 500 rps | 10 | Start 10, allow rapid step scaling to 14 on sustained lag. |

## Sizing rules (evidence-based)
1. Compute required workers from measured p95:
   - `required_workers = ceil(target_rps / (C * (1 / p95_job_time_seconds) * H))`
2. Add one extra worker for every additional **10 rps** sustained above model forecast.
3. During burst windows, protect ACK first: queue fast and scale workers, do not add sync logic to Gateway.

## Validation loop
1. Run `npm run load:full`.
2. Parse latest report with `npm run perf:gate`.
3. Recompute required workers from measured p95 job duration.
4. Update infra defaults only when 3 consecutive runs are stable.
