# ShopVoice demo video: shot list and narration (target 2:40, hard limit < 3:00)

Rules (Devpost): English, under 3 minutes, public YouTube/Vimeo, **no third-party logos, trademarks on screen, or copyrighted music** (this cut has no music). The simulator UI has no Amazon or Alexa marks; "Alexa+" is only named in narration, to describe the integration.

Voices:
- **Narrator:** Polly `Matthew`; offline, Piper `en_US-bryce-medium`, public domain (last resort: MBROLA us3).
- **Owner:** Polly `Stephen`; offline, Piper `en_US-joe-medium`, CC0 (MBROLA us2).
- **Assistant:** Polly `Joanna`; offline, Piper `en_US-kristin-medium`, public domain (MBROLA us1).

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

- **N1 (hook):** "Picture a corner grocery. Two hundred products, a line of customers, and the owner's hands are always full. Reorders get scribbled on paper, often too late. ShopVoice lets them run the whole shop just by talking."
- **N2 (demo intro):** "Here's the owner, talking to the shop through an MCP server that Alexa+ can call."
- **Live turns** (owner, then the assistant's reply, which is recorded live from the MCP tools):
  1. "What's running low?"
  2. "How were sales today compared to last Friday?"
  3. "Reorder milk and eggs."
  4. "Yes, confirm."
  5. "Did the Sunrise Beverages invoice arrive?"
- **N3 (architecture):** "Under the hood, ShopVoice is a standard MCP server over streamable HTTP. Alexa+, or our own simulator, calls nine voice-first tools. The simulator's agent runs on Amazon Bedrock with Polly speech, plus an offline fallback, which is what you just saw. Every answer comes from the shop's own Postgres data, locked down with row-level security, and one AWS CDK stack ships it all to the cloud."
- **N4 (conformance):** "The official MCP Inspector connects, agrees on the latest protocol, and every tool returns two things: a short answer to speak, and schema-checked data for the screen."
- **N5 (safety and impact):** "And money never moves by accident. Every reorder takes two steps, with a five-minute token that the language model never even sees. Each shop's data is walled off from every other shop, and every call is audited. For millions of small shops, that means less time counting stock, and more time with customers."
- **N6 (end):** "ShopVoice. Open source, MIT licensed, and built during Build, Ship, Shape."

## What the owner may re-record in their own voice

Narration is written as it should appear in subtitles; `demo/video/lib/speakable.mjs` rewrites numbers, money, acronyms and brand names for the voice.

Any narration line (N1–N6). Record a WAV or MP3 per line into `demo/video/narration/custom/N1.mp3` and so on, then run `VIDEO_NARRATION_DIR=demo/video/narration/custom demo/video/build.sh --skip-record`. See `docs/hackathon/VIDEO_RUNBOOK.md`.
