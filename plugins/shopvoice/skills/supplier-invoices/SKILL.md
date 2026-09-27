---
name: supplier-invoices
description: Supplier invoice follow-up for a grocery or convenience store. Use when the user asks whether a supplier's invoice or delivery arrived, whether invoices are matched or synced to the point-of-sale system, what paperwork is missing, or wants to chase a supplier.
---

# Supplier invoices

Tell the owner which supplier invoices arrived, what state each is in, and what still needs doing.

## Steps

1. Call `get_invoice_status`. Pass `supplier` with a supplier name, category or product word when the user mentions one (for example "Sunrise Beverages" or "drinks"); use `limit` up to 10 for a wider list.
2. Explain each invoice's status in plain words:
   - **Arrived, not matched yet:** the invoice is in GroceryClaw but some lines are not linked to products. The owner should match them in the GroceryClaw app.
   - **Matched, not synced to POS:** all lines are matched, but stock has not been pushed to the point-of-sale system (KiotViet). The owner should run the sync in GroceryClaw.
   - **Synced to POS:** nothing left to do.
3. If the user expected an invoice that is not listed, say it has not arrived in GroceryClaw yet and offer to draft a short, polite follow-up message to the supplier. Write the message only as text for the user to send; ShopVoice does not contact suppliers.

## Style

- Lead with the direct answer ("Yes, SRB-10442 from Sunrise Beverages arrived today"), then the status and next step.
- Answer in the user's language; for Vietnamese write amounts as `1.250.000 ₫` and dates as `dd/mm`.
- Use invoice numbers, dates and totals exactly as returned.
