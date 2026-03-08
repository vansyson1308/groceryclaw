# V2 E2E Fix Pass 7

## 1) CI evidence used
Using only the user-provided latest CI/runtime logs in this conversation:
- Queue path is active in gateway and worker (`queue_enabled_in_test=true`, `queue_transport=redis`).
- Gateway accepts and enqueues linked webhook flow.
- Worker executes `PROCESS_INBOUND_EVENT` and fails with `new row violates row-level security policy for table "jobs"`.
- Postgres confirms failing SQL is `INSERT INTO jobs ... jsonb_build_object('correlation_id', $3::text) ...`.

## 2) Jobs insert origin
- File: `apps/worker/src/process-inbound.ts`
- Function: `markJob(...)`
- Caller path:
  - `processInboundEventPipeline(...)` calls `markJob(..., 'processing')` before processing,
  - then `markJob(..., 'completed'|'failed')` after processing outcome.
- DB helper used before fix:
  - direct `deps.exec(...)` from worker `runSql` path, which uses pool-level query (no tenant session context setup).

## 3) Relevant RLS policies
From `db/v2/migrations/003_v2_rls_roles.sql`:
- `ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;`
- Policy `rls_jobs_app_user` on `jobs`:
  - `USING (tenant_id = _rls_tenant_id())`
  - `WITH CHECK (tenant_id = _rls_tenant_id())`
- `_rls_tenant_id()` resolves tenant from `current_setting('app.current_tenant', true)`.

## 4) Actual cause of rejection
- `jobs` insert in `markJob` ran without tenant session context (`app.current_tenant`) because it used direct `deps.exec(...)` outside tenant-scoped transaction setup.
- With RLS policy requiring `tenant_id = _rls_tenant_id()`, missing tenant context yields rejection (`new row violates row-level security policy for table "jobs"`).

## 5) Fix applied
- Kept query logic unchanged except execution context.
- Updated `markJob(...)` to execute the jobs insert inside `deps.runInTenantTransaction(...)` when available, using tenant id + `PROCESS_INBOUND_EVENT` application context.
- Fallback remains direct `deps.exec(...)` only when no tenant transaction helper is provided.

## 6) Static validation
- Ran `npm run typecheck`.
- Result: pass.

## 7) Exact expectation for next CI run
- `PROCESS_INBOUND_EVENT` job-state insert into `jobs` should satisfy RLS due to explicit tenant session context.
- E2E should proceed past this specific RLS blocker; if any failure remains, it should be a new downstream bucket exposed by CI evidence.
