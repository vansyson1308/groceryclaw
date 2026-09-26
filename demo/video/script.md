# ShopVoice demo video: shot list and narration (target 2:40, hard limit < 3:00)

Rules (Devpost): English, under 3 minutes, public YouTube/Vimeo, **no third-party logos, trademarks on screen, or copyrighted music** (this cut has no music). The simulator UI has no Amazon or Alexa marks; "Alexa+" is only named in narration, to describe the integration.

Voices:
- **Narrator:** Polly `Matthew` (fallback: MBROLA us3).
- **Owner:** Polly `Stephen` (fallback: MBROLA us2).
- **Assistant:** Polly `Joanna` (fallback: MBROLA us1).

The narration lines below are the source of truth. `demo/video/narration.json` holds the same text, and `build.sh` reads that file.

| # | Time (approx.) | Shot | Audio |
|---|---|---|---|
| 1 | 0:00–0:14 | **Title card** (`cards/title.png`): "ShopVoice: run your shop by voice." | N1 |
| 2 | 0:14–1:35 | **Live simulator** (Playwright recording, 1080p). Five spoken turns, with the MCP tool-call panel and the confirmation card visible. | N2 over the first seconds, then owner and assistant voices |
| 3 | 1:35–1:57 | **Architecture** (`docs/hackathon/architecture.png`) | N3 |
| 4 | 1:57–2:10 | **MCP Inspector**: connected, "MCP 2025-11-25", tool result (`docs/hackathon/evidence/inspector-*-connected.png`, `-tool-result.png`) | N4 |
| 5 | 2:10–2:30 | **Safety and impact card** (`cards/safety.png`) | N5 |
| 6 | 2:30–2:40 | **End card** (`cards/end.png`): repo URL, MIT, "Built during Build, Ship, Shape" | N6 |

## Narration

- **N1 (hook):** "A corner grocery owner juggles two hundred products, deliveries and customers, with both hands full and reorders written on paper. ShopVoice lets them run the shop by voice."
- **N2 (demo intro):** "Here is the owner talking to the shop, through an MCP server that Alexa plus can call."
- **Live turns** (owner, then the assistant's reply, which is recorded live from the MCP tools):
  1. "What's running low?"
  2. "How were sales today compared to last Friday?"
  3. "Reorder milk and eggs."
  4. "Yes, confirm."
  5. "Did the Sunrise Beverages invoice arrive?"
- **N3 (architecture):** "ShopVoice is a standard MCP server, speaking the twenty twenty-five eleven twenty-five protocol over streamable HTTP. Alexa plus, or our simulator running an Amazon Bedrock Nova agent with Polly speech, calls nine voice-first tools. Every query runs inside the shop's own row-level-secured Postgres transaction, deployed on AWS with CDK."
- **N4 (conformance):** "The official MCP Inspector connects, negotiates the latest protocol, and gets both a short spoken answer and schema-checked structured data from every tool."
- **N5 (safety and impact):** "Money never moves by accident. Reorders are two steps with a five-minute token that the language model never sees. Tenants are isolated by row-level security, and every call is audited. For millions of small shops, that means less time counting stock and more time with customers."
- **N6 (end):** "ShopVoice. Open source under MIT, built during Build, Ship, Shape."

## What the owner may re-record in their own voice

Any narration line (N1–N6). Record a WAV or MP3 per line into `demo/video/narration/custom/N1.mp3` and so on, then run `VIDEO_NARRATION_DIR=demo/video/narration/custom demo/video/build.sh --skip-record`. See `docs/hackathon/VIDEO_RUNBOOK.md`.
