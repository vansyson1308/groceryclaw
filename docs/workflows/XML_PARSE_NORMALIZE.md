# XML Parse + Normalize Workflow (Flow 1 base)

## Purpose
This workflow implements PRD Flow 1 base behavior for XML invoices:
- deduplicate by `(zalo_user_id, zalo_msg_id)` before processing
- download and parse XML
- normalize into PRD `ParsedInvoice` shape
- write audit record to `invoice_log`

Workflow file: `n8n/workflows/invoice_xml_parse_normalize.json`.

## Input contract (Execute Workflow Trigger)
Expected input JSON from master workflow:

```json
{
  "zalo_user_id": "user_zalo_id_abc123",
  "zalo_msg_id": "msg_003",
  "supplier_guess": "TIEP_DUNG",
  "file_url": "https://.../invoice.xml"
}
```

Required fields:
- `zalo_user_id`
- `zalo_msg_id`
- `file_url` (must be valid HTTPS URL)

## Calling from master workflow
Use n8n **Execute Workflow** node:
1. Select workflow: `Invoice XML Parse + Normalize`
2. Pass the above payload fields from webhook context.
3. Branch on output:
   - `signal = "duplicate"` → skip further processing
   - `signal = "processed"` → continue to mapping/PO logic

## Dedup behavior
Dedup check query:
- `invoice_log` where `zalo_user_id + zalo_msg_id` already exists
- and `status <> 'failed'`

If duplicate found:
- workflow returns `{ duplicate: true, signal: "duplicate" }`
- does not download/parse XML
- does not insert a new log row

## ParsedInvoice normalization
Output follows PRD §1.3.2-style fields:
- `supplier_name`, `supplier_code`, `invoice_number`, `invoice_date`
- `items[]` with:
  - `line_number`
  - `supplier_item_code`
  - `item_name`
  - `quantity`
  - `unit`
  - `unit_price`
  - `total_amount`
  - `is_promotion`
  - `barcode`
  - `confidence_score = 100`
- `total_bill_amount`
- `raw_source = "xml"`
- `llm_overall_confidence = 100`

## Logging behavior
On successful parse, inserts into `invoice_log`:
- `zalo_user_id`
- `zalo_msg_id`
- `supplier_code`
- `source_type = 'xml'`
- `source_url`
- `parsed_data` (JSONB normalized invoice)
- `status = 'processing'`
- `llm_confidence = 100`
- `processing_time_ms`

Security note:
- stores parsed JSON and source URL only
- does not persist full XML payload body

## Supported XML structure caveats
Current parser supports a practical subset:
- root: `Invoice` (or flat root fallback)
- supplier fields under `Supplier.Code` / `Supplier.Name`
- item list under `Items.Item`

If vendor XML differs, extend normalization node mapping rules.

## Local sample file
Sample XML for manual tests:
- `data/samples/invoice_sample.xml`

For local testing, host this file via any HTTPS-accessible URL (or temporary HTTPS tunnel).

## Manual test steps
1. Apply DB migrations:
   - `./scripts/db_migrate.sh`
2. Import workflow into n8n:
   - `n8n/workflows/invoice_xml_parse_normalize.json`
3. Execute workflow with payload referencing a valid HTTPS XML URL.
4. Confirm output includes:
   - `signal: "processed"`
   - `parsed_invoice` object
5. Re-run with same `zalo_user_id` + `zalo_msg_id`.
6. Confirm output includes:
   - `signal: "duplicate"`
   - no second insert for that unique pair.

## Validation SQL
```sql
-- Check parsed log rows
SELECT zalo_user_id, zalo_msg_id, source_type, status, created_at
FROM invoice_log
WHERE zalo_msg_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;

-- Confirm uniqueness works
SELECT zalo_user_id, zalo_msg_id, COUNT(*)
FROM invoice_log
WHERE zalo_msg_id IS NOT NULL
GROUP BY zalo_user_id, zalo_msg_id
HAVING COUNT(*) > 1;
```

## Rollback / Down migration reference
If needed to roll back migration `002_invoice_log_msg_id.sql`:
```sql
DROP INDEX IF EXISTS uq_invoice_log_user_msg;
DROP INDEX IF EXISTS idx_invoice_log_zalo_msg_id;
ALTER TABLE invoice_log DROP COLUMN IF EXISTS zalo_msg_id;
```
