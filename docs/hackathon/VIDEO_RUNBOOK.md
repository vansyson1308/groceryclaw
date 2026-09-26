# ShopVoice demo video: runbook

Output: `demo/video/shopvoice_demo.mp4` (1920x1080, H.264 + AAC, no music) and `demo/video/shopvoice_demo.srt`. The subtitles are burned in; the .srt can also be uploaded to YouTube as captions. The shot list and narration are in `demo/video/script.md`, and the narration text is in `demo/video/narration.json`.

## Prerequisites

- Node 20+ (`npm ci && npm run build` at the repo root)
- `ffmpeg` / `ffprobe` (`sudo apt-get install ffmpeg`, `brew install ffmpeg`)
- Playwright Chromium. It's in the repo's devDependencies; if `npx playwright --version` shows no browser, run `npx playwright install chromium`.
- **Voices:** with working AWS credentials (any profile or env allowed `polly:SynthesizeSpeech`), the pipeline uses **Amazon Polly** neural voices: narrator Matthew, owner Stephen, assistant Joanna. Without them it falls back to offline `espeak-ng` + MBROLA (`sudo apt-get install espeak-ng mbrola mbrola-us1 mbrola-us2 mbrola-us3`), which sounds robotic and is for rehearsal only.

## Re-render (the exact commands)

```bash
# Final cut with Polly voices and the real Bedrock agent in the simulator:
export AWS_REGION=us-east-1            # plus AWS credentials in env or profile
VIDEO_TTS=polly SIM_BRAIN=bedrock demo/video/build.sh

# Rehearsal cut, fully offline (what the agent rendered):
VIDEO_TTS=espeak demo/video/build.sh

# Check it:
ffprobe -v error -show_entries format=duration:stream=width,height,codec_name -of default=nw=1 demo/video/shopvoice_demo.mp4
```

`build.sh` runs these steps:
1. `cards.mjs`: title, safety and end cards → `demo/video/cards/`.
2. `narrate.mjs`: N1–N6 → `demo/video/narration/*.mp3`.
3. `record.mjs`: starts a local MCP server (in-memory demo shop, `DEMO_ANCHOR_DATE=2026-10-16`, a Friday) plus the simulator, and records it with Playwright `recordVideo` while driving the 5 utterances. It synthesizes the owner and assistant voices per turn, so the timing matches exactly.
4. `assemble.mjs`: builds the segments, mixes the audio (`adelay` + `amix`, loudness-normalised), burns in the subtitles, and fails if the result is over 2:59 or not 1080p H.264.

The result is written to `demo/video/out/report.json`.

Flags and env:
- `--skip-record` reuses the last recording, which is useful after changing only the narration.
- `DEMO_ANCHOR_DATE` is the demo "today" and must be a Friday for the "compared to last Friday" line to read naturally.
- `SIM_BRAIN=bedrock` makes the recorded simulator show the "Bedrock · us.amazon.nova-2-lite-v1:0" chip instead of "Offline rules brain". If the model phrases replies differently, the assistant audio follows automatically, because it is synthesized from the actual reply.

## What the owner may re-record in their own voice

- **Any narration line, N1–N6.** Record one file per line (`N1.mp3` … `N6.mp3`, or `.wav` / `.m4a`) into a folder, then run:
  ```bash
  VIDEO_NARRATION_DIR=/path/to/my-voice demo/video/build.sh --skip-record
  ```
  Keep each line roughly the same length (see `demo/video/narration/durations.json`); the cards stretch to fit. Also keep the text identical, or edit `narration.json` → `lines`/`subtitles` so the burned-in subtitles match.
- **The owner's utterances** in the live demo (the 5 turns). The pipeline voices them with TTS so the demo is reproducible. To use your own voice, replace `demo/video/out/turns/owner-N.mp3` after a recording, keeping each clip no longer than the original (check with `ffprobe`), then run `demo/video/build.sh --skip-record`.
- **Do not** add music, Amazon/Alexa logos, or Echo device footage (hackathon rules). The simulator UI is deliberately unbranded.

## Upload

1. YouTube → Create → Upload `demo/video/shopvoice_demo.mp4`, visibility **Public**, language English. Optionally attach `shopvoice_demo.srt` as English captions.
2. Title suggestion: "ShopVoice: run your grocery shop by voice (Alexa+ MCP server)".
3. Paste the URL into Devpost (`docs/hackathon/DEVPOST_SUBMISSION.md` → "Video demo link").

## Last verified render (by the agent)

- Date: 2026-09-25. Engine: offline espeak-ng + MBROLA (Polly not yet available, BLOCKERS B2).
- `ffprobe`: duration **151.5 s** (2:31), **1920x1080 h264** + aac, file size about 10 MB. `report.json` → `under_3_minutes: true`.
