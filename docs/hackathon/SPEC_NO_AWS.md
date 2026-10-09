# SPEC_NO_AWS: finishing ShopVoice without an AWS account

Written 2026-10-09 (M0). Supersedes the AWS parts of `SPEC.md` §3–§4 for the rest of the hackathon.
Why: the owner's AWS account is locked and the appeal failed (BLOCKERS B7). Amazon stopped issuing credit codes on Oct 7.
Rules re-read on 2026-10-09: see `SPEC.md` §0.

## Fixed dates

| Date (2026) | What |
|---|---|
| Oct 15 | Owner runs the Kiro spec and pushes `kiro/hosted-demo` (§M2) |
| Oct 16 | Kiro go/no-go: if no Kiro PR, the agent builds M3 itself and the AWS Builder claim is dropped |
| Oct 19 | Code freeze (also Amazon office hours #2, 9:00 PT) |
| Oct 20 | Video |
| Oct 21 | QC |
| Oct 22 | Owner submits (deadline Oct 23 12:00 PDT = Oct 24 02:00 ICT) |
| Nov 9–20 | Judging period. The project must stay testable until it ends |
| ~Dec 3 | Winners announced. Keep the hosted demo up until then |

## What changes

| Area | Before (AWS plan) | Now |
|---|---|---|
| Simulator brain | Bedrock Converse (never ran), regex `RulesBrain` in the demo | **Claude via the Anthropic API**, rules brain as the per-turn fallback |
| Speech out | Polly (never ran), browser voice fallback | Browser voice (Web Speech API); Piper for the video |
| Hosting | CDK: EC2 + CloudFront (never deployed) | **Render** Blueprint: web service + private Postgres with RLS |
| AWS Builder | Bedrock/Polly runtime | **Kiro Crew** as the development tool (rules: "qualifies on its own") |
| `infra/aws`, Bedrock/Polly adapters | Demo path | Kept in the repo, labelled "implemented, not deployed: AWS account unavailable" |

## Milestones

**M1. Claude brain (agent, Oct 9–12).**
- Port `claude-brain.ts` from `shopvoice-pay` (same author, MIT; credited in `NOTICE`) into `apps/alexa-sim`, Anthropic provider only.
- Model: `claude-sonnet-5-5` at low effort, or `CLAUDE_MODEL=haiku` → `claude-haiku-4-5-20251001`. Opus is refused.
- Brain selection: `SIM_BRAIN=claude|rules|bedrock`. The default is `claude` when `ANTHROPIC_API_KEY` is set, otherwise `rules`.
- Fallback to the rules brain on error, on a timeout over 8 s, or when the budget is spent. The UI shows an "offline brain" badge.
- Cost guard: per-IP and global limits, `CLAUDE_DAILY_TURN_CAP` (400), `CLAUDE_MAX_TOKENS`.
- Prompt rules: answers ≤35 words, and only numbers that came from tools.
- The tool panel shows tool, arguments and latency.
- Tests are offline with a stubbed client. Evals with the real API (`scripts/demo/evals_claude.mjs`, ≥20 utterances, adversarial cases) need the owner's key.

**M2. Kiro work (owner with agent support, Oct 10–16).**
- The agent writes `.kiro/steering/{product,tech,structure}.md` and `.kiro/specs/hosted-demo/{requirements,design,tasks}.md` (EARS), plus `KIRO_RUNBOOK.md` in Vietnamese.
- The owner runs the tasks in Kiro Crew on Windows. Commits carry `Built-with: Kiro` and go on the `kiro/hosted-demo` branch, then a PR.
- The agent reviews, fixes in separate commits, and merges with `v2-ci` green.

**M3. Hosted demo on Render (Oct 16–18).**
- One public web service serves the simulator at `/` and the MCP endpoint at `/mcp` (bearer auth).
- A private Postgres service (`pserv`) holds the data under an RLS runtime role. Managed Render Postgres has no superuser, and migration 004 needs one for `BYPASSRLS`; same reason as D13.
- The demo data reseeds itself daily, relative to today.
- Estimated cost: about $14–22/month (web $7, plus pserv $7 + 1 GB disk, plus an optional second web service), within the $25/month cap.
- Evidence: e2e 5/5, Inspector, and p50/p95 latency, all measured against the deployed URL, plus a note on cold start.

**M4. Docs and honesty sweep (Oct 17–19).**
- Update the README diagram (live path: voice → simulator (Claude) → MCP Streamable HTTP → MCP server → Postgres RLS).
- Update `DEVPOST_SUBMISSION.md`, `FRICTION_LOG.md` (add real Kiro and Alexa+ entries), `AWS_SERVICES.md`, `BUILT_DURING_HACKATHON.md`, `EVIDENCE.md` and `NOP_BAI.md`.
- Grep sweep for bedrock, polly, cloudfront and "deployed on aws".

**M5. Video (Oct 20).** ≤2:55, English, Piper or browser voice, `.srt`, a 3:2 thumbnail, no AWS claims, no trademarks.

**M6. QC (Oct 21).** `FINAL_QC.md`: a rules checklist with evidence, a self-score, a clean-clone run and a hosted smoke run.

## Out of scope for this pass

- The Claude-connector (OAuth) host from #27. The code stays; the Devpost text stops pointing at an undeployed host.
- Payments of any kind. Those belong to `shopvoice-pay`, a separate entry.
- Any new AWS account.
