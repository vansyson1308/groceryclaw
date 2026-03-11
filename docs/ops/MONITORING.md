# Monitoring & Operational Visibility

## What to watch
1. **Pipeline health**
   - `invoice_log.status` distribution (`completed`, `failed`, `needs_mapping`, `needs_review`, `draft`, `rejected`).
2. **Error trends**
   - `ops_events` with `level='error'` grouped by `workflow` and `event_type`.
3. **Latency**
   - `invoice_log.processing_time_ms` daily average.
4. **Backlog risk**
   - Growth in `needs_mapping` / `needs_review` statuses.

## New Ops Artifacts
- `db/migrations/004_ops_metrics.sql`
  - `ops_metrics_daily`: daily rollups per tenant (`tenant_id` nullable).
  - `ops_events`: structured operational events.
- `n8n/workflows/ops_event_logger.json`
  - Reusable sub-workflow to log redacted events.
- `n8n/workflows/daily_ops_summary.json`
  - Scheduled daily at **08:00 Asia/Bangkok**.
  - Computes yesterday metrics, stores into `ops_metrics_daily`, and sends a summary to a configured webhook.

## Alert transport
Current implementation uses a **placeholder HTTP webhook**:
- Env var: `OPS_ALERT_WEBHOOK_URL`
- Payload shape:
```json
{
  "text": "...summary...",
  "metric_date": "YYYY-MM-DD",
  "source": "daily_ops_summary"
}
```
If Slack/email is introduced later, replace this endpoint with a gateway adapter.

## Triage playbook
### 1) KiotViet 429 / 5xx
Symptoms:
- bursts of failures in `ops_events` from KiotViet workflows.
- retry nodes increasing runtime.

Actions:
1. Check retry/backoff path in affected workflow execution logs.
2. Confirm KiotViet service status and rate limits.
3. Temporarily reduce batch size / schedule frequency.
4. Re-run failed invoices from safe checkpoints.

### 2) Zalo token expired
Symptoms:
- Zalo API returns auth errors.
- `zalo_token_refresh` workflow produces token refresh failures.

Actions:
1. Verify latest active row in `zalo_token_store`.
2. Run token refresh workflow manually.
3. Confirm `ZALO_APP_ID`/secret config in runtime env.
4. Check for clock skew in host/container.

### 3) Vision invalid JSON
Symptoms:
- image parse flow returns invalid schema or parse exceptions.

Actions:
1. Inspect prompt + model response in workflow execution.
2. Validate image preflight checks (type/size).
3. Route invoice to `needs_review` / draft flow.
4. Ask user to resend clearer image or XML.

## Security guardrails
- `ops_event_logger` redacts sensitive keys and token-like strings.
- Do **not** log raw OCR text, full user message content, access tokens, refresh tokens, or secrets.
- Keep `ops_events.context` to IDs and high-level diagnostics only.

## SQL snippets (quick debugging)
### Yesterday totals
```sql
SELECT
  COUNT(*) AS invoices_total,
  COUNT(*) FILTER (WHERE status='completed') AS completed,
  COUNT(*) FILTER (WHERE status IN ('failed','error','token_error','rejected')) AS failed,
  COUNT(*) FILTER (WHERE status='needs_mapping') AS needs_mapping,
  COUNT(*) FILTER (WHERE status IN ('needs_review','draft')) AS needs_review,
  ROUND(AVG(NULLIF(processing_time_ms,0)))::int AS avg_processing_ms
FROM invoice_log
WHERE created_at >= date_trunc('day', now() - interval '1 day')
  AND created_at < date_trunc('day', now());
```

### Top failures (last 24h)
```sql
SELECT COALESCE(error_details,'unknown_error') AS error_type, COUNT(*) AS total
FROM invoice_log
WHERE created_at >= now() - interval '24 hours'
  AND status IN ('failed','error','token_error','rejected')
GROUP BY COALESCE(error_details,'unknown_error')
ORDER BY total DESC
LIMIT 10;
```

### Ops event stream
```sql
SELECT ts, level, workflow, event_type, message, context
FROM ops_events
ORDER BY ts DESC
LIMIT 50;
```

### Metrics table sanity
```sql
SELECT *
FROM ops_metrics_daily
ORDER BY metric_date DESC, tenant_id NULLS FIRST
LIMIT 20;
```

## Manual checks for acceptance
1. Trigger `ops_event_logger` manually with sample payload and verify row insertion.
2. Trigger `daily_ops_summary` manually and verify:
   - rows upserted in `ops_metrics_daily`
   - `summary_sent` event in `ops_events`
   - outbound webhook call executed (or logged if endpoint is mock).
