# Flow 4: Draft PO Preview & User Confirmation

## Goal
Prevent wrong PO creation for low-confidence image parses or partial mapping outcomes by requiring user confirmation before finalizing the purchase order.

This flow implements **Strategy A**:
1. Create PO as **draft** (`status=1`).
2. Ask user to approve/reject/edit.
3. Finalize only on explicit approval.

## Workflows
- `n8n/workflows/draft_po_preview_and_confirm.json`
- `n8n/workflows/draft_po_decision_handler.json`

## Input Contract
`draft_po_preview_and_confirm` expects:
```json
{
  "zalo_user_id": "...",
  "zalo_msg_id": "...",
  "mapped_items": [ ... ],
  "unmapped_items": [ ... ],
  "confidence_meta": { "overall_confidence": 72 },
  "invoice_meta": { "supplier_code": "NCC_ABC" }
}
```

## User Journey
1. Upstream flow detects low confidence / partial mapping.
2. `draft_po_preview_and_confirm` builds summary and creates KiotViet draft PO (`status=1`).
3. Workflow stores:
   - `invoice_log.status='draft'`
   - `invoice_log.decision_status='pending'`
   - `invoice_log.decision_payload` with draft references
   - `user_sessions.session_state='waiting_for_draft_confirm'` (TTL 30m)
4. Zalo receives buttons:
   - ✅ Approve PO (`DRAFT_APPROVE|<zalo_user_id>|<zalo_msg_id>|<draft_po_id>`)
   - ❌ Reject (`DRAFT_REJECT|...`)
   - ✏️ Edit (`DRAFT_EDIT|...`)
5. `draft_po_decision_handler` validates session + IDs + one-time decision guard.

## Decision Handling
### Approve
- Calls KiotViet update on draft PO (`PUT /purchaseorders/{id}`) with `status=2` and payment metadata.
- Updates `invoice_log`:
  - `status='completed'`
  - `decision_status='approved'`
  - `decision_at=NOW()`
- Session reset to `idle`.

### Reject
- Does **not** finalize draft PO.
- Updates `invoice_log`:
  - `status='rejected'`
  - `decision_status='rejected'`
  - `decision_at=NOW()`
- User is prompted to resend clearer image or provide XML.
- Session reset to `idle`.

### Edit
- Sets `user_sessions.session_state='waiting_for_mapping_fix'` for correction path routing.
- Sends prompt to continue fix flow.

## Replay Protection (One-time decision)
Decision is applied only when `invoice_log.decision_status='pending'`.
- If already approved/rejected, handler returns `already_processed` and does not re-apply state changes.
- Payload-only IDs are used; no secrets are embedded in button payload.

## Security Notes
- Button payload contains only IDs (`zalo_user_id`, `zalo_msg_id`, `draft_po_id`).
- Decision handler validates payload against server-side `user_sessions.context_data`.
- No KiotViet or Zalo secrets are stored in workflow JSON; credentials use env vars.

## Manual Test (End-to-End)
1. Import both workflows into n8n.
2. Configure credentials:
   - Postgres credential for workflow Postgres nodes.
   - Env vars: `KIOTVIET_CLIENT_ID`, `KIOTVIET_CLIENT_SECRET`, `KIOTVIET_RETAILER`, `ZALO_OA_ACCESS_TOKEN`.
3. Execute `draft_po_preview_and_confirm` with sample mapped items.
4. Verify DB:
```sql
SELECT status, decision_status, decision_payload
FROM invoice_log
WHERE zalo_user_id = '<USER_ID>' AND zalo_msg_id = '<MSG_ID>'
ORDER BY created_at DESC LIMIT 1;
```
Expect: `status='draft'`, `decision_status='pending'`.

5. Execute `draft_po_decision_handler` with approve payload:
```json
{ "payload": "DRAFT_APPROVE|<USER_ID>|<MSG_ID>|<DRAFT_PO_ID>" }
```
Expect:
- `invoice_log.decision_status='approved'`
- `invoice_log.status='completed'`

6. Re-run same payload again.
Expect: `already_processed` (no replay).

7. Repeat with reject payload.
Expect:
- `decision_status='rejected'`
- no final PO transition.

## Failure Modes & Safe Handling
- **Expired/missing session**: reject decision, request user restart confirmation flow.
- **Payload mismatch**: reject to avoid cross-invoice actions.
- **KiotViet finalization error**: keep `decision_status='pending'`, retry operator action.
- **Reject path cleanup**: KiotViet draft may still exist; perform manual cleanup in KiotViet UI if needed.

## Manual Cleanup / Rollback (Operational)
- Drafts created during tests can be cancelled/removed in KiotViet Backoffice.
- Repository rollback:
```bash
git revert <commit>
```
