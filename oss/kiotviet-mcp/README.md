# kiotviet-mcp

A voice-first [Model Context Protocol](https://modelcontextprotocol.io) server for shops that run on **KiotViet**, the POS used by a very large number of Vietnamese grocery and convenience stores.

It lets any MCP client (Alexa+, Claude, IDE agents, your own Bedrock agent) answer a shop owner's questions in one spoken sentence:

- "What's running low?"
- "How many cartons of milk do we have?"
- "How were sales yesterday?"
- "What sold best this week?"
- "What should I reorder?" → "Draft it." → "Yes, send it."

Every tool returns two things:
- `content[0].text`: a sentence written to be spoken, at most 35 words, with rounded numbers and units, and never more than 3 list items read aloud.
- `structuredContent`: data that matches the tool's declared `outputSchema`.

Tools carry MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`).

It was extracted from **ShopVoice**, the Alexa+ MCP project in [vansyson1308/groceryclaw](https://github.com/vansyson1308/groceryclaw), built for the *Build, Ship, Shape* Amazon Developer Hackathon. This package has no GroceryClaw dependencies: it talks to the KiotViet Public API directly.

## Tools

| Tool | Type | What it does |
|---|---|---|
| `get_low_stock` | read | Products at or below KiotViet `minQuantity`, most urgent first (days of cover = on hand / 14-day average daily sales) |
| `get_stock_level` | read | On hand plus days of cover for a product name, product code or barcode; asks which one when several match |
| `get_sales_summary` | read | Today, yesterday, the last 7 days or the last 28 days, against the previous equal period (same weekday last week for single days) |
| `get_top_movers` | read | Top or bottom sellers by units |
| `suggest_reorder` | read | (lead time + cover days) × forecast − on hand |
| `create_purchase_order_draft` | write, not destructive | Drafts a purchase order and returns a `confirmation_token` valid for 5 minutes. **Nothing is sent yet.** |
| `confirm_purchase_order` | write, destructive, idempotent | Sends the draft to KiotViet (`POST /purchaseorders`), only with the token |

It also exposes a resource, `shop://profile`. Start with `--read-only` to hide the two purchase-order tools entirely.

## Quick start

```bash
npm install
npm run build

# Try it without KiotViet credentials (built-in demo shop), over stdio:
node dist/cli.js --demo

# Real shop:
export KIOTVIET_CLIENT_ID=... KIOTVIET_CLIENT_SECRET=... KIOTVIET_RETAILER=your-retailer
export KIOTVIET_BRANCH_ID=12345   # optional, used for purchase orders
node dist/cli.js                  # stdio
KIOTVIET_MCP_TOKEN=$(openssl rand -hex 24) node dist/cli.js --http 8787   # Streamable HTTP on 127.0.0.1:8787/mcp
```

### Claude Desktop / any stdio client

```json
{
  "mcpServers": {
    "kiotviet": {
      "command": "node",
      "args": ["/path/to/kiotviet-mcp/dist/cli.js", "--read-only"],
      "env": { "KIOTVIET_CLIENT_ID": "...", "KIOTVIET_CLIENT_SECRET": "...", "KIOTVIET_RETAILER": "..." }
    }
  }
}
```

### Inspect it

```bash
npx @modelcontextprotocol/inspector@2.8.0 --cli node dist/cli.js -e KIOTVIET_MCP_DEMO=1 --method tools/list
```

## How it uses the KiotViet Public API

- **Auth:** `POST https://id.kiotviet.vn/connect/token` (client credentials, scope `PublicApi.Access`). The token is cached until shortly before it expires, and every call sends `Authorization: Bearer …` plus the `Retailer` header.
- **Products:** `GET /products?includeInventory=true` (paged by 100). On hand is summed across branches (`onHand − reserved`), and the minimum stock comes from `minQuantity`.
- **Sales:** `GET /invoices?fromPurchaseDate=…&toPurchaseDate=…` for the last 28 days, aggregated from `invoiceDetails` by product code. Cancelled invoices are skipped.
- **Purchase orders:** `POST /purchaseorders`, and only from `confirm_purchase_order`.

Responses are read defensively, so missing fields fall back to safe defaults. A snapshot is cached for 60 seconds to stay within API rate limits.

## Safety

- Two-step writes. The draft token is random (96 bits), stored only as a SHA-256 hash, expires after 5 minutes, and confirming twice sends nothing new.
- The HTTP mode binds to `127.0.0.1`, requires a bearer token (compared in constant time), and rejects non-loopback browser `Origin`s, which protects against DNS rebinding.
- KiotViet credentials are read from the environment only and never logged.

## Development

```bash
npm test   # builds, then runs node:test against a fake KiotViet API and the demo shop
```

Pinned: `@modelcontextprotocol/sdk` 1.30.1 (MCP protocol 2025-11-25), `zod` 4.6.5, Node ≥ 20.

## License

MIT, see [LICENSE](LICENSE).
