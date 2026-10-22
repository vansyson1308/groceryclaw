# Devpost submission: ShopVoice (paste-ready)

Every section below maps to one Devpost form field (SPEC.md §0). Every value comes from an evidence file. The **⟪OWNER⟫** marker flags the one value only the owner can supply (the YouTube link after upload); replace it before pasting.

**Honesty rule for this text:** every number comes from a file in `docs/hackathon/evidence/`. Nothing AWS ran: the AWS code is labelled "implemented, not deployed: AWS account unavailable".

---

## Project name
ShopVoice

## Tagline
A voice agent that watches a corner shop for its owner: a morning briefing, a reorder plan that remembers their habits, and nothing bought without a spoken "yes". Underneath is a standard MCP server that any assistant can use.

## Track and mini challenges
- **Track:** Alexa+ (simulated Alexa+ experience plus a self-hosted MCP server, spec 2025-11-25, Streamable HTTP)
- **Mini challenges:** Open Source. (AWS Builder is not claimed: see `AWS_SERVICES.md`.)

## Links
- **Try it (no account):** https://shopvoice-78h7.onrender.com. It is labelled on the page as a simulated Alexa+ experience.
- **MCP endpoint:** https://shopvoice-mcp-78h7.onrender.com/mcp, with the read-only judge token `shopvoice-public-judge-token-read-only-2026` (see Testing instructions).
- **Repository:** https://github.com/vansyson1308/groceryclaw (MIT). Start with the README section "ShopVoice in 60 seconds".
- **Demo video:** ⟪OWNER: YouTube URL after upload⟫
- **Evidence index:** https://github.com/vansyson1308/groceryclaw/blob/main/docs/hackathon/EVIDENCE.md
- **Open-source package:** https://github.com/vansyson1308/kiotviet-mcp

---

## About the project

### Inspiration
Vietnam has more than a million family-run "tạp hóa" corner shops. The owner is cashier, stock clerk and buyer at once, usually with both hands busy behind the counter. They know roughly what is running low, but reorders happen from memory, on paper, often too late, and they always forget the one rule they care about ("eggs come from the farm supplier, not the dairy").

Before the hackathon, our project GroceryClaw automated one painful thing for them: turning supplier invoices (photo, XML, Excel) into the KiotViet point-of-sale system. During the hackathon we gave them what they actually ask for all day: **a shop they can run by voice, with an agent that watches it for them.**

### What it does
The owner talks, the agent acts:
- **Morning check.** *"Good morning, how's the shop?"* The agent chains three steps in one answer: yesterday's sales against the same weekday, what is running low, and a reorder plan grouped by supplier with the total. Then it asks: *"Draft Dawn Bakery & Farm first?"*
- **Supplier by supplier.** Each *"yes"* drafts one supplier's order; a second *"yes, confirm"* places it, and the agent offers the next supplier from the plan.
- **Shop memory across days.** *"Always order eggs from Dawn Bakery & Farm."* The agent repeats the rule back and applies it from then on, saying so: *"As you asked: eggs from Dawn Bakery & Farm."*
  - It learns only from explicit statements. *"What do you remember?"* lists the rules, and *"Forget that"* deletes one.
  - Supported rules: preferred supplier, an order cap ("never more than 40 eggs"), items to skip, and the usual order day (mentioned in the morning briefing).
- **Everyday questions:**
  - *"How were sales today compared to last Friday?"*
  - *"Did the Sunrise Beverages invoice arrive?"*
  - *"How many eggs do we have?"* For an ambiguous product it asks "which one?" instead of guessing.
- **Vietnamese.** *"Mặt hàng nào sắp hết?"* gets a Vietnamese answer from the same tools with the same safety rules. *"Có, xác nhận"* confirms; *"Đơn này bao nhiêu tiền?"* is a question, so it never confirms.
- **Safety.** Nothing is ever ordered without an explicit spoken yes to a draft the owner has already heard. The model never sees the confirmation token.
- **MCP Apps view.** In hosts that render MCP Apps, `suggest_reorder` comes with an interactive plan (`ui://shopvoice/reorder-plan`): one table per supplier with editable quantities, and "Draft" then "Confirm" buttons. Hosts without MCP Apps keep the spoken answer, which is complete on its own. We checked the view in a sandboxed-iframe host harness (`evidence/mcp-app-reorder-plan.png`); the voice simulator does not render it.

### Before → after
| | Before the hackathon (tag `pre-hackathon-baseline`, Mar 31) | After (Oct 23) |
|---|---|---|
| What the owner does | Sends invoice photos to a chat bot; GroceryClaw syncs them into KiotViet | Runs the shop by voice: morning briefing, reorder plan, memory of their rules, two-step orders |
| Interface | Telegram/Zalo chat, one message at a time | A simulated Alexa+ voice experience; any MCP assistant |
| Data | Invoices and product mapping | + stock levels, daily sales, suppliers, drafts, audit log, shop memory (migrations 017–020, all RLS) |
| Integration surface | None for assistants | A standard MCP server (12 tools, a prompt, a resource), plus the MIT `kiotviet-mcp` package |
| Hosting | Self-hosted compose / Kubernetes manifests | A public demo on Render with a read-only judge token |

### How we built it
- **MCP server** (`apps/mcp-server`):
  - TypeScript on Node 22 with raw `node:http` and the official `@modelcontextprotocol/sdk`.
  - Streamable HTTP; negotiates protocol **2025-11-25**.
  - Tools:
    - reads: `get_low_stock`, `get_stock_level`, `get_sales_summary`, `get_top_movers`, `get_invoice_status`, `suggest_reorder`, `get_daily_briefing`, `list_shop_rules`;
    - writes: `create_reorder_draft` → `confirm_reorder` (5-minute hashed token), `remember_shop_rule`, `forget_shop_rule`.
  - Also a `morning_briefing` prompt and a `shop://profile` resource.
  - Every tool returns one or two spoken sentences (35 words at most) plus `structuredContent` matching its declared `outputSchema`, with read-only, destructive and idempotent annotations.
- **Data:**
  - Postgres 16 with row-level security, one tenant per shop. Every call runs in a tenant-scoped transaction and is written to an audit log.
  - The hosted server logs in as a `NOSUPERUSER NOBYPASSRLS` role and refuses to start as anything more privileged.
- **Simulated Alexa+ experience** (`apps/alexa-sim`):
  - A push-to-talk web page (Web Speech API, `en-US` and `vi-VN`) whose server is a real MCP client: initialize, tools/list and tools/call over Streamable HTTP.
  - Claude Sonnet 5.5 (Anthropic API, low effort) plans the tool calls. A deterministic rules brain takes over within the same turn if Claude errors, times out, refuses or the daily budget is spent, so judges never see an error page.
  - A side panel shows every MCP call with its arguments and latency.
- **Host-side safety:**
  - The host holds the confirmation token and injects it only when the owner's own words in this turn are a yes to a draft created in an earlier turn.
  - The host also fills in who is speaking, and the model never sees that field, so one person's rules cannot leak into another's.
- **MCP Apps:** `suggest_reorder` declares `_meta.ui.resourceUri = ui://shopvoice/reorder-plan`. The server serves a self-contained `text/html;profile=mcp-app` view that speaks the MCP Apps postMessage JSON-RPC: `ui/initialize`, `tool-result`, `size-changed`, and proxied `tools/call`. We did not add the `ext-apps` helper package, because its current 2.x line requires the v2 SDK and this server runs SDK 1.x.
- **Hosting:** one Render Blueprint creates:
  - a private Postgres 16 service with a disk;
  - the MCP web service, with a pre-deploy migration and role setup;
  - the simulator web service on the private network;
  - a nightly cron that re-anchors the demo shop to "today", so "last Friday" always has data during judging.
- **Tests:** `node:test` throughout: 271 unit tests plus 69 integration tests against real Postgres and Redis, all run by `v2-ci` on every PR. Covered:
  - protocol negotiation, auth, scopes, Origin checks, rate limits;
  - tool contracts, the 35-word rule, RLS isolation and token expiry;
  - the host's confirmation guard in English and Vietnamese;
  - memory scoping, the morning plan, and the deploy scripts against real Postgres.
- **Claude evals:** 31 conversations, 53 utterances, against the hosted demo. Hard gates: no confirmation without an explicit yes, no rule saved unless the owner stated one, no number spoken that a tool did not return.

### Challenges we ran into
- **Our AWS account was locked, and the appeal failed.** Amazon then ran out of credit codes. We did not open a second account. Instead, we redesigned the live path around what we could run honestly:
  - Claude via the Anthropic API instead of Bedrock;
  - browser speech instead of Polly;
  - Render instead of EC2 and CloudFront.

  The Bedrock, Polly and CDK code stays in the repo, labelled "implemented, not deployed: AWS account unavailable".
- **Managed Postgres has no superuser.** Our RLS bootstrap needs `BYPASSRLS` for a definer-function owner, so Postgres runs as a Render private service. A pre-deploy step creates an RLS-bound runtime role.
- **Voice answers have to be short and true.** Every tool builds candidate sentences and speaks the most detailed one that fits 35 words. The prompt allows only numbers that came from a tool, and the evals check every spoken number.
- **Memory in a shared demo.** One judge saying "skip milk" must not break the next judge's demo. Rules are therefore keyed by the speaker's voice profile, which the host sets and the model never sees.
- **A "yes" in two languages.** "Có đơn nào chưa?" contains "có" (yes) but is a question. The host's confirmation guard learned Vietnamese question particles.

### Accomplishments that we're proud of
- An agentic workflow, not a single-turn Q&A bot: briefing → plan → draft → confirm, supplier by supplier, with memory that persists across days.
- Real MCP conformance: the official MCP Inspector connects to the hosted server, shows protocol 2025-11-25, and runs every read tool with the public read-only token (writes are refused with `403 insufficient_scope`).
- Hosted latency from outside: MCP read tools p50 256 ms, p95 286 ms (n=70); a full voice turn with Claude p50 3.2 s, p95 4.2 s (n=53).
- Claude evals on the hosted demo: safety 53/53, spoken numbers 53/53, tool choice 48/48, e2e 5/5, no fallbacks, about $0.27 for all 53 utterances. A first run on an 8 s budget timed out twice (safety still 53/53); we raised the budget to 11 s and kept both runs in the evidence.

### What we learned
MCP is the right seam for voice. The same server serves a voice simulator, the MCP Inspector and any assistant without change. For voice, the tool's output matters as much as the model: spoken text plus structured data plus annotations is the contract that keeps answers short and actions safe. Safety belongs in the host, not the prompt: the model can propose, but only the owner's own words can confirm.

### What's next
- Live KiotViet inventory and sales through the existing worker adapter, and sending confirmed drafts to KiotViet `POST /purchaseorders`.
- Rendering the MCP Apps reorder view inside the simulator too, next to the voice answer.
- A real Alexa+ integration once partner access opens.
- Vietnamese spoken directly by the tools (today Claude translates them).
- Moving the hosting back to AWS when an account is available; the CDK stack is already written.

## Built with
typescript, node.js, model-context-protocol, mcp-typescript-sdk, mcp-inspector, claude, anthropic-api, web-speech-api, postgresql, row-level-security, render, zod, playwright, ffmpeg, piper, kiotviet-api, docker

---

## Testing instructions for judges
No account and nothing to install.

1. **Hosted simulator:** open https://shopvoice-78h7.onrender.com. Click a suggested phrase under the text box, type, or hold the mic button in Chrome. Then try:
   - "Good morning, how's the shop?" → "Yes" → "Yes, confirm";
   - "Always order eggs from Dawn Bakery & Farm", then "What should I reorder?";
   - "Mặt hàng nào sắp hết?" in Vietnamese.

   The right-hand panel shows every MCP call. The demo shop resets every night at 00:05 Vietnam time.
2. **MCP Inspector against the hosted server** (read-only judge token):
   ```bash
   JUDGE=shopvoice-public-judge-token-read-only-2026   # public on purpose: read-only scope
   npx @modelcontextprotocol/inspector --cli https://shopvoice-mcp-78h7.onrender.com/mcp --transport http \
     --header "Authorization: Bearer $JUDGE" --method tools/list
   ```
   The judge token can call every read tool, but `create_reorder_draft` and `confirm_reorder` return `403 insufficient_scope`, so the shared demo cannot be changed through it.
3. **Run it locally in a minute** (Node 20+):
   ```bash
   git clone https://github.com/vansyson1308/groceryclaw && cd groceryclaw
   npm ci && npm run build
   export MCP_DEMO_TOKEN=$(openssl rand -hex 24)
   MCP_DATA_BACKEND=memory node apps/mcp-server/dist/server.js &
   SIM_MCP_TOKEN=$MCP_DEMO_TOKEN node apps/alexa-sim/dist/server.js   # open http://localhost:8091
   ```
   Without `ANTHROPIC_API_KEY` it uses the offline rules brain; export a key to use Claude.
4. **Scripted checks:**
   - `node scripts/demo/hosted_smoke.mjs --sim-url … --mcp-url … --judge-token …` checks cold start, the voice flow, the protocol version, read-only enforcement and latency;
   - `npm run demo:e2e` runs the 5-utterance flow locally.

---

## Product feedback (one block per tool; answers to the form's five questions)

**MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.30.1)**
- *Used for:* the Streamable HTTP server on raw `node:http` (`McpServer`, `StreamableHTTPServerTransport`) and the MCP client inside the simulator.
- *Worked well:*
  - It negotiates 2025-11-25 out of the box.
  - `registerTool` takes `outputSchema` and annotations and validates structured output server-side.
  - The client's `listTools`/`callTool` made the simulator's MCP client about 80 lines.
- *Needs work:*
  - The npm package lacks the `docs/` its README links to (F1).
  - Built-in Origin/Host protection is deprecated in favour of "middleware", with examples only for Express and Hono (F2).
  - Transports are not assignable to `Transport` under `exactOptionalPropertyTypes` (F4).
  - There is no convention for a per-call end-user identity, so multi-speaker hosts must invent one (F16).
- *Onboarding (zero to hello world):* about 20 minutes to a working server; reading the negotiated version needed a trip into `dist/`.
- *Would build again:* yes. It is the reference implementation, and the strict schemas caught real bugs.

**MCP Inspector (2.8.0)**
- *Used for:* conformance evidence against the local and hosted servers (CLI JSON and web UI screenshots).
- *Worked well:* it shows the negotiated protocol version, renders `structuredContent` separately from the text, and has a useful schema-portability lint.
- *Needs work:*
  - CLI argument order for stdio servers (F7).
  - Nullable outputs trigger 19 portability warnings even when valid (F8).
  - `--web` leaves a child process behind after SIGTERM to `npx`.
- *Onboarding:* 5 minutes with `--cli`.
- *Would build again:* yes. It is the fastest way to prove a server is spec-compliant.

**Anthropic API / Claude Sonnet 5.5 (`@anthropic-ai/sdk` 0.131.0)**
- *Used for:* the simulator's brain: tool planning over the MCP tool list, 35-word spoken answers, Vietnamese answers, at low effort with adaptive thinking.
- *Worked well:*
  - Tool use maps one-to-one onto MCP `tools/call`.
  - Low effort keeps a voice turn quick.
  - `stop_reason: "refusal"` and token usage make an in-turn fallback and a spend guard easy.
  - Prompt caching on the system prompt and tools keeps cost per turn low.
- *Needs work:*
  - Replayed thinking blocks become invalid when a host trims history, and thinking cannot be disabled on Sonnet 5.5. A voice host must strip thinking between turns (F15); an SDK helper for "trim between turns" would help.
  - Per-day spend caps exist only at the organization level, so the app keeps its own counter.
- *Onboarding:* 15 minutes to the first tool call.
- *Would build again:* yes. Its answers stayed inside the 35-word, tool-numbers-only contract on the hosted demo: safety 53/53, spoken numbers 53/53, tool choice 48/48 (`EVIDENCE.md` H2).

**Render (Blueprints, web services, private services, cron jobs)**
- *Used for:* the whole hosted demo from one `render.yaml`: two Docker web services, a private Postgres 16 service with a disk, and a nightly reseed cron.
- *Worked well:*
  - `fromService … property: hostport` wires the private network without hard-coded hosts.
  - `generateValue` and `sync: false` keep every secret out of git.
  - `preDeployCommand` keeps the previous deploy running if migrations fail.
- *Needs work:*
  - Managed Postgres has no superuser, so an RLS bootstrap role cannot be created there (F14).
  - A service's public URL cannot be referenced from another service's env vars, so the MCP URL shown on the page is pasted once by hand.
- *Onboarding:* about 10 minutes from "New → Blueprint" to the first green deploy.
- *Would build again:* yes, for small always-on demos at about $22/month.

**Web Speech API (Chrome)**
- *Used for:* push-to-talk speech input and spoken output in the simulator, in `en-US` and `vi-VN`.
- *Worked well:* zero setup, no keys, and good recognition for short commands.
- *Needs work:* recognition is Chrome-only in practice, and voice lists load asynchronously and differ per OS, so a Vietnamese voice may be missing.
- *Onboarding:* 10 minutes.
- *Would build again:* yes, for demos. For production we would use a server-side speech service.

**Piper (offline neural TTS)**
- *Used for:* the demo video's narration, with public-domain or CC0 voices, so no cloud TTS account was needed.
- *Worked well:* fast on a CPU, deterministic, and good enough voices.
- *Needs work:* brand names, acronyms and money need a pronunciation pass (F12), and there is no SSML.
- *Onboarding:* 20 minutes including voice download.
- *Would build again:* yes, for video narration.

**AWS services:** no AWS runtime service is used, and the AWS Builder mini challenge is not claimed. Bedrock, Polly and the CDK stack are implemented, not deployed: AWS account unavailable.

---

## Friction log (full entries in `docs/hackathon/FRICTION_LOG.md`)

Each row: task → expected vs actual, severity, workaround, suggestion.

| # | Friction | Severity | Workaround | Suggestion |
|---|---|---|---|---|
| F2 | Validating `Origin` on Streamable HTTP: the SDK's built-in option is deprecated and only Express/Hono middleware exists | medium | A 20-line allow-list check before `handleRequest` | Export a framework-agnostic `validateOrigin(req, allowList)` |
| F4 | `StreamableHTTPServerTransport` is not assignable to `Transport` with `exactOptionalPropertyTypes` | low | Cast with a comment | Declare optional handlers as `T \| undefined` and type-test with that flag |
| F11 | Playwright `recordVideo` ran 1.13x slower than wall-clock time, and frames froze during CPU spikes | medium | Rescale timestamps, pre-synthesize audio, keep-alive animation | Expose real frame timestamps and document that output is not real-time |
| F12 | Offline TTS misread brand names, acronyms and money ("dollar two hove and ten") | medium | A voice-only text normalizer, steadier settings, Whisper QA with re-takes | A per-request lexicon or SSML `<say-as>` |
| F13 | GitGuardian flagged fake, URL-encoded test credentials twice ("Generic Password", then "Username Password") | medium | Build the fake value at runtime and compare with `encodeURIComponent` | Lower confidence for `tests/` paths and non-resolving hosts |
| F14 | Render managed Postgres has no superuser, so an RLS bootstrap role cannot be created | medium | Postgres as a private service plus a pre-deploy role setup | An elevated-migration option for NOLOGIN `BYPASSRLS` roles |
| F15 | Sonnet 5.5 thinking blocks become invalid when a voice host trims history; thinking cannot be disabled | medium | Strip thinking at the end of each turn | An SDK helper for append-only-within-turn hosts |
| F16 | MCP has no convention for which person is speaking on a shared connection | low–medium | A host-filled `voice_profile` argument hidden from the model | A documented `_meta` key for host-asserted end-user identity |
| F9 | `node --test` runs files in parallel against one shared test DB | medium | `--test-concurrency=1` for DB files | Document per-glob concurrency |
| F10 | A listen-on-0 free-port helper returned the same port twice on CI | low | Remember ports already handed out | Let children bind 0 and report the ports back |
| F17 | First Render deploy: the pre-deploy migration step tried TLS against the private Postgres, which serves plain TCP, and failed with only "see logs" | high | Pass `PGSSLMODE=disable` to the migration child; print the first `Migration failed` line | Say in the private-services guide that the bundled Postgres images serve plain TCP, and show `sslmode=disable` in the Blueprint example |

## Feature requests
- **Critical:** a public Alexa+ developer sandbox, or a test harness for remote MCP servers (auth flow, timeouts, how spoken output is rendered) that entrants can use without partner access. *Why:* every Alexa+ track entrant had to build their own simulator.
- **Important:** an MCP spec convention for host-asserted end-user identity (F16). *Why:* multi-person voice devices need per-speaker memory and permissions.
- **Important:** MCP SDK: a framework-agnostic Origin/Host check and bearer-auth middleware for `node:http`. *Why:* the spec requires Origin validation, and raw-Node servers easily miss it.
- **Nice to have:** Render: reference another service's public URL in a Blueprint env var. *Why:* demos have to show their public MCP URL.

---

## Open Source mini challenge fields
- **Contribution URL:** https://github.com/vansyson1308/kiotviet-mcp
- **Project repository URL:** https://github.com/vansyson1308/groceryclaw
- **GitHub username:** vansyson1308
- **What we did:** we extracted ShopVoice's KiotViet integration into `kiotviet-mcp`, a standalone, MIT-licensed, voice-first MCP server for shops on the KiotViet point-of-sale system, which is widely used by small Vietnamese retailers. First commit 2026-09-25, inside the window; CI green on Node 20 and 22.
- **How it works:**
  - A typed KiotViet Public API client (OAuth client credentials, retries).
  - Seven tools: low stock, stock level, sales summary, top movers, invoice status, reorder draft, confirm. Each returns a short spoken sentence plus structured data.
  - Two-step purchase orders: nothing is sent to KiotViet until an explicit confirm with a hashed, short-lived token.
  - stdio and Streamable HTTP transports, and a built-in demo shop so anyone can try it without a KiotViet account.
- **Why it matters:** any KiotViet shop can now plug its own data into Claude Desktop, an Alexa+-style assistant or any MCP client in minutes, and voice-first output makes it usable hands-free behind a counter.

---

## Pre-existing project: what changed during the window
GroceryClaw existed before the window: supplier-invoice automation into KiotViet, last pre-window commit `a9f3cdb` (2026-03-31, tag `pre-hackathon-baseline`). Everything ShopVoice-related was built during the window; see `docs/hackathon/BUILT_DURING_HACKATHON.md`:

- the MCP server and the simulator;
- migrations 017–020;
- the morning plan, shop memory and Vietnamese support;
- the hosted demo;
- `kiotviet-mcp`.

`git diff --shortstat pre-hackathon-baseline..main` (main at `ba13330`, before the final docs PR): 313 files changed, 36,101 insertions, 1,010 deletions, in 60 commits.
