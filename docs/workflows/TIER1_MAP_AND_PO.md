# Tier 1 Map + Build PO (Flow 1 Happy Path)

## Purpose
Implements the XML happy-path when **all invoice items map via Tier 1 (`mapping_dictionary`)**.

Workflow file: `n8n/workflows/invoice_tier1_map_and_build_po.json`.

Input (Execute Workflow trigger):
- `parsed_invoice` (from XML normalize workflow)
- `zalo_user_id`
- `zalo_msg_id`

## Behavior summary
1. For each item, lookup Tier 1 mapping:
   - by `barcode` when present
   - otherwise by `(supplier_code, supplier_item_code)`
2. Apply unit conversion:
   - `converted_qty = quantity * conversion_rate`
   - `converted_unit_price = unit_price / conversion_rate`
   - if `conversion_rate <= 0` or invalid, fallback to `1` and emit warning
3. If any item unmapped:
   - return `status = "needs_mapping"`
   - no KiotViet PO API call occurs
4. If all mapped:
   - build completed PO payload (`status=2`, paid 100%, promo price=0)
   - call KiotViet token endpoint then `POST /purchaseorders`
   - update `invoice_log` row to `completed` with `kiotviet_po_id`, `kiotviet_po_code`, `processing_time_ms`

## Required env vars
- `KIOTVIET_CLIENT_ID`
- `KIOTVIET_CLIENT_SECRET`
- `KIOTVIET_RETAILER`
- optional defaults:
  - `KIOTVIET_BRANCH_ID` (default: 1)
  - `KIOTVIET_SUPPLIER_ID` (default: 0)
  - `KIOTVIET_SUPPLIER_CODE` (default: `NCC_<supplier_code>`)

## KiotViet endpoints + headers
### OAuth token
- `POST https://id.kiotviet.vn/connect/token`
- form: `client_id`, `client_secret`, `grant_type=client_credentials`, `scopes=PublicApi.Access`

### Create PO
- `POST https://public.kiotviet.vn/api/purchaseorders`
- headers:
  - `Authorization: Bearer <access_token>`
  - `Retailer: <KIOTVIET_RETAILER>`
  - `Content-Type: application/json`

## Manual test (all Tier 1 mapped)
1. Ensure `mapping_dictionary` has matching rows for all invoice items (barcode and/or supplier item code).
2. Execute workflow with parsed XML invoice input.
3. Confirm result:
   - `status = "completed"`
   - contains `kiotviet_po_id` and/or `kiotviet_po_code`
4. Confirm DB update:
```sql
SELECT zalo_user_id, zalo_msg_id, status, kiotviet_po_id, kiotviet_po_code, processing_time_ms
FROM invoice_log
WHERE zalo_user_id = '<user_id>' AND zalo_msg_id = '<msg_id>';
```

## Manual test (one item missing mapping)
1. Remove or alter one mapping row so one invoice item cannot resolve.
2. Execute workflow with same invoice structure.
3. Confirm result:
   - `status = "needs_mapping"`
   - `unmapped_items` contains missing item(s)
4. Confirm no PO created in KiotViet for this attempt.

## Conversion correctness check
Use example from PRD:
- Input item: `2 thùng @ 240000`, `conversion_rate = 24`
- Expected mapped values:
  - `converted_qty = 48`
  - `converted_unit_price = 10000`
- Total invariant remains `480000`.

## Validation SQL
```sql
-- Completed invoice logs with PO references
SELECT zalo_user_id, zalo_msg_id, status, kiotviet_po_id, kiotviet_po_code, created_at
FROM invoice_log
WHERE status = 'completed'
ORDER BY created_at DESC
LIMIT 20;

-- Investigate needs_mapping decisions in workflow output (not persisted by this workflow)
-- optional: add status transition logging in master workflow if required.
```

## Security notes
- Never include KiotViet secrets in logs or workflow pin data.
- Numeric inputs are normalized to numbers before conversion.
- Invalid conversion rates are guarded (`<=0` => fallback to `1` + warning).

## Rollback note
- Revert commit for workflow/docs.
- If test PO was created in KiotViet, delete/cancel it manually in KiotViet admin UI.
