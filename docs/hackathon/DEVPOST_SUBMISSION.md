# Devpost submission: ShopVoice

Everything below is ready to paste into the Devpost form. Items marked **[OWNER]** need a value only the owner has, such as a video URL or deployed URL.

> **Honesty note for the owner:** as of 2026-09-25 the Bedrock and Polly code paths had not run with real AWS credentials (BLOCKERS.md B2). The demo and tests used the offline brain and voices. After running `scripts/aws/deploy.sh` and `scripts/aws/smoke.sh`, update the sentences marked ⚠️ and the "Try it out" links.

---

## Project name
ShopVoice

## Tagline (short description)
Run a small grocery shop by voice: an Alexa+ MCP server that answers "what's running low?", compares today's sales, and places two-step, voice-confirmed reorders.

## Track and mini challenges
- **Track:** Alexa+
- **Mini challenges:** AWS Builder, Open Source

## Links
- **Repository:** https://github.com/vansyson1308/groceryclaw (MIT license at the root, after owner confirmation B5). ShopVoice lives in `apps/mcp-server`, `apps/alexa-sim`, `infra/aws` and `oss/kiotviet-mcp`, and the README section "ShopVoice (Alexa+ MCP)" points to the MCP entry point and client config.
- **Demo video:** [OWNER] YouTube URL (public, 2:31, English)
- **Try it out:** [OWNER] `SimulatorUrl` and `McpUrl` from `infra/aws/cdk-outputs.json` after `scripts/aws/deploy.sh`. Share the simulator access code and MCP bearer token privately in the "testing instructions" field.

---

## About the project (description)

### Inspiration
Vietnam has well over a million small "tạp hóa" grocery and convenience shops. The owner is usually the cashier, stock clerk and buyer at once, standing behind a counter with both hands busy. They know roughly what's low, but reorders happen on paper, from memory, often too late. GroceryClaw already automated their *supplier invoices* (photo, XML or Excel → KiotViet POS). ShopVoice gives them what they actually ask for all day: **answers by voice, and orders they never have to type.**

### What it does
The owner just talks:
- *"What's running low?"* → "Four items are running low: White Sandwich Bread, under a day left; Fresh Milk 1L, under a day left; Chicken Eggs 10-pack, under a day left; and 1 more. Want a reorder draft?"
- *"How were sales today compared to last Friday?"* → "So far today: $304 from 482 items. That's 68% of last Friday's full day, $448."
- *"Reorder milk and eggs."* → "Draft ready: 120 cartons of Fresh Milk 1L and 90 trays of Chicken Eggs 10-pack from Green Valley Dairy & Eggs, about $210. Say 'confirm' within 5 minutes to place it."
- *"Yes, confirm."* → "Done. Your order to Green Valley Dairy & Eggs is confirmed: 2 items, about $210."
- *"Did the Sunrise Beverages invoice arrive?"* → "Yes. The Sunrise Beverages invoice SRB-10442 arrived today, $93. It's matched to your products but not synced to KiotViet yet."

"Milk" matches four products, but only one is running low, so the reorder picks that one. For a plain stock question, ShopVoice asks "which one?" instead of guessing.

### How it works
- **ShopVoice is a standard MCP server.** It uses Streamable HTTP and negotiates protocol **2025-11-25**, verified with the official MCP Inspector. That means Alexa+ can use it like any other MCP integration.
- **It exposes nine tools:**
  - reads: `get_low_stock`, `get_stock_level`, `get_sales_summary`, `get_top_movers`, `get_invoice_status`, `suggest_reorder`, `get_daily_briefing`;
  - two-step write: `create_reorder_draft` then `confirm_reorder`;
  - plus a `morning_briefing` prompt and a `shop://profile` resource.
- **Every tool honours a voice-first contract:**
  - `content[0].text` is one or two sentences, 35 words at most, with rounded numbers and units, and never more than 3 list items;
  - `structuredContent` matches the declared `outputSchema`, so screens can show the details;
  - tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) tell the assistant which calls are safe.
- **Data:** Postgres 16 with row-level security, one tenant per shop. Each call runs in `runTenantScopedTransaction` and is written to `voice_audit_log`. Reorder suggestions use cover target = (supplier lead time + 7 days) × the 14-day average, minus on hand, rounded up to the pack size.
- **Voice simulator:** a push-to-talk web app for people without Alexa+ Preview access. A Bedrock Converse tool-use agent (Amazon Nova 2 Lite) acts as the MCP client, and Amazon Polly speaks the replies. A side panel shows every MCP call with its arguments and latency, and a confirmation card shows each reorder draft.

### How we built it
- **Stack:** TypeScript on Node 22, raw `node:http` (no web framework), `@modelcontextprotocol/sdk` 1.30.1, zod 4.
- **Data:** a new migration (017) and a deterministic demo seed ("Corner Mart Demo": 60 products, 5 suppliers, 90 days of sales with a weekend spike).
- **Clients:** the AWS SDK v3 for Bedrock Converse and Polly, and Playwright for the video pipeline.
- **Infrastructure:** AWS CDK for EC2, CloudFront, SSM Parameter Store, IAM and CloudWatch Logs.
- **Tests:** `node:test` throughout. They cover protocol negotiation, auth, Origin checks, rate limits, the tool contracts, the 35-word rule, RLS isolation, confirmation-token expiry, simulator safety and the end-to-end voice flow.

### Safety by design
- **Two-step writes.** The draft token expires after 5 minutes and is stored only as a SHA-256 hash. Confirming twice is a no-op.
- **The LLM never sees the token.** The simulator host holds it and injects it into `confirm_reorder` only when the owner's current words are an explicit yes. A model that tries to confirm early is blocked by the host (there's a test for this).
- **Tenant isolation.**
  - Bearer tokens are hashed and resolved by a SECURITY DEFINER function.
  - MCP sessions are bound to their tenant.
  - Forced RLS covers every new table.
  - Another tenant's token gets "session not found".
- **Transport hardening.**
  - Origin allow-list against DNS rebinding.
  - Per-tenant and per-IP rate limits.
  - A secret CloudFront origin header, so the host can't be reached around HTTPS.
  - Errors are spoken as short, friendly sentences, never stack traces.

### Challenges we ran into
- **App Runner closed to new customers (April 2026), and RDS lacks a true superuser.** The repo's RLS bootstrap role needs `BYPASSRLS`, which requires one. We deployed Postgres, the MCP server and the simulator on one EC2 host behind CloudFront instead, which costs about $20 a month.
- **Designing answers for the ear.** Every tool builds several candidate sentences and speaks the longest one that fits 35 words. Ambiguous names like "milk" resolve by context: in a reorder, pick the one item that needs reordering; otherwise ask.
- **Keeping the demo reproducible.** The seed is deterministic, dates are relative to an anchor, and an in-memory copy of the same shop gives identical spoken answers (a test checks this against Postgres).
- **MCP SDK rough edges on a strict, framework-free Node stack.** Details are in the friction log.

### Accomplishments we're proud of
- Real MCP conformance: the MCP Inspector connects, shows "MCP 2025-11-25", and renders both the spoken text and the schema-checked structured output.
- The whole demo conversation passes as an automated test (`scripts/demo/e2e_voice_flow.mjs`: 5/5).
- Tool latency on the seeded Postgres: **p95 12.8 ms client-side, 8 ms server-side** (160 calls, measured locally on the same host). ⚠️ Replace with the deployed number from `scripts/aws/smoke.sh`.
- A reusable open-source package, `kiotviet-mcp`, that any KiotViet shop can run with Claude Desktop, Alexa+ or its own agent.

### What we learned
MCP is the right seam for voice. The same server serves Alexa+, a Bedrock agent, the MCP Inspector and IDE agents without change. For voice, what the tool returns matters as much as the model: spoken text plus structured data plus annotations turned out to be the contract that keeps answers short and actions safe.

### What's next
- Live KiotViet inventory and invoice pull through the existing worker adapter.
- Sending confirmed drafts to KiotViet `POST /purchaseorders`.
- Vietnamese answers (`locale`).
- Amazon Transcribe streaming input.
- OAuth 2.1 per the MCP authorization spec instead of static tokens.
- An Alexa+ routine for the morning briefing.
- Moving hosting to ECS Express Mode once managed Postgres can host the RLS roles.

## Built with
typescript, node.js, model-context-protocol, mcp-typescript-sdk, alexa-plus, amazon-bedrock, amazon-nova, amazon-polly, aws-cdk, amazon-ec2, amazon-cloudfront, aws-systems-manager, amazon-cloudwatch, postgresql, row-level-security, zod, playwright, ffmpeg, kiotviet-api, docker

---

## Pre-existing project: what was built during the window
ShopVoice is new work on top of an existing repo (GroceryClaw's supplier-invoice pipeline, last pre-window commit `a9f3cdb` on 2026-03-31, tagged `pre-hackathon-baseline`). Everything ShopVoice-related was built during the submission window: the new MCP server, voice simulator, migration 017 and demo seed, AWS CDK stack, the `kiotviet-mcp` open-source package, tests, the video pipeline and docs.

`git diff --shortstat pre-hackathon-baseline..HEAD`: **116 files changed, 14,164 insertions, 85 deletions**. Of these, 113 files and 10,849 insertions are outside lockfiles, and the few deletions are small fixes to pre-existing scripts. Full breakdown: `docs/hackathon/BUILT_DURING_HACKATHON.md`.

---

## Product feedback (per tool / API / SDK)

**MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.30.1)**
- *Used for:* the Streamable HTTP server (`McpServer`, `StreamableHTTPServerTransport` on raw `node:http`) and the client inside the simulator and tests.
- *Worked well:* it negotiates 2025-11-25 out of the box, `registerTool` with `outputSchema` and annotations validates structured output server-side, and `InMemoryTransport` makes unit tests easy.
- *Needs work:*
  - The npm package lacks the `docs/` its README links to.
  - The built-in Origin/Host protection is deprecated in favour of "middleware", but the only middleware examples are for Express and Hono.
  - `StreamableHTTP*Transport` is not assignable to `Transport` under `exactOptionalPropertyTypes`.
  - v1 `sdk` and the v2 split packages are both "latest".
- *Onboarding:* about 20 minutes to a working server; reading the negotiated version needed a trip into `dist/`.
- *Would build again:* yes.

**MCP Inspector 2.8.0**
- *Used for:* conformance evidence (web UI screenshots and CLI JSON).
- *Worked well:* it shows the negotiated protocol, renders structured output separately, and has a schema-portability lint.
- *Needs work:* CLI argument parsing for stdio servers (`-e` placement, flags not forwarded), and the `--web` child process survives SIGTERM to `npx`.
- *Would use again:* yes.

**Amazon Bedrock (Converse API, tool use, Amazon Nova 2 Lite)**
- *Used for:* the simulator's agent brain. MCP tool JSON Schemas are passed straight through as Bedrock `toolSpec.inputSchema.json`.
- *Worked well:* the Converse tool-use message format maps one-to-one onto MCP `tools/call`, with no glue code for schemas. ⚠️ Confirm the live behaviour after deploying.
- *Needs work:* it's easy to confuse cross-region inference profile IDs (`us.amazon.nova-2-lite-v1:0`) with base model IDs, and IAM resources must cover both the profile ARN and the foundation-model ARNs in every routed region.
- *Would build again:* yes.

**Amazon Polly (neural)**
- *Used for:* speaking every assistant reply, and the video narration.
- *Worked well:* a simple `SynthesizeSpeech` to MP3; SSML is not needed for 35-word answers. ⚠️ Confirm the voices after deploying.
- *Needs work:* no concerns yet.

**AWS CDK v2 (2.270.0) + CloudFront + EC2 + SSM**
- *Used for:* one-command deploy and teardown.
- *Worked well:* `httpPutResponseHopLimit` (containers reaching IMDSv2), managed cache/origin-request policies, and environment-agnostic synth without credentials.
- *Needs work:*
  - `requireImdsv2` and metadata options can't be combined; the error explains it, but only at synth time.
  - Forwarding `Authorization` through CloudFront for non-GET methods requires a cache policy with a 1-second max TTL, which is non-obvious for API-style origins.
- *Would build again:* yes.

**AWS App Runner / Amazon RDS for PostgreSQL (evaluated, not used)**
- App Runner no longer accepts new customers (since 2026-04-30).
- RDS can't run the repo's `ALTER ROLE ... BYPASSRLS` (no true superuser). Documented as decision D13.

**Amazon Transcribe:** not used in the MVP; the Web Speech API was enough for push-to-talk. Transcribe streaming is on the roadmap.

**Alexa+:** we had no Preview developer access during the build. We built against the open MCP specification, with a simulator that plays the Alexa+ role. Clear public docs on how Alexa+ discovers and authenticates remote MCP servers (OAuth requirements, allowed origins, timeouts) would help builders test against the real thing earlier.

## Friction log (summary; full log in `docs/hackathon/FRICTION_LOG.md`)

| # | Friction | Severity | Workaround |
|---|---|---|---|
| F1 | MCP SDK docs not shipped in the npm package | low | Read the `.d.ts` files |
| F2 | Origin validation built into the SDK is deprecated, with no raw-Node example | medium | 20-line allow-list check; upstream example PR drafted |
| F3 | No AWS credentials in the build sandbox | high | Interfaces plus offline fallbacks |
| F4 | SDK transports not assignable to `Transport` under `exactOptionalPropertyTypes` | low | Cast, with a comment |
| F5 / F6 | Docker Hub rate limits and blocked apt mirrors | medium | ECR Public base images; an ops image built without apt |
| F7 | Inspector 2.x CLI argument order for stdio | low | Env switch |
| F8 | Nullable outputs emitted as JSON Schema type arrays (portability warnings) | low | Accepted (valid JSON Schema) |

## Feature requests
- **Critical:** a public Alexa+ developer sandbox, or a test harness for remote MCP servers (auth flow, timeouts, how spoken output is rendered), usable without Preview access.
- **Important:**
  - MCP SDK: a framework-agnostic `validateOrigin` / host-check helper, and bearer-auth middleware for `node:http`.
  - Bedrock: a documented pattern and sample for "MCP server as Converse tools".
  - An option to emit `anyOf` for nullable outputs.
- **Nice to have:**
  - CloudFront: a managed "API passthrough" cache policy that forwards `Authorization` for all methods.
  - Polly: a per-request speaking rate hint for "assistant" style voices.

---

## Open Source mini challenge fields
- **Contribution URL:** [OWNER] `https://github.com/vansyson1308/kiotviet-mcp` once created (`oss/kiotviet-mcp/` in this repo, ready to push). Optional second contribution: the drafted SDK example PR in `docs/hackathon/oss/typescript-sdk-example/` (open it and paste the PR URL).
- **Repository URL:** https://github.com/vansyson1308/groceryclaw
- **GitHub username:** vansyson1308
- **Short description:** `kiotviet-mcp` is an MIT-licensed, voice-first MCP server for shops on the KiotViet POS. It reports low stock, stock levels, sales and top movers, and makes two-step purchase orders (nothing is sent to KiotViet until an explicit confirm). It runs over stdio or Streamable HTTP (MCP 2025-11-25) and works with Alexa+, Claude or any MCP client. It was extracted from ShopVoice during the hackathon.

## Testing instructions for judges
1. **Quickest, no install:** open [OWNER: SimulatorUrl], enter the access code [OWNER: share privately], and hold the mic button (Chrome) or type. Try: "What's running low?", "How were sales today compared to last Friday?", "Reorder milk and eggs", "Yes, confirm", "Did the Sunrise Beverages invoice arrive?".
2. **MCP Inspector against the live server:**
   ```
   npx @modelcontextprotocol/inspector --cli [OWNER: McpUrl] --transport http --header "Authorization: Bearer [OWNER: token]" --method tools/list
   ```
3. **Local run, no cloud:** README → "ShopVoice (Alexa+ MCP)" → quickstart B (in-memory, about 1 minute).
