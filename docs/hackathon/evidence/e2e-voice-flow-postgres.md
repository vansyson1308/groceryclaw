# e2e voice flow against Postgres 16 (RLS-bound app_user), local, 2026-09-26

MCP server: `MCP_DATA_BACKEND=postgres`, connected as `app_user` (`rolbypassrls = false`); demo seed anchored to today; simulator with the offline rules brain.

```
PASS  "What's running low?" -> [get_low_stock] (39 ms)
      Four items are running low: White Sandwich Bread, under a day left; Chicken Eggs 10-pack, under a day left; Fresh Milk 1L, under a day left; and 1 more. Want a reorder draft?
PASS  "How were sales today compared to last Friday?" -> [get_sales_summary] (21 ms)
      So far today: $407 from 637 items. That's 92% of yesterday's full day, $441.
PASS  "Reorder milk and eggs" -> [create_reorder_draft] (26 ms)
      Draft ready: 108 cartons of Fresh Milk 1L and 90 trays of Chicken Eggs 10-pack from Green Valley Dairy & Eggs, about $198. Say "confirm" within 5 minutes to place it.
PASS  "Yes, confirm" -> [confirm_reorder] (15 ms)
      Done. Your order to Green Valley Dairy & Eggs is confirmed: 2 items, about $198.
PASS  "Did the Sunrise Beverages invoice arrive?" -> [get_invoice_status] (19 ms)
      Yes. The Sunrise Beverages invoice SRB-10442 arrived today, $93. It's matched to your products but not synced to KiotViet yet.

brain=rules model=offline-rules-v1 result=PASSED
```

## voice_audit_log rows written by that run (queried as the superuser)

```
      tool_name       | outcome | latency_ms |                                  args
----------------------+---------+------------+------------------------------------------------------------------------
 get_invoice_status   | ok      |          4 | {"limit": 3, "supplier": "sunrise beverages"}
 confirm_reorder      | ok      |          5 | {"confirmation_token": "[redacted]"}
 create_reorder_draft | ok      |         16 | {"items": [{"product": "milk"}, {"product": "eggs"}]}
 get_sales_summary    | ok      |          5 | {"period": "today", "compare_to": "auto", "compare_weekday": "friday"}
 get_low_stock        | ok      |         16 | {"limit": 10}
(5 rows)

```

## Same rows seen by app_user with no tenant context (RLS fails closed)

```
 visible_audit_rows
--------------------
                  0
(1 row)

```
