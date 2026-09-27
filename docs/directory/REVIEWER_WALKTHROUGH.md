# ShopVoice: reviewer walkthrough

Five prompts a reviewer can paste into Claude once ShopVoice is connected, with what each should return. The reviewer account uses a **demo shop with sample data**, regenerated every day from a fixed catalogue. The product names, low-stock items, invoices and reorder quantities below are therefore the same on any day. Sales amounts depend on the weekday.

Connect first: **Customize → Connectors**, then ShopVoice (or **Add custom connector** with the server URL from `SUBMISSION_KIT.md`), then **Connect**. Sign in with the reviewer credentials and select **Allow**. Then turn ShopVoice on in the chat from **+ → Connectors**.

| # | Prompt | Tools Claude should call | Expected result |
|---|---|---|---|
| 1 | Give me my shop briefing for today. | `get_daily_briefing` | Three facts:<br>• yesterday's sales in USD, with the % change against the same weekday last week;<br>• **4** products at or below minimum stock, most urgent **White Sandwich Bread**;<br>• **2** supplier invoices not yet synced to the POS. |
| 2 | What's running low in my shop? | `get_low_stock` | A table of **4** products, most urgent first: White Sandwich Bread (6 loaf, min 20), Fresh Milk 1L (13 carton, min 28), Chicken Eggs 10-pack (11 tray, min 24) and Cola 330ml Can (47 can, min 108), with days of cover and supplier. |
| 3 | How were sales yesterday compared to the same day last week? And what were my top 5 products by revenue over the last 7 days? | `get_sales_summary`, `get_top_movers` | Yesterday's revenue and units with the comparison and % change. Then a top-5 table led by the beer, milk and rice lines, for example Lager Beer 24-Can Case, Lager Beer 330ml Can, Fresh Milk 1L, Jasmine Rice 5kg and Chicken Eggs 10-pack; the order can shift by weekday. |
| 4 | Did the Sunrise Beverages invoice arrive? Has it been synced? | `get_invoice_status` | Invoice **SRB-10442** from Sunrise Beverages, dated today, 4 lines, about $93, status **matched to products, not yet synced** to the point-of-sale system. |
| 5 | Reorder milk and eggs from the dairy supplier. Then, after reviewing the draft: Yes, confirm it. | `create_reorder_draft`, then `confirm_reorder` | Step 1 creates a draft for **Green Valley Dairy & Eggs**: **120 cartons of Fresh Milk 1L** and **90 trays of Chicken Eggs 10-pack**, about **$210**, marked not placed yet, with a token valid for 5 minutes.<br>Step 2: Claude **asks for permission** before `confirm_reorder`, because it is marked destructive. After approval, it reports 1 purchase order confirmed, about $210, with **no payment made**. |

## Things worth checking

- **Read vs write:** 7 tools are read-only and run without prompts. `create_reorder_draft` is a write. `confirm_reorder` is destructive, so Claude always asks first.
- **Read-only consent:** disconnect, reconnect, and untick *"Create and confirm purchase-order drafts"* on the ShopVoice consent screen. Prompts 1–4 still work. Prompt 5 makes ShopVoice answer `403 insufficient_scope`, and Claude offers to reconnect with the extra permission.
- **Account page:** `https://<host>/account` lists Claude under *Connected apps*, with a **Revoke** button. It also shows the demo shop and the delete-account form.
- **Isolation:** each account has its own shop. A confirmation token from one account does nothing in another.
- **No conversation data:** ShopVoice receives only tool arguments. The audit log stores redacted arguments for 90 days.
