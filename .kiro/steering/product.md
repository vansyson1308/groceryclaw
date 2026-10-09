---
inclusion: always
---

# Product: ShopVoice (GroceryClaw)

ShopVoice lets the owner of a small grocery or convenience store run the shop by voice: "What's running low?", "How were sales today compared to last Friday?", "Reorder milk and eggs", "Yes, confirm", "Did the Sunrise Beverages invoice arrive?".

- **The MCP server** (`apps/mcp-server`) is a self-hosted Model Context Protocol server: spec 2025-11-25, Streamable HTTP at `/mcp`, bearer auth per tenant, Postgres with row-level security (RLS).
- **The Alexa+ simulator** (`apps/alexa-sim`) is a web app that plays the voice assistant. Its server is a real MCP client: it sends `initialize`, `tools/list` and `tools/call` to the MCP server over Streamable HTTP. A Claude agent (Anthropic API) picks the tools; an offline rules brain is the fallback.
- **Users.** Independent shop owners, starting in Vietnam (KiotViet POS); Vietnamese "tạp hóa" stores. The demo shop is fictional and priced in USD for English-speaking judges.
- **Context.** Entry in the Build, Ship, Shape: Amazon Developer Hackathon, Alexa+ track. Judges must be able to open a hosted demo without an account.

## Rules every change must keep

1. **Honesty.** No AWS runtime service is deployed or used: the AWS account is unavailable. Never write docs, UI text or comments claiming Bedrock, Polly, CloudFront, EC2 or any AWS runtime ran. `infra/aws` and the Bedrock/Polly adapters stay as "implemented, not deployed".
2. **Confirmation safety.**
   - A reorder is two steps: `create_reorder_draft`, then `confirm_reorder`.
   - The confirmation token is held by the simulator host, never shown to the model, never logged and never spoken.
   - `confirm_reorder` runs only after the host's own code matches a spoken "yes".
3. **Tenant isolation.**
   - Every tenant-scoped query runs inside `runTenantScopedTransaction` (it sets `app.current_tenant`). Never bypass RLS.
   - The app's runtime DB role must not be a superuser and must not have `BYPASSRLS`.
4. **Secrets come from environment variables only.**
   - Commit `.env.example`, never `.env`.
   - Never print, log or commit a token or password. Tokens are stored only as SHA-256 hashes.
5. **Rate limits, Origin validation and the audit log stay on**, in every environment.
6. **No payment features in this repo.** Payments belong to a separate project.
7. **Branding.** No Amazon or Alexa logos, Echo imagery or third-party trademarks in the UI. The words "Alexa+" in text are fine. Demo products and suppliers are fictional ("Sunrise Beverages", "Green Valley Dairy & Eggs").
8. **Voice answers** are at most 35 words and use only numbers returned by tools.
