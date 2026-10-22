# ShopVoice: final QC (brief §8)

Run on 2026-10-23 at 04:52 Vietnam time (21:52 UTC Oct 22), by the agent. Every line below says what was run and where its output is. Machine-readable result: [`evidence/final-qc.json`](evidence/final-qc.json), written by `scripts/demo/final_qc.mjs`.

```bash
GITLEAKS_BIN=… node scripts/demo/final_qc.mjs \
  --sim-url https://shopvoice-78h7.onrender.com \
  --mcp-url https://shopvoice-mcp-78h7.onrender.com/mcp
```

## 1. Rules checklist

| Rule | Status | How it was checked |
|---|---|---|
| Public repo with an OSI license (MIT) | PASS | `LICENSE` at the root; `final_qc` |
| Simulator source in the repo, page labelled "Simulated Alexa+ experience" | PASS | `apps/alexa-sim/`; `final_qc` greps the page |
| MCP server on Streamable HTTP, protocol 2025-11-25 | PASS | `final_qc` (code), MCP Inspector against the hosted URL (EVIDENCE H3), judge-token `initialize` from outside |
| Video under 3:00 (brief: at most 2:50), English, 1080p | PASS | 167.7 s (2:48), 1920×1080 H.264 (`evidence/video-report.json`) |
| Video: English subtitles, no music, no third-party marks | PASS | `.srt` with English translations for the Vietnamese lines; the soundtrack is speech only; frames checked by eye (cards, simulator, diagram, Inspector) |
| Video: the simulator is labelled as simulated | PASS | Narration N3 ("A simulated Alexa+ experience") and the label on the page |
| 3:2 thumbnail | PASS | `demo/video/thumbnail.png`, 1800×1200 |
| Hosted demo needs no account | PASS | Simulator is open; MCP uses the public read-only judge token |
| No AWS service presented as running | PASS | `final_qc` honesty scan of the Devpost text; AWS code is labelled "implemented, not deployed: AWS account unavailable" |
| AWS Builder mini challenge | NOT CLAIMED | No Kiro PR at QC time; the owner's go/no-go is Oct 23 10:00 (`AWS_SERVICES.md`) |
| Pre-existing project: changes during the window are separable | PASS | Tag `pre-hackathon-baseline`; `BUILT_DURING_HACKATHON.md`; diff numbers in the Devpost text |

## 2. Clean-clone run

Fresh `git clone https://github.com/vansyson1308/groceryclaw` (main at `ba13330`) into an empty directory:

| Step | Result |
|---|---|
| `npm ci` | exit 0 (252 packages) |
| `npm run build` / `lint` / `format:check` / `sql:guard` | all exit 0 |
| `npm test` | 271/271 unit tests pass; the integration glob has 69 tests, 26 pass and 43 skip without Postgres/Redis, 0 fail |

The 43 skipped tests need a database or Redis. They pass in `v2-ci` on every PR (Postgres, Redis, E2E compose), and locally with Postgres 16 (63 pass; the rest are Redis- or compose-gated).

## 3. Hosted smoke from outside

All requests ran from the agent's cloud sandbox to Render Singapore.

| Check | Result | Evidence |
|---|---|---|
| `hosted_smoke.mjs` | 8/8; 5-phrase voice flow 5/5 on Claude; MCP read latency p50 256 ms, p95 286 ms | `evidence/hosted-smoke-deployed.md` (EVIDENCE H1) |
| `final_qc` hosted checks | both `/healthz` 200; judge token negotiates 2025-11-25; judge token gets 403 on `remember_shop_rule` | `evidence/final-qc.json` |
| Claude evals on the hosted demo (run 2) | safety 53/53, numbers 53/53, tool choice 48/48, e2e 5/5, 0 fallbacks; p50 3181 ms, p95 4245 ms | `evidence/claude-evals-hosted.json` (EVIDENCE H2) |
| MCP Apps view | renders the plan; Draft then Confirm go through `tools/call` | `evidence/mcp-app-reorder-plan.*` (EVIDENCE H5b) |

## 4. Cost guard

| Item | Value | Where |
|---|---|---|
| Render | about $22/month (3 Starter services + 1 GB disk + daily cron), under the $25 cap | `DEPLOY_RENDER.md` |
| Claude per turn (measured) | about $0.005: $0.2747 for 53 hosted turns | `evidence/claude-evals-hosted.json` |
| In-app daily caps | 400 turns or $2 a day, whichever comes first; then the rules brain answers, with a badge | `render.yaml`, `apps/alexa-sim/src/spend-guard.ts` |
| Worst case to Dec 3 | $2/day × 41 days ≈ $82 if judges max out the cap every day; the Anthropic Console spend limit is the hard total cap | owner sets it in the Console |
| Spent tonight on evals and the video | about $0.62 (two eval runs, $0.26 + $0.27, plus two 6-turn recordings) | eval JSON files; recordings estimated at the same per-turn rate |

## 5. Secrets

| Check | Result |
|---|---|
| gitleaks over the full git history (unshallowed clone, 189 commits) | no leaks (`final_qc`) |
| `render.yaml` | no literal secret values: secrets are `sync: false` or `generateValue` |
| GitGuardian on every PR push | green on #29, #30 and #31 |
| Judge token | public by design, read-only scope (403 on every write, checked from outside) |

## 6. Video listening QA

`demo/video/audit_audio.py` (Whisper `small.en`) transcribes every synthesized clip and checks its word error rate (≤ 0.1) and inner pauses. Result: **15/15 English clips pass**. The 2 Vietnamese clips (the owner's question and Claude's answer) are skipped, because an English-only model cannot judge them; their English subtitles come from `narration.json` and `translations.json`. Two fixes came out of this pass: "Cola 330ml Can" was misread (the voice normalizer now says "three hundred thirty milliliter"), and "kiotviet-mcp" got a pronunciation entry. Report: [`evidence/video-audio-audit.json`](evidence/video-audio-audit.json).

## 7. Self-score (1–10 per judging criterion)

| Criterion | Score | Why | Biggest weakness |
|---|---|---|---|
| Tech Implementation | 8 | Spec-compliant MCP 2025-11-25 over Streamable HTTP, verified by the official Inspector against the hosted URL; RLS on every table, per-token scopes, host-held confirmation tokens; 271 unit + 69 integration tests; hosted Claude evals with hard safety gates | Not on a real Alexa+ device; the host is our own simulator |
| Design (voice UX) | 7 | 35-word spoken contract, two-step spoken confirm, per-supplier morning plan, memory said back as "As you asked", English and Vietnamese | A Claude turn takes 3–4 s from Singapore; the simulator speaks with the browser's voice |
| Potential Impact | 7 | A real pain for Vietnam's corner shops; `kiotviet-mcp` lets any KiotViet shop plug in today | The demo runs on a seeded shop, not a live KiotViet account, and there is no pilot shop yet |
| Quality of the Idea | 7 | A morning agent that plans by supplier and remembers explicit rules, with safety enforced by the host rather than the prompt | Alexa+ is simulated; partner access was not available |

**Biggest weakness overall:** judges see a simulator over a demo shop. There is no real Alexa+ integration and no live KiotViet data, and the AWS runtime path never ran (account locked).

## 8. Owner actions before submitting

`final_qc` lists these as owner actions; they are not failures:

1. Upload `shopvoice_demo.mp4` to YouTube as **Public**, then put the link in `DEVPOST_SUBMISSION.md` and `README.md` (the ⟪OWNER⟫ markers). Steps in `NOP_BAI.md`.
2. Kiro go/no-go at Oct 23 10:00. Default: AWS Builder is not claimed.
3. Set (or confirm) the Anthropic Console spend limit.
