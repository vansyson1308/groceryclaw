---
name: sales-insights
description: Sales analysis for a grocery or convenience store. Use when the user asks how sales went on a day, week or month, compares periods ("vs last Friday", "this week vs last week"), asks what sells best or worst, or wants ideas to sell more or reduce slow stock.
---

# Sales insights

Explain what the shop's sales numbers say and suggest one or two practical actions. Use only numbers returned by the ShopVoice connector.

## Steps

1. **Totals.** Call `get_sales_summary` for the period the user means (`today`, `yesterday`, `this_week`, `last_week`, `last_7_days`, `last_30_days`, or `custom` with `start_date`/`end_date`). Keep the default comparison unless the user asked for a specific one; use `compare_weekday` for questions like "compared to last Friday".
2. **Movers.** If the user asks what sells, or the change is notable, call `get_top_movers` with `direction: "top"`, and with `direction: "bottom"` for slow movers. Use `metric: "revenue"` for money questions, `"units"` for volume.
3. **Answer** in three parts, briefly:
   - The headline: revenue and units, and the change versus the comparison period (up or down, percent).
   - What drove it: the top products (and any slow movers) from the tool results.
   - One or two actions phrased as suggestions, for example: stock more of a top seller before the weekend if it is low (check with `get_stock_level` or `get_low_stock`), or bundle or discount a slow mover. Do not claim causes the data cannot show (weather, competitors) unless the user provides them.

## Style

- Answer in the user's language; for Vietnamese write amounts as `1.250.000 ₫`.
- Prefer a short table only for top/bottom lists; otherwise use sentences.
- Periods follow the shop's timezone. A day in progress is partial; say "so far" when the tool marks the period as partial.
