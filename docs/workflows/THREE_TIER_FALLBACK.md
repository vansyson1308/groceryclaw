# Three-Tier Fallback Mapping (PRD V4)

## Purpose
Implements PRD V4 fallback flow for unmapped items:
- **Tier 1**: `mapping_dictionary` (handled in PO happy-path workflow)
- **Tier 2**: `global_fmcg_master` exact barcode/fuzzy name suggestion + user confirm
- **Tier 3**: manual barcode capture and mapping/product creation

## Workflows
1. `n8n/workflows/mapping_fallback_3tier.json`
   - Entry for unresolved items queue
   - Tier 2 candidate selection
   - Session transitions:
     - `waiting_for_global_confirm`
     - `waiting_for_barcode`

2. `n8n/workflows/session_handler_global_confirm.json`
   - Handles user button action (`GLOBAL_CONFIRM` / `GLOBAL_REJECT`)
   - CONFIRM:
     - resolves/creates KiotViet product
     - upserts `mapping_dictionary` (`source='global_fmcg'`)
     - appends mapped item (with conversion)
     - loops back or proceeds to PO workflow
   - REJECT:
     - moves to `waiting_for_barcode`

3. `n8n/workflows/session_handler_barcode_tier3.json`
   - Validates barcode format (`8–13` digits)
   - Finds cached product by barcode or creates product in KiotViet
   - Upserts `mapping_dictionary` (`source='barcode_scan'`)
   - Optional conversion follow-up state:
     - `waiting_for_conversion_rate`
   - loops queue or proceeds to PO workflow

## Session state transitions
- `idle` → `waiting_for_global_confirm` (Tier2 candidate found)
- `idle`/`waiting_for_global_confirm` → `waiting_for_barcode` (Tier2 reject or no candidate)
- `waiting_for_barcode` → `waiting_for_conversion_rate` (if no known conversion and unit mismatch)
- `waiting_*` → `idle` (after mapping queue completed and PO flow invoked)

All saved sessions set `expires_at = NOW() + INTERVAL '30 minutes'`.

### TTL behavior (30 min)
Master router should treat expired sessions as stale:
- if `expires_at <= NOW()`, set `session_state='idle'` and clear context.
- prompt user to resend invoice or restart mapping step.

## Input / payload safety
- Workflow payloads should contain only IDs, product names, barcodes, mapping metadata.
- Never include credentials/tokens in session context.
- Validate user input strictly (barcode regex `^\d{8,13}$`).

## Manual test script
### Scenario A: new tenant, Tier 2 confirm, then Tier 1 on repeat
1. Ensure tenant has empty `mapping_dictionary`.
2. Submit invoice with common FMCG item existing in `global_fmcg_master`.
3. `mapping_fallback_3tier` should set `waiting_for_global_confirm` and send confirm/reject message.
4. Click ✅ confirm.
5. `session_handler_global_confirm` should create/upsert mapping with `source='global_fmcg'`.
6. Re-send same invoice.
7. Item should now resolve via Tier 1 directly (no Tier 2 prompt).

### Scenario B: no Tier2 match -> Tier3 barcode
1. Submit item not found in global master.
2. Workflow should set `waiting_for_barcode` and ask barcode.
3. Send valid barcode (8–13 digits).
4. `session_handler_barcode_tier3` should map to existing product (or create new), upsert mapping, and continue queue.

### Scenario C: session TTL expiry
1. Start fallback flow and wait >30 minutes.
2. Send confirm/barcode message after expiry.
3. Router should reset to `idle` and ask user to restart.

## Validation SQL
```sql
-- Active sessions and their states
SELECT zalo_user_id, session_state, expires_at, updated_at
FROM user_sessions
ORDER BY updated_at DESC
LIMIT 50;

-- Mappings learned from Tier2
SELECT supplier_code, supplier_item_code, source, conversion_rate, updated_at
FROM mapping_dictionary
WHERE source IN ('global_fmcg', 'barcode_scan')
ORDER BY updated_at DESC
LIMIT 50;
```

## Cleanup / rollback notes
- Revert commit to remove workflow artifacts.
- Optional cleanup test data:
```sql
DELETE FROM mapping_dictionary WHERE source IN ('global_fmcg', 'barcode_scan');
UPDATE user_sessions SET session_state='idle', context_data='{}'::jsonb, expires_at=NULL;
```
