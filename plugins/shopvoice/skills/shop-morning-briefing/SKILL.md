---
name: shop-morning-briefing
description: Daily briefing for a grocery or convenience store owner. Use when the user asks how the shop is doing today, wants a morning or end-of-day rundown, asks what needs attention in the shop, or opens the day at their store (tạp hóa, cửa hàng) and wants the key numbers.
---

# Shop morning briefing

Give the owner a short, trustworthy start-of-day picture using the ShopVoice connector. Every number must come from a ShopVoice tool result; never estimate or invent figures.

## Steps

1. Call `get_daily_briefing`. It returns yesterday's sales compared with the same weekday last week, the number of products at or below minimum stock (with the most urgent one), and how many supplier invoices are not yet synced to the point-of-sale system.
2. If the low-stock count is above zero, call `get_low_stock` with `limit` 5 to name the most urgent products and their days of cover.
3. If invoices are waiting, call `get_invoice_status` to say which suppliers they are from and what state each is in.
4. Reply with at most five short bullets, in this order:
   - Sales: yesterday's revenue and the change against the same weekday last week (say "up" or "down" and the percentage).
   - Low stock: how many products, then the 2–3 most urgent with days of cover, for example "Fresh Milk 1L: under 1 day left".
   - Invoices: which ones need action (matched but not synced, or arrived but not matched).
   - One suggested next step, such as "Want me to plan a restock for the dairy supplier?". Do not create or confirm any order in this skill; hand over to the restock planner only if the user agrees.

## Style

- Answer in the user's language. For Vietnamese, write amounts as `1.250.000 ₫` and dates as `dd/mm`; for English, use the shop's currency as returned (for example `$387.28`).
- Keep it scannable: no tables unless the user asks, no repetition of raw JSON.
- If a tool fails, say which part is unavailable and give the rest; do not guess the missing part.
- If ShopVoice asks the user to connect or sign in, tell them to connect the ShopVoice connector and try again.
