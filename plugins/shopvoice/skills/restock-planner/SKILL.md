---
name: restock-planner
description: Plan and place a restock for a grocery or convenience store. Use when the user asks what to reorder, wants to order more of something (milk, eggs, drinks...), asks for a purchase order for a supplier, or says to restock before the weekend.
---

# Restock planner

Turn the shop's stock and sales into a purchase-order draft, and confirm it only with the owner's explicit approval. ShopVoice records orders in the shop's own purchase records; it never pays suppliers or moves money.

## Pick the path

- **The user asked to order specific products or restock a supplier** ("order more milk and eggs", "restock the dairy supplier", "đặt thêm sữa"): call `create_reorder_draft` **right away**, before any other ShopVoice tool. Pass `items` with the product names they gave (and `qty` if they gave one), or `supplier` if they named only a supplier. A draft places nothing, and it already contains the suggested quantities, so there is no need to look up stock first. Then continue at **Confirm**.
- **The user asked what they should reorder** ("what do I need to order?"): call `suggest_reorder` (with `supplier` if they named one) and show one small table per supplier: product, on hand, days of cover, suggested quantity, and the supplier total. Ask whether to draft it or adjust anything. When they agree, call `create_reorder_draft` and continue at **Confirm**.

If `create_reorder_draft` says a product name is ambiguous or not found, ask the user to pick from the candidates, then draft again.

## Confirm

1. Summarise the draft: supplier, items, quantities and total. Say it is **not placed yet** and that the draft expires in 5 minutes. End with a direct yes/no question, for example "Place this order with Green Valley Dairy & Eggs for about $210?"
2. Call `confirm_reorder`, with the `confirmation_token` from the draft, **only after an explicit yes in a later user message** ("yes", "confirm", "place it", "đồng ý", "xác nhận"). Never confirm in the same turn as the draft. If the user says no or asks for changes, do not confirm; draft again with the changes.
3. Report the outcome from the tool result: confirmed (with the total), already confirmed, or expired. If it expired, offer a fresh draft.

## Rules

- Suggested quantities come from sales history: (supplier lead time + 7 days) × average daily sales − stock on hand, rounded up to the pack size. Explain this if the user asks.
- Use the currency and units the tools return. For Vietnamese conversations write amounts as `1.250.000 ₫`.
- If ShopVoice answers that the connection is read-only, explain that order permissions were not granted when connecting, and that the user should reconnect ShopVoice and allow "create and confirm purchase-order drafts".
