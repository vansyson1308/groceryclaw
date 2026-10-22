# Hosted smoke (render-rehearsal-local)

Measured 2026-10-22T15:19:14.621Z from outside Render with `node scripts/demo/hosted_smoke.mjs`.

- Simulator: http://127.0.0.1:18091
- MCP endpoint: http://127.0.0.1:18090/mcp

| Check | Result | Detail |
|---|---|---|
| simulator /healthz | PASS | 30 ms to first 200 (1 attempt(s)) |
| MCP server /healthz | PASS | 6 ms to first 200 |
| voice flow 5/5 (brain rules, offline-rules-v1) | PASS | ok 34 ms, ok 14 ms, ok 16 ms, ok 9 ms, ok 11 ms |
| judge token: initialize negotiates 2025-11-25 | PASS | HTTP 200, 2025-11-25 |
| judge token is read-only: create_reorder_draft refused | PASS | HTTP 403 |
| judge token is read-only: confirm_reorder refused | PASS | HTTP 403 |
| judge token: tools/list | PASS | 9 tools |
| read-tool latency p95 < 800 ms | PASS | p50 12 ms, p95 15 ms, n=21 |

## Voice flow

- "What's running low?" → [get_low_stock] in 34 ms: Four items are running low: White Sandwich Bread, under a day left; Chicken Eggs 10-pack, under a day left; Fresh Milk 1L, under a day left; and 1 more. Want a reorder draft?
- "How were sales today compared to last Friday?" → [get_sales_summary] in 14 ms: So far today: $269 from 420 items. That's 61% of Friday's full day, $439.
- "Reorder milk and eggs" → [create_reorder_draft] in 16 ms: Draft ready: 120 cartons of Fresh Milk 1L and 90 trays of Chicken Eggs 10-pack from Green Valley Dairy & Eggs, about $210. Say "confirm" within 5 minutes to place it.
- "Yes, confirm" → [confirm_reorder] in 9 ms: Done. Your order to Green Valley Dairy & Eggs is confirmed: 2 items, about $210.
- "Did the Sunrise Beverages invoice arrive?" → [get_invoice_status] in 11 ms: Yes. The Sunrise Beverages invoice SRB-10442 arrived today, $93. It's matched to your products but not synced to KiotViet yet.
