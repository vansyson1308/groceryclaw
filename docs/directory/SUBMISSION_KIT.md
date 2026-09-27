# ShopVoice: Claude directory submission kit

Each block below is ready to paste into the portal at **https://claude.ai/directory/manage** (**Submit new**). Do the **MCP connector** first, then the **Plugin bundle**, and pair them.

- `node scripts/directory/check_kit.mjs` checks every length limit.
- `node scripts/directory/check_kit.mjs --host <deployed host>` replaces the `SHOPVOICE_HOST` placeholder with the real host throughout this file. It is run once after deploy.
- After that, the only thing to fill in by hand is the reviewer password (see *Test & launch*).

Host: `SHOPVOICE_HOST`. Support contact: `sonnv.hd34@gmail.com`.

---

## Part 1: MCP connector

### 1. Connection

Server URL (Universal URL, the same for every user):
<!-- kit:server_url max=200 -->
```text
https://SHOPVOICE_HOST/mcp
```
Transport: Streamable HTTP. Choose **Universal URL**; do not tick "Users connect to different URLs".

### 2. Tools

These sync from the server, so there is nothing to type. Expect **7 read-only** tools and **2 write** tools, all with titles and hints:
- read-only: `get_daily_briefing`, `get_low_stock`, `get_stock_level`, `get_sales_summary`, `get_top_movers`, `get_invoice_status`, `suggest_reorder`
- write: `create_reorder_draft` (destructiveHint false) and `confirm_reorder` (destructiveHint true)

The server also exposes 1 prompt (`morning_briefing`) and 1 resource (`shop://profile`).

### 3. Listing

Server name (≤ 100):
<!-- kit:name max=100 -->
```text
ShopVoice
```

One-liner (≤ 55; the portal allows 200):
<!-- kit:tagline max=55 -->
```text
Stock, sales and reorders for small grocery shops
```

Description (≤ 2,000):
<!-- kit:description max=2000 -->
```text
ShopVoice lets the owner of a small grocery or convenience store run the shop from a conversation with Claude. Ask how yesterday's sales compare with the same day last week, which products are about to run out, whether a supplier's invoice has arrived and been synced to the point-of-sale system, or what to reorder before the weekend.

What it does:
- Daily briefing: yesterday's sales against the same weekday last week, low-stock count, and invoices waiting to be synced.
- Stock: products at or below their minimum, with days of cover, plus the stock level of any product by name or barcode.
- Sales: revenue and units for any period, comparisons, and the top or slowest sellers.
- Supplier invoices: arrived, matched to products, or synced to the point-of-sale system.
- Reorders in two steps: suggested quantities per supplier, then a purchase-order draft, then a separate confirmation. Claude asks you before confirming. ShopVoice records orders in your shop's own purchase records; it never moves money and never contacts suppliers.

Sign in with a free ShopVoice account. New accounts get a demo shop with realistic sample data (60 products, 90 days of sales, 5 suppliers, 3 invoices), so every tool works right away. Shops that use GroceryClaw can link their real store with an invite code on the ShopVoice account page. You can connect read-only by unticking order permissions on the consent screen.

Built for independent Vietnamese "tạp hóa" and similar stores. Works in English (prices in dollars) or Vietnamese (prices in đồng). Each shop's data is isolated with Postgres row-level security. ShopVoice receives only the tool arguments Claude sends, never your conversation.
```

Categories (pick 1–5 from the portal list, closest matches in this order): **Business operations**, **Data & analytics**, **Productivity**, **Commerce / Retail**, **Finance** (only if no retail/commerce category exists).

Documentation URL:
<!-- kit:docs_url max=200 -->
```text
https://SHOPVOICE_HOST/docs
```
Privacy policy URL:
<!-- kit:privacy_url max=200 -->
```text
https://SHOPVOICE_HOST/privacy
```
Support contact:
<!-- kit:support max=200 -->
```text
sonnv.hd34@gmail.com
```
Icon: upload `apps/mcp-server/public/icon-512.png` (512×512 PNG). It is also served at `https://SHOPVOICE_HOST/icon-512.png`, with an SVG version at `/icon.svg`.

URL slug (permanent once published):
<!-- kit:slug max=60 -->
```text
shopvoice
```

### 4. Use cases

Primary use cases:
<!-- kit:use_cases max=1000 -->
```text
1. Start-of-day briefing for a small grocery or convenience store: yesterday's sales vs the same weekday last week, low stock, and pending supplier invoices.
2. Finding what is running low and how many days of stock are left.
3. Comparing sales between periods and finding the top and slowest sellers.
4. Checking whether a supplier invoice arrived and whether it is matched or synced to the point-of-sale system.
5. Drafting purchase orders per supplier from suggested quantities, and confirming them after the owner approves.
```

What users need before connecting:
<!-- kit:prerequisites max=500 -->
```text
A free ShopVoice account, created in the sign-in window when you connect. A demo shop with sample data is created at sign-up. To use a real store, you also need a GroceryClaw invite code from the shop owner, entered on the ShopVoice account page. No paid plan is needed.
```

Data access: **Reads and writes**. Writes are only purchase-order drafts and confirmations in the shop's own records.

### 5. Company

- Company name: `GroceryClaw` (individual developer project)
- Website: `https://SHOPVOICE_HOST/docs` (source: `https://github.com/vansyson1308/groceryclaw`)
- Primary contact: `sonnv.hd34@gmail.com` (GitHub `vansyson1308`)

### 6. Authentication

- Type: **OAuth 2.0**. ShopVoice supports **Client ID Metadata Documents (CIMD)** and **Dynamic Client Registration (DCR)**. The authorization server metadata advertises `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported`, so Claude selects CIMD; DCR is the fallback.
- Callback: `https://claude.ai/api/mcp/auth_callback` (exact match). Claude Code loopback `http://localhost/callback` and `http://127.0.0.1/callback` are matched on any port.
- PKCE S256 is required. Scopes: `shop.read`, `shop.write`, `offline_access`. Access tokens last 1 hour; refresh tokens rotate, and reusing one revokes the grant.
- It does **not** start without authentication: every tool needs the user's shop, so there is no lazy/mixed auth.

### 7. Data handling

- Underlying API: **our own first-party API**. ShopVoice is GroceryClaw's own service and database. The optional KiotViet point-of-sale sync runs inside GroceryClaw and is not part of the connector's tools.
- Personal health data: **No**.
- Sponsored content: **No**.

### 8. Test & launch

Reviewer instructions (paste, then replace the password placeholder):
<!-- kit:test_instructions max=2000 -->
```text
1. In Claude, go to Customize > Connectors > Add custom connector (or connect ShopVoice from this submission). URL: https://SHOPVOICE_HOST/mcp. Leave the OAuth fields empty; Claude uses its client ID metadata document.
2. Select Connect. In the ShopVoice window, sign in with:
   Email: sonnv.hd34+shopvoice-reviewer@gmail.com
   Password: <<REVIEWER_PASSWORD>>
   This account has a fully populated demo shop (60 products, 90 days of sales, 5 suppliers, 3 supplier invoices, 4 items below minimum stock). The data refreshes daily, so "yesterday" always has sales.
3. On "Allow access to your shop?", keep "Create and confirm purchase-order drafts" ticked and select Allow.
4. In a new chat, turn on ShopVoice (+ > Connectors) and try:
   - "Give me my shop briefing for today."
   - "What's running low in my shop?"
   - "How were sales yesterday compared to the same day last week? And what were my top 5 products by revenue over the last 7 days?"
   - "Did the Sunrise Beverages invoice arrive? Has it been synced?"
   - "Reorder milk and eggs from the dairy supplier." then "Yes, confirm it." (Claude asks permission before confirm_reorder; nothing is paid.)
5. Optional: reconnect with order permissions unticked to see read-only mode (write tools return 403 insufficient_scope). https://SHOPVOICE_HOST/account lists and revokes connected apps.
Expected results for each prompt: https://github.com/vansyson1308/groceryclaw/blob/main/docs/directory/REVIEWER_WALKTHROUGH.md
You can also create your own free account in the sign-in window; it gets its own demo shop.
```

Before ticking "I tested every tool", the owner runs `OWNER_CLAUDE_TEST.md` (custom connector in Claude). MCP Inspector evidence: `evidence/inspector-oauth-*` and `evidence/oauth-smoke-*`.

### 9. Compliance (all seven are required; notes for each)

1. **Directory guidelines**: ShopVoice follows the Software Directory Terms and Policy.
2. **First-party API usage**: the server calls only GroceryClaw's own database and APIs, on the ShopVoice domain.
3. **Financial transactions**: ShopVoice does **not** transfer money or assets. `create_reorder_draft` and `confirm_reorder` only create and confirm purchase-order records inside the shop's own data. There is no payment, no supplier contact, and confirmation is a separate destructive tool that Claude asks the user about.
4. **AI media generation**: none. ShopVoice returns text and structured data only.
5. **Prompt injection**: tool descriptions only say what each tool does. They carry no instructions to Claude and no promotion, and an automated test (`tests/v2/mcp-chat-profile.test.mjs`) lints them.
6. **Conversation data collection**: ShopVoice receives only tool arguments. It never asks for or stores conversations, memory or files. The tool-call audit log keeps redacted arguments for 90 days.
7. **Public documentation**: `https://SHOPVOICE_HOST/docs` (plus `/privacy`, `/terms`, `/support`).

Allowed link URIs: none. ShopVoice does not use `ui/open-link`.

---

## Part 2: Plugin bundle

Submit this after the connector, from the same claude.ai account (GitHub connected under that organization).

### Source
- Repository:
<!-- kit:plugin_repo max=200 -->
```text
vansyson1308/shopvoice-plugin
```
- Plugin path: leave empty. The plugin is at the repository root.
- Branch or tag: `main`.
- Select **Validate**. Fix any **Blocking** finding, push, then **Re-validate**.

### Listing details

These are read from `plugin.json` and `README.md`: name `shopvoice`, display name **ShopVoice**, and the description and README from the repo. To change them, edit those files, push, and validate again.

### Data handling answers
- Reads or stores personal data? **The plugin itself stores nothing.** Its skills use the ShopVoice connector, which reads the user's shop data after they sign in (see the privacy policy).
- Sends data to services other than its declared connectors? **No.** Only the ShopVoice server in `.mcp.json` (`https://SHOPVOICE_HOST/mcp`).
- How long it keeps data: **The plugin keeps nothing.** Server-side retention is in `https://SHOPVOICE_HOST/privacy`.
- Intended for people under 18? **No.**

### Compliance
- Contact email: `sonnv.hd34@gmail.com`. Tick all four acknowledgements.

### Review and submit
- How new versions reach the directory: keep **GitHub push webhook** (requires admin on the repo).
- **Pairing:** after both submissions exist, open the connector listing and pair it with the `shopvoice` plugin bundle. The plugin's `.mcp.json` uses the same URL as the connector, so users see one set of tools.
- Publish each listing when the portal shows it as **Approved** or passing. Do not call it "listed" or "published" before the portal shows **Published**.
