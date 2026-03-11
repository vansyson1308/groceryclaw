# Workflow Import Order (Recommended)

Importing in this order reduces dependency/config errors in n8n.

## 1) Foundation
1. `zalo_token_refresh.json`
2. `kiotviet_product_sync.json`
3. `validate_input.json`
4. `ops_event_logger.json`

## 2) Ingress + parsing
5. `zalo_webhook_receiver_v3.json`
6. `invoice_xml_parse_normalize.json`
7. `invoice_image_vision_parse.json`

## 3) Mapping + PO
8. `invoice_tier1_map_and_build_po.json`
9. `mapping_fallback_3tier.json`
10. `session_handler_global_confirm.json`
11. `session_handler_barcode_tier3.json`
12. `draft_po_preview_and_confirm.json`
13. `draft_po_decision_handler.json`

## 4) Pricing + operations
14. `price_check_and_alert.json`
15. `price_update_handler.json`
16. `daily_ops_summary.json`
17. `data_retention_cleanup.json`
18. `session_cleanup_cron.json`

## Activation order
- Activate in same order after assigning credentials.
- If any workflow references another by name, verify it exists and is active.
