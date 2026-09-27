# ShopVoice

Run a small grocery or convenience store (a Vietnamese *tạp hóa* or similar) from a conversation with Claude. ShopVoice gives you a daily briefing, tells you what is running low, explains how sales compare with last week, follows up on supplier invoices, and drafts purchase orders that you confirm yourself. It works in Claude chat, Cowork and Claude Code, in English or Vietnamese.

## What's inside

- **Connector:** the ShopVoice MCP server at `https://SHOPVOICE_HOST/mcp` (OAuth sign-in). It reads your shop's stock, sales, suppliers and invoices, and writes purchase-order drafts and confirmations.
- **Skills:**
  - `shop-morning-briefing`: yesterday's sales against the same weekday last week, low stock and pending invoices, in five bullets.
  - `restock-planner`: suggest, then draft, then **your explicit yes**, then confirm. It never confirms an order on its own.
  - `sales-insights`: period comparisons, top and slow sellers, and one or two practical suggestions.
  - `supplier-invoices`: what arrived, what is matched or synced, and what to do next.
- **Commands** (Cowork and Claude Code; in chat they act as skills): `/shopvoice:briefing` and `/shopvoice:restock`.

## Get started

1. Install the plugin, then connect **ShopVoice** from the plugin's **Connectors** tab. In Claude Code, run `/mcp`.
2. Sign in, or create a free ShopVoice account. New accounts get a **demo shop with sample data**, so you can try everything right away. To use your real shop, enter a GroceryClaw invite code on your ShopVoice account page.
3. Ask things like "Give me my shop briefing", "What's running low?", "How were sales yesterday compared to last Friday?", "Did the Sunrise Beverages invoice arrive?" or "Reorder milk and eggs".

## Data and privacy

The plugin itself stores nothing and runs no code. Its skills only tell Claude how to use the ShopVoice connector. When you use it, Claude sends tool requests (for example a product name, a supplier name or a date range) **only to the ShopVoice server at `SHOPVOICE_HOST`**, which returns your shop's data. ShopVoice never receives your conversation, never moves money, and never contacts suppliers. Orders are recorded in your shop's own purchase records, and only after you confirm.

- Privacy policy: https://SHOPVOICE_HOST/privacy
- Terms: https://SHOPVOICE_HOST/terms
- Docs: https://SHOPVOICE_HOST/docs
- Support: https://SHOPVOICE_HOST/support

## License

MIT. Source for the server: https://github.com/vansyson1308/groceryclaw
