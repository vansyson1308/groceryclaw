# Hosted smoke (deployed)

Measured 2026-10-22T21:12:48.247Z from outside Render with `node scripts/demo/hosted_smoke.mjs`.

- Simulator: https://shopvoice-78h7.onrender.com
- MCP endpoint: https://shopvoice-mcp-78h7.onrender.com/mcp

| Check | Result | Detail |
|---|---|---|
| simulator /healthz | PASS | 1154 ms to first 200 (1 attempt(s)) |
| MCP server /healthz | PASS | 332 ms to first 200 |
| voice flow 5/5 (brain claude, claude-sonnet-5-5) | PASS | ok 2856 ms, ok 4072 ms, ok 3982 ms, ok 3896 ms, ok 4453 ms |
| judge token: initialize negotiates 2025-11-25 | PASS | HTTP 200, 2025-11-25 |
| judge token is read-only: create_reorder_draft refused | PASS | HTTP 403 |
| judge token is read-only: confirm_reorder refused | PASS | HTTP 403 |
| judge token: tools/list | PASS | 12 tools |
| read-tool latency p95 < 800 ms | PASS | p50 256 ms, p95 286 ms, n=70 |

## Voice flow

- "What's running low?" → [get_low_stock] in 2856 ms: Four items are running low. White Sandwich Bread, Fresh Milk 1L and Chicken Eggs 10-pack each have under a day left, and Cola 330ml Can is the fourth. Want a reorder draft?
- "How were sales today compared to last Friday?" → [get_sales_summary] in 4072 ms: So far today you've made $304 from 482 items. That's 68% of last Friday's full-day total of $448, and the day isn't over yet.
- "Reorder milk and eggs" → [create_reorder_draft] in 3982 ms: The draft from Green Valley Dairy & Eggs is 120 cartons of Fresh Milk 1L and 90 trays of Chicken Eggs 10-pack, about $210. Do you want me to confirm it?
- "Yes, confirm" → [confirm_reorder] in 3896 ms: Your order to Green Valley Dairy & Eggs is confirmed: 2 items, about $210. Want me to draft the bread or the cola next?
- "Did the Sunrise Beverages invoice arrive?" → [get_invoice_status] in 4453 ms: Yes, the Sunrise Beverages invoice SRB-10442 arrived today, for $93. It's matched to your products but isn't synced to KiotViet yet.
