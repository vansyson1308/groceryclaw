# Data Retention Policy (MVP)

## Purpose
Reduce sensitive payload exposure while preserving accounting/audit-critical records.

## Workflow
- `n8n/workflows/data_retention_cleanup.json`
- Schedule: weekly (Sunday, 03:00 server timezone).

## Defaults
- `INVOICE_PARSED_DATA_RETENTION_DAYS=180`
- `OPS_EVENTS_RETENTION_DAYS=90`
- Safety minimum for both: 30 days.

## What is cleaned
1. **invoice_log**
   - Old rows are kept for audit/accounting.
   - `parsed_data` is redacted to minimal marker payload.
   - `source_url` is replaced with `[redacted_by_retention]`.
2. **ops_events**
   - Rows older than retention threshold are deleted.

## What is NOT deleted
- `invoice_log` primary rows and key accounting references (`status`, PO IDs, timestamps).
- Current mapping/session/token tables.

## Tradeoff
- Keeping invoice_log rows supports auditability.
- Redacting parsed payload balances privacy with traceability.

## How to run manually
1. Import workflow into n8n.
2. Set env vars in runtime.
3. Execute workflow manually.
4. Validate SQL:
```sql
SELECT COUNT(*) FROM invoice_log WHERE parsed_data ? 'retention_redacted';
SELECT COUNT(*) FROM ops_events WHERE ts < NOW() - INTERVAL '90 days';
```

## Rollback / emergency stop
- Disable the schedule in n8n immediately if misconfigured.
- Restore from DB backup if over-redaction occurs.
