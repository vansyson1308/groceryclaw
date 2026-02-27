# Pricing Alert & Update Flow (Flow 3)

## Purpose
Implements PRD Flow 3:
1. Check new converted import cost vs current product pricing.
2. Resolve applicable `pricing_rules` (priority: product > supplier > category > DEFAULT).
3. Send alert when selling price is below expected minimum.
4. Process decision actions (confirm/keep/custom) and update KiotViet price.
5. Run periodic session cleanup for stale sessions.

## Workflows
- `n8n/workflows/price_check_and_alert.json`
- `n8n/workflows/price_update_handler.json`
- `n8n/workflows/session_cleanup_cron.json`

## Required env vars
- `KIOTVIET_CLIENT_ID`
- `KIOTVIET_CLIENT_SECRET`
- `KIOTVIET_RETAILER`
- `ZALO_OA_ACCESS_TOKEN`

## pricing_rules configuration
Table columns used:
- `rule_type`: `product`, `supplier`, `category`
- `rule_key`: product code or supplier code or category name
- `margin_percent`
- `rounding_rule`: `none`, `round_100`, `round_500`, `round_1000`
- `priority` and `is_active`

Selection order in workflow:
1. product rule by product code
2. supplier rule by supplier code
3. category rule by category
4. category `DEFAULT`

## Rounding rules
- `none`: ceil to integer VND
- `round_100`: ceil to nearest 100
- `round_500`: ceil to nearest 500
- `round_1000`: ceil to nearest 1000

## Alert logic
For each mapped item:
- `new_cost = converted_unit_price`
- `expected_min = round(new_cost * (1 + margin_percent/100), rounding_rule)`
- If `current basePrice < expected_min`, item is added to alert list.

Workflow sends interactive options:
- `✅ Update suggested` -> `PRICE_CONFIRM`
- `🔒 Keep` -> `PRICE_KEEP`
- `✏️ Custom` -> `PRICE_CUSTOM`

## Price update handler behavior
- `PRICE_CONFIRM`: PUT `/products/{id}` with `basePrice=suggested`.
- `PRICE_KEEP`: no update, log keep decision.
- `PRICE_CUSTOM`: set `waiting_for_custom_price`, prompt user for numeric input.
- Custom input validation:
  - must be numeric and > 0
  - invalid input is rejected with retry prompt.

## Retry/backoff hardening
`PUT Product Price with Retry` uses exponential backoff on KiotViet failures:
- retries for `429` and `5xx`
- backoff: 1s, 2s, 4s, 8s (max 4 attempts)

## Session cleanup cron
`session_cleanup_cron`:
- schedule every 15 minutes
- resets expired sessions to `idle`
- clears context and expiry fields

## Manual test procedure
1. Seed product cache with a product:
   - `cost=10000`, `base_price=10500`, category `Bia`
2. Configure pricing rule for `Bia`:
   - margin 15%, rounding `round_100`
3. Execute `price_check_and_alert` with mapped item using `converted_unit_price=10000`.
4. Verify alert message is sent and session state becomes `waiting_for_price_confirm`.
5. Trigger `price_update_handler` with:
   - `action=PRICE_CONFIRM` -> verify KiotViet base price updated to suggested.
6. Trigger again with `action=PRICE_CUSTOM`, then send invalid custom text (e.g., `abc`) -> rejected.
7. Send valid numeric custom price -> update succeeds.
8. Let session expire and run cleanup cron -> state resets to `idle`.

## Validation SQL
```sql
-- Check pricing session states
SELECT zalo_user_id, session_state, expires_at, updated_at
FROM user_sessions
WHERE session_state IN ('waiting_for_price_confirm', 'waiting_for_custom_price')
ORDER BY updated_at DESC;

-- Audit cleanup and price decisions
SELECT supplier_code, status, created_at, parsed_data
FROM invoice_log
WHERE supplier_code IN ('session_cleanup', 'pricing_decision')
ORDER BY created_at DESC
LIMIT 50;
```

## Rollback / manual revert
- Revert code commit in git.
- If incorrect prices were pushed to KiotViet, manually edit product basePrice in KiotViet admin UI (Products > Select Product > Edit price > Save).
