# SPEC 01 — "ShopVoice": Alexa+ MCP server for small grocery owners

| | |
|---|---|
| Hackathon | Build, Ship, Shape: Amazon Developer Hackathon — https://amazonappdev2026.devpost.com/ |
| Primary track | **Alexa+** (1st $25,000 cash + $15,000 AWS credits; 2nd $15,000; 3rd $4,000) |
| Mini challenges (stack on same project) | **AWS Builder** ($5,000 + $5,000 credits) and **Open Source** ($5,000 + $5,000 credits) |
| Base repo | https://github.com/vansyson1308/groceryclaw (TypeScript monorepo, npm workspaces, Postgres 16 + RLS) |
| Submission deadline | **Oct 24, 2026 03:00 GMT+8 (= 02:00 Vietnam time, Oct 24)**. Internal target: code freeze Oct 20, submit Oct 22 |
| Demo video | **REQUIRED** — under 3 minutes, public YouTube or Vimeo, in English (see §9) |

---

## 0. Owner actions (Việc anh Sơn phải tự làm — agent KHÔNG làm được)

1. **License decision**: repo hiện chưa có LICENSE. Spec mặc định: thêm **MIT** và để repo public (bắt buộc cho Open Source mini challenge). Nếu anh muốn private thì phải mời 6 reviewer của Amazon lúc nộp bài (xem §10).
2. Cấp cho agent: AWS account (IAM user/role có quyền Bedrock + Lambda/App Runner + Polly), region `us-east-1`; bật model access cho **Amazon Nova** (và Anthropic Claude trên Bedrock nếu có).
3. Xin **$150 AWS credits** qua form trên trang Resources của cuộc thi.
4. Tự upload video lên YouTube (public), điền form Devpost, bấm Submit.
5. (Tuỳ chọn) Nếu có quyền truy cập Alexa+ Preview cho developer thì kết nối MCP server với Alexa thật; không có thì dùng đường "simulated Alexa+ web app" (được luật cho phép).

---

## 1. Context for the coding agent

- Read `CLAUDE.md`, `ARCHITECTURE_V2.md`, `README.md` of groceryclaw first and follow their conventions (raw `node:http`, strict TS, NodeNext ESM, `node:test`, tenant RLS via `runTenantScopedTransaction` in `packages/common/src/pg.ts`).
- The repo today: supplier-invoice ingestion (Telegram/Zalo → OCR via OpenAI → map to KiotViet products → purchase orders). Tables are invoice/supplier-centric. **There is no local stock-level or sales data** (`product_cache` has no quantity).
- Hackathon rule: "If your project existed before the hackathon, a clear explanation of what you built or changed during the submission window." Submission window started **Sep 1, 2026**. Everything in this spec is new work → keep a precise record (§11).

## 2. Product one-liner

**ShopVoice** lets an independent grocery / convenience-store owner run the shop by voice through Alexa+: *"Alexa, what's running low?"*, *"How did we do today compared to last Friday?"*, *"Reorder milk from my usual supplier."*, *"Did the Coca-Cola invoice arrive?"*. It is exposed as a **self-hosted MCP server (Streamable HTTP, MCP spec 2025-11-25)**, the open standard that powers Alexa+ integrations, backed by the existing groceryclaw data plane.

Judging criteria to optimize (all equal): **Tech Implementation** (correct, spec-compliant MCP), **Design** (coherent voice UX), **Potential Impact** (real small-shop pain), **Quality of the Idea** (creative use of Alexa+ / MCP).

## 3. Scope

### In scope (MVP — must ship)
1. New app `apps/mcp-server` — MCP server over Streamable HTTP.
2. New data: stock levels, reorder thresholds, daily sales, supplier lead times (migration + realistic demo seed).
3. Voice-first tool design (short, speakable answers + structured data).
4. Safe write actions with explicit confirmation (reorder = two-step).
5. **Alexa+ simulator web app** (`apps/alexa-sim`): push-to-talk voice UI, an agent on **Amazon Bedrock (Strands Agents SDK or Bedrock Converse tool-use)** that connects to the MCP server as a client, speaks with **Amazon Polly**.
6. AWS deployment (MCP server publicly reachable over HTTPS).
7. Tests, docs, demo video pipeline, Devpost submission text.

### Stretch (only if MVP done by Oct 16)
- Proactive morning briefing tool (`get_daily_briefing`) usable as an Alexa+ routine.
- KiotViet live pull: `GET /products?includeInventory=true` and `GET /invoices` via existing `apps/worker/src/kiotviet-adapter.ts`.
- Vietnamese-language answers (`locale` param) — the underlying product is Vietnamese-market.
- Agent Skill packaging (SKILL.md) of the same capabilities.

### Out of scope
- Changing the invoice OCR pipeline, Telegram flows, admin app.
- Real payments.

## 4. Architecture

```
[Owner voice] → Alexa+ (real, if Preview access)  ─┐
                                                    ├─ Streamable HTTP (MCP 2025-11-25) ─→ apps/mcp-server ─→ Postgres (RLS, tenant-scoped)
[Owner voice] → apps/alexa-sim (browser mic)        │                                          └→ KiotViet adapter (stretch)
                  → Bedrock agent (Nova/Claude) ────┘
                  → Amazon Polly (speech out)
```

- `apps/mcp-server`: package `@groceryclaw/mcp-server`, depends on `"@groceryclaw/common": "file:../../packages/common"`, `tsconfig.json` extends `../../tsconfig.base.json`, add reference in root `tsconfig.build.json`, own `Dockerfile`, add service `mcp-server` to `infra/compose/v2/docker-compose.yml`.
- Use the official **`@modelcontextprotocol/sdk`** (latest version) `McpServer` + `StreamableHTTPServerTransport`. Verify the installed SDK negotiates protocol version **`2025-11-25`**; if it does not, upgrade or document the gap. This is the first third-party runtime SDK in the repo — justify it in `IMPLEMENTATION_DIRECTION_LOG.md`.
- Endpoint: `POST/GET/DELETE /mcp` (single endpoint, session via `Mcp-Session-Id` header), `GET /healthz`, `GET /readyz`.
- Auth: OAuth 2.1 bearer per MCP authorization spec is ideal; MVP acceptable = static bearer token per tenant (`MCP_TENANT_TOKENS` → hash lookup in DB), validate `Origin` header, bind to tenant, every DB call through `runTenantScopedTransaction`. Never log tokens.
- `apps/alexa-sim`: small web app (static HTML/TS served by `node:http`, no heavy framework needed). Browser mic → Amazon Transcribe streaming **or** Web Speech API (fallback) → server route `/api/turn` → Bedrock agent loop with MCP client tools → text answer → Polly `SynthesizeSpeech` → audio playback. UI shows: transcript, tool calls made (name + args + latency), spoken answer, confirmation cards for write actions. Styled like a smart-speaker/Echo Show card UI but with **no Amazon logos** (trademark rule).

## 5. Data model (new migration `db/v2/migrations/017_v2_inventory_sales.sql`)

All tables tenant-scoped with RLS policies identical in style to existing tables (copy pattern from `006_v2_mapping_sync_tables.sql` / `016_v2_miniapp_support.sql`), plus rollback script in the same style as existing ones.

| Table | Key columns |
|---|---|
| `stock_levels` | tenant_id, sku (FK-ish to `product_cache`), on_hand_qty numeric, unit, updated_at, source (`kiotviet`/`manual`/`seed`) |
| `reorder_rules` | tenant_id, sku, min_qty, reorder_qty, preferred_supplier_code, lead_time_days |
| `sales_daily` | tenant_id, sale_date, sku, qty_sold, revenue_vnd bigint, revenue_display_currency |
| `purchase_order_drafts` | id uuid, tenant_id, supplier_code, lines jsonb, status (`draft`/`confirmed`/`sent`/`cancelled`), created_via (`voice`), confirmation_token, expires_at |
| `voice_audit_log` | tenant_id, tool_name, args_redacted jsonb, result_summary, latency_ms, created_at |

Demo seed `db/v2/seed/002_demo_shop_seed.sql`: one tenant "Corner Mart Demo", ~60 products (milk, eggs, bread, instant noodles, soft drinks, rice, fish sauce, snacks…), 5 suppliers, 90 days of sales with weekday seasonality + a weekend spike + 4 items deliberately below `min_qty`, 3 recent supplier invoices (reuse `canonical_invoices`). Seed must be deterministic (fixed random seed) so the demo video is reproducible. Update `scripts/v2/db_v2_seed.mjs` to optionally load it (`--demo`).

## 6. MCP tools (voice-first contract)

Every tool returns **both**: `content[0].text` = one or two short spoken sentences (≤ 35 words, numbers rounded, no tables) **and** `structuredContent` matching a declared `outputSchema` (zod). Use tool `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`). Inputs validated with zod; unknown product names resolved with fuzzy match (reuse `apps/miniapp/src/routes/search.ts` `searchProducts` logic).

| Tool | Type | Purpose |
|---|---|---|
| `get_low_stock` | read | Items at/below `min_qty`, sorted by days-of-cover (on_hand / avg daily sales 14d) |
| `get_stock_level` | read | On-hand for a product name/barcode, with days-of-cover |
| `get_sales_summary` | read | Revenue + units for `today`/`yesterday`/`this_week`/date range, compare to same weekday last week |
| `get_top_movers` | read | Top/bottom N products by units or revenue in a period |
| `get_invoice_status` | read | Latest supplier invoices from `canonical_invoices` (arrived / mapped / synced) |
| `suggest_reorder` | read | Per supplier: suggested qty = cover target (lead_time + 7 days) × forecast − on_hand, rounded to pack size |
| `create_reorder_draft` | write (non-destructive) | Creates `purchase_order_drafts` row, returns spoken summary + `confirmation_token` |
| `confirm_reorder` | write (destructive) | Requires `confirmation_token` from the previous step, not expired (5 min); marks confirmed (stretch: sends to KiotViet `POST /purchaseorders` via existing adapter; MVP: status `confirmed` only) |
| `get_daily_briefing` | read (stretch) | 3-sentence morning summary: yesterday's sales, low-stock count, pending invoices |

Also expose one MCP **prompt** (`morning_briefing`) and one **resource** (`shop://profile` — shop name, currency, timezone).

Design rules: never read long lists aloud (max 3 items, then "and 5 more — want the full list on your phone?"); always say units; money in the shop's display currency; if ambiguous product → ask a clarifying question via the text answer.

## 7. AWS usage (for the AWS Builder mini challenge — document every service)

- **Amazon Bedrock**: agent brain in `apps/alexa-sim` (Converse API with tool use, or **Strands Agents SDK** with its MCP client). Default model: an Amazon Nova model; make model ID configurable (`BEDROCK_MODEL_ID`).
- **Amazon Polly** (neural voice) for speech output; **Amazon Transcribe** streaming for speech input if time permits (else Web Speech API).
- Hosting: `apps/mcp-server` + `apps/alexa-sim` on **AWS App Runner** or **ECS Fargate**, Postgres on **RDS** (or a small EC2 with docker compose if credits are tight). Provide IaC in `infra/aws/` (AWS CDK in TypeScript preferred) and a one-command deploy script `scripts/aws/deploy.sh`.
- Optional: **Bedrock AgentCore Gateway** in front of the MCP server — only if it does not add risk.
- Write `docs/hackathon/AWS_SERVICES.md`: service → what for → file path where it is called. The Devpost feedback field must be filled from this file.

## 8. Quality gates (Definition of Done)

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all green; new tests in `tests/v2/mcp-*.test.mjs` cover: each tool happy path, tenant isolation (tenant A cannot read tenant B), confirmation-token expiry, invalid input, spoken text ≤ 35 words.
- [ ] Protocol conformance: test with **MCP Inspector** (`npx @modelcontextprotocol/inspector`) against the deployed URL; save screenshots to `docs/hackathon/evidence/`.
- [ ] An automated e2e script `scripts/demo/e2e_voice_flow.mjs` runs the 5 demo utterances end-to-end (text in → Bedrock → MCP → answer) and asserts expected tool calls.
- [ ] p95 tool latency < 800 ms on seed data (log in `voice_audit_log`).
- [ ] No secrets in repo; `.env.example` files updated; `docs/ops/SECRETS.md` updated.
- [ ] README section "ShopVoice (Alexa+ MCP)" with 5-minute local quickstart: `make v2-up && npm run db:v2:migrate && npm run db:v2:seed -- --demo && npm run start:mcp` (add the `start:mcp`, `start:alexa-sim` scripts and the `--demo` seed flag — they do not exist yet).

## 9. Demo video — REQUIRED

Rules: **< 3:00**, public on YouTube or Vimeo, **English**, lead with the best part (judges may stop at 3:00), **no third-party trademarks or copyrighted music/footage** (no Alexa logo, no Amazon Echo product shots unless owned footage; use royalty-free or no music).

Agent must build the video pipeline so the owner only uploads:
- `demo/video/script.md` — shot list + narration text (below).
- `demo/video/record.mjs` — Playwright (Chromium at `/opt/pw-browsers/chromium` if in the cloud sandbox) with `recordVideo` driving `apps/alexa-sim` through the scripted utterances (use pre-recorded utterance audio or typed input with visible "listening" state).
- Narration via **Amazon Polly** (`demo/video/narration/*.mp3`) — doubles as AWS usage.
- `demo/video/build.sh` — ffmpeg: concatenate clips + narration + burned-in English subtitles (`.srt`) + title card + end card with repo URL → `demo/video/shopvoice_demo.mp4` (1080p, H.264).

Storyboard (target 2:40):
| Time | Shot |
|---|---|
| 0:00–0:15 | Hook: shop owner problem ("hands full, 200 SKUs, reorders on paper") — title card |
| 0:15–1:30 | Live voice flow in the simulator: "What's running low?" → "How were sales today vs last Friday?" → "Reorder milk and eggs" → spoken summary → "Yes, confirm" → confirmation card. Tool-call panel visible |
| 1:30–2:05 | Architecture diagram (MCP Streamable HTTP ↔ Alexa+; Bedrock, Polly, App Runner/RDS); show MCP Inspector listing tools |
| 2:05–2:30 | Impact + safety: two-step confirmation, tenant isolation, audit log |
| 2:30–2:40 | End card: repo URL, open-source license, "Built during Build, Ship, Shape" |

## 10. Devpost submission checklist (agent prepares text in `docs/hackathon/DEVPOST_SUBMISSION.md`)

- [ ] Project description (what it does, how it works, how built, challenges, what's next).
- [ ] GitHub repo URL — public with **MIT LICENSE** at root. (If owner chooses private: add collaborators `chris-trag, knmeiss, giolaq, anishamalde, mosesroth, emersonsklar` + share with testing@devpost.com **at submit time** — invitations expire after 7 days.)
- [ ] Repo must actually call the track tech in code: MCP server entry point + MCP config; README points to them.
- [ ] Demo video URL.
- [ ] Track: Alexa+. Mini challenges: AWS Builder + Open Source.
- [ ] **Product feedback** for every tool/API/SDK used (MCP SDK, Bedrock, Polly, Transcribe, App Runner, Alexa+ docs): used for / worked well / needs work / onboarding / would build again. Keep a running `docs/hackathon/FEEDBACK_LOG.md` during development.
- [ ] **Friction log** (optional, up to +10% judging bonus — DO IT): for each friction: task, steps, expected vs actual, severity, workaround, suggestion. File `docs/hackathon/FRICTION_LOG.md`, append as issues happen.
- [ ] Optional feature requests (critical / important / nice-to-have).
- [ ] "What was built during the window" section (§11).
- [ ] Open Source mini challenge extra fields: contribution URL, repo URL, GitHub username `vansyson1308`, short description. Plan: extract the KiotViet/grocery MCP tool layer as a **new standalone open-source package** `kiotviet-mcp` (new public repo, MIT) **and/or** open a small docs/example PR to `modelcontextprotocol/typescript-sdk` about Streamable HTTP + tenant auth. PR does not need to be merged.

## 11. Pre-existing project disclosure

- Before any change: `git tag pre-hackathon-baseline <current main HEAD>` (last commit is 2026-03-31, before the Sep 1 window) and push the tag.
- Work on branch `feat/shopvoice-alexa-mcp`, small conventional commits, merge to `main` via PR.
- Generate `docs/hackathon/BUILT_DURING_HACKATHON.md` from `git diff --stat pre-hackathon-baseline..main` + human summary: new apps, migration, seed, tests, infra.

## 12. Milestones

| Date (2026) | Deliverable |
|---|---|
| Sep 26–28 | Baseline tag, migration 017 + demo seed, `apps/mcp-server` skeleton passing Inspector handshake |
| Sep 29–Oct 4 | All read tools + tests; reorder two-step flow |
| Oct 5–10 | `apps/alexa-sim` + Bedrock agent + Polly; e2e script |
| Oct 11–15 | AWS deploy (CDK), auth hardening, latency pass |
| Oct 16–19 | Stretch items, OSS extraction/PR, docs, feedback + friction logs |
| Oct 20 | Code freeze; record video |
| Oct 21–22 | Owner uploads video, submits on Devpost |
