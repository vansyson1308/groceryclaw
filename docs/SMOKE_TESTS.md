# Smoke Tests

These are minimal end-to-end checks for onboarding and release verification.

## Preconditions
- `docker compose up -d` is running
- migrations + seed applied
- workflows imported and credentials configured in n8n

## Test 1 — Webhook async ACK + signature gate
1. Trigger `zalo_webhook_receiver_v3` with valid payload in n8n test mode.
2. Confirm immediate HTTP 200 response.
3. Send invalid signature variant.

Expected:
- valid payload reaches reply branch
- invalid signature logs warning/failure and does not continue processing.

## Test 2 — XML invoice happy path
1. Execute `invoice_xml_parse_normalize` with sample HTTPS XML URL.
2. Execute tier1 mapping/PO flow with mapped items.

Expected:
- parsed invoice JSON produced
- conversion logic applied for mapped items
- PO payload/build step succeeds (or API call if credentials are available).

## Test 3 — Fallback mapping (Tier2/Tier3)
1. Use invoice containing at least one unmapped item.
2. Execute `mapping_fallback_3tier`.

Expected:
- Tier2 hit -> session `waiting_for_global_confirm`, confirm button path available.
- Tier2 miss -> session `waiting_for_barcode` and barcode prompt.

## Test 4 — Image confidence gate + draft flow
1. Execute `invoice_image_vision_parse` with valid image URL.
2. Force low-confidence payload path into draft flow.
3. Execute draft approve/reject handler.

Expected:
- low confidence enters draft confirmation
- approve finalizes draft PO path
- reject does not finalize PO and logs decision.

## Test 5 — Pricing + ops + retention
1. Execute `price_check_and_alert`, then `price_update_handler` (confirm/keep/custom).
2. Execute `daily_ops_summary` manually.
3. Execute `data_retention_cleanup` manually.

Expected:
- pricing decisions are handled safely
- metrics/event logs are written
- only eligible old payload fields are redacted/deleted.
