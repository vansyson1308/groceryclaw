# Zalo Token Refresh Workflow (Phase 0.5)

## Purpose
Implements PRD Phase 0.5 token lifecycle management for Zalo OA access tokens (refresh every 20 hours, persist to `zalo_token_store`, log failures).

Workflow file: `n8n/workflows/zalo_token_refresh.json`.

## Import into n8n
1. Open n8n UI.
2. Go to **Workflows** → **Import from File**.
3. Select `n8n/workflows/zalo_token_refresh.json`.
4. Open imported workflow and set credentials for both Postgres nodes (`Get Active Token`, `Persist New Token`, `Log Refresh Error`).
5. Save and activate workflow.

## Required Environment Variables
Set these in n8n runtime:
- `ZALO_APP_ID`
- `DATABASE_URL` (or equivalent n8n Postgres credential fields)

Token values are NOT read from env after bootstrap; this workflow uses DB as source of truth.

## Workflow Steps (mapped to PRD)
1. **Schedule Trigger**: every 20 hours.
2. **Get Active Token**: fetch active `refresh_token` from `zalo_token_store` where `token_type='oa_access'` and `is_active=TRUE`.
3. **Refresh Zalo Token**: POST `https://oauth.zaloapp.com/v4/oa/access_token` with form body:
   - `refresh_token`
   - `app_id`
   - `grant_type=refresh_token`
4. **Validate Refresh Response**: ensure `access_token`, `refresh_token` exist and no error.
5. **Persist New Token** (transaction):
   - deactivate old active token(s)
   - insert new token row with `expires_at = NOW() + INTERVAL '25 hours'`
6. **Error Branch**: insert an error audit row into `invoice_log` (status `token_error`) when refresh validation fails.
7. **Credential Update Strategy Note**: documents manual strategy because n8n credentials are not automatically mutated by workflow execution.

## Manual Test Procedure
### Prerequisites
- PostgreSQL schema applied (`zalo_token_store` + `invoice_log` exist).
- At least one active token row exists:
```sql
INSERT INTO zalo_token_store (token_type, access_token, refresh_token, expires_at, issued_at, is_active)
VALUES ('oa_access', 'BOOTSTRAP_ACCESS_PLACEHOLDER', 'BOOTSTRAP_REFRESH_PLACEHOLDER', NOW() + INTERVAL '1 hour', NOW(), TRUE);
```

### Test Steps
1. In n8n, open workflow and click **Execute Workflow**.
2. Confirm run reaches either:
   - success branch (`Persist New Token`), or
   - error branch (`Log Refresh Error`) if refresh token is invalid.

### Expected DB Results
On success:
```sql
SELECT token_type, is_active, expires_at, created_at
FROM zalo_token_store
WHERE token_type='oa_access'
ORDER BY created_at DESC
LIMIT 2;
```
- Latest row is `is_active = TRUE`
- Previous active row becomes `is_active = FALSE`
- New row expiry is ~25h from now.

On failure:
```sql
SELECT status, supplier_code, error_details, created_at
FROM invoice_log
WHERE supplier_code='zalo_token_refresh'
ORDER BY created_at DESC
LIMIT 5;
```
- At least one row with `status = 'token_error'`.

## Security Notes
- Do not store real tokens in git or exported workflow JSON.
- Keep n8n credentials managed in runtime secret storage.
- Treat `refresh_token` and `access_token` as sensitive data at-rest and in logs.

## Helper Function (Unit-Testable)
A pure helper wrapper is included at `src/logic/zaloToken.js`.

- Constructor accepts injected dependencies (`fetchActiveToken`, `now`) for testability.
- Behavior:
  - returns `access_token` when present and not expired
  - throws `E011` when token record is missing/invalid/expired

Run tests:
```bash
node --test src/logic/zaloToken.test.js
```
