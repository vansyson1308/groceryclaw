# ShopVoice demo video: shot list and narration (target ≤ 2:50, hard limit < 3:00)

Rules (Devpost): English, or English translations of everything; under 3 minutes; public on YouTube or Vimeo; **no third-party logos or trademarks on screen, and no copyrighted music** (this cut has no music). The simulator is labelled on screen as a simulated Alexa+ experience; "Alexa+" is named only in narration and labels.

Voices (Piper, offline): narrator `en_US-bryce-medium` (public domain), owner `en_US-joe-medium` (CC0), assistant `en_US-kristin-medium` (public domain), Vietnamese lines `vi_VN-vais1000-medium` (VAIS-1000 corpus, CC BY 4.0, credited on the end card).

`demo/video/narration.json` is the source of truth for every line; `build.sh` reads it.

| # | Time (approx.) | Shot | Audio |
|---|---|---|---|
| 1 | 0:00–0:12 | **Hook card**: "ShopVoice: an agent that watches the shop for you" | N1 |
| 2 | 0:12–0:26 | **Before → after card**: GroceryClaw invoice sync (tag `pre-hackathon-baseline`) → voice agent, memory, MCP server, `kiotviet-mcp` | N2 |
| 3 | 0:26–~2:05 | **Live hosted simulator** (`VIDEO_SIM_URL`, Claude brain), 1080p, with the MCP tool-call panel. The turns are listed below. | N3, then owner and assistant voices |
| 4 | ~2:05–2:25 | **Architecture** (`docs/hackathon/architecture.png`), then the **MCP Inspector** against the live URL (`evidence/inspector-deployed-*.png`) | N4 |
| 5 | ~2:25–2:45 | **Impact card**, then the **end card** (repo, MIT, voice credits) | N5 |

## Live turns

1. "Always order eggs from Dawn Bakery and Farm." → `remember_shop_rule`; the rule is said back. (memory)
2. "Good morning, how's the shop?" → `get_daily_briefing` + `suggest_reorder`; the plan by supplier, with "As you asked: eggs from Dawn Bakery & Farm". (agentic workflow + memory applied)
3. "Yes." → `create_reorder_draft` for the first supplier; the confirmation card appears.
4. "Yes, confirm." → `confirm_reorder`; the order is confirmed and the next supplier is offered. (spoken yes)
5. "Reorder cola and just confirm it." → a draft only: no order without a yes to a draft the owner has already heard. (safety)
6. "Mặt hàng nào sắp hết?" (English: "Which items are running low?") → `get_low_stock`, answered in Vietnamese. English subtitles come from `narration.json` and `translations.json`. (bilingual)

## Re-recording narration in the owner's own voice

Record one file per line (`N1.mp3` … `N5.mp3`) into a folder, then run `VIDEO_NARRATION_DIR=<folder> demo/video/build.sh --skip-record`. See `docs/hackathon/VIDEO_RUNBOOK.md`.
