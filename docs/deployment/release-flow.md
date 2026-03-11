# Release Flow (V2 monorepo, independent deploy units)

## Purpose
Provide an operationally safe release sequence for `gateway`, `admin`, `worker`, with migration coordination and rollback guidance.

## Recommended release order

1. **Pre-checks**
   - CI green on target commit.
   - Required deploy secrets present.
   - Registry/tag targets prepared.

2. **Run migration stage (conditional but early)**
   - Run `db-v2-migrate` before public ingress rollout when schema contract may change.

3. **Deploy internal runtime(s)**
   - Deploy `worker` first.
   - Deploy `admin` next.

4. **Deploy public runtime last**
   - Deploy `gateway` after internal dependencies are healthy.

## When to run `db-v2-migrate`

Run before service rollout when:
- `db/v2/migrations/**` changed, or
- migration tooling/scripts changed, or
- release explicitly includes DB contract change.

Do not defer migration until after gateway traffic cutover.

## When NOT to deploy all services together

Prefer partial deploys when:
- only one service code path changed (`apps/gateway` OR `apps/admin` OR `apps/worker`) and shared triggers were untouched,
- only service-specific deploy contract changes were made.

Prefer full coordinated deploy when:
- `packages/common/**` changed,
- shared infra/runtime contract changed,
- migration/DB contract changed.

## Smoke checks after each stage

### After migration
- migration command exits successfully
- optional schema status check (`npm run db:v2:status`)

### After worker deploy
- `GET /healthz` and `GET /readyz` on worker health port
- no immediate worker startup failure in logs

### After admin deploy
- `GET /healthz` and `GET /readyz`
- auth path sanity check (private access path)

### After gateway deploy
- `GET /healthz` and `GET /readyz`
- webhook path acceptance check at `POST /webhooks/zalo` (signed request in non-test environments)

## High-level rollback decision tree

1. **Issue is isolated to one service and DB contract is compatible?**
   - Roll back only that service image to previous good tag.

2. **Issue appears across multiple services after shared change (`packages/common` etc.)?**
   - Roll back all affected services to prior release set.

3. **Issue caused by migration/schema incompatibility?**
   - Pause public gateway rollout/traffic.
   - Execute controlled DB rollback procedure (if available and approved).
   - Roll services back to schema-compatible tags.

4. **Unclear root cause during active incident?**
   - Favor stable-state restoration: previous full release set + blocked new gateway rollout until validation passes.

## Operational guardrails
- Keep gateway public rollout last.
- Keep admin private-default unless explicitly approved.
- Keep worker internal-only.
- Use immutable image tags (`sha-*`) for rollback precision.

