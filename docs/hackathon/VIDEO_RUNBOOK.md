# ShopVoice demo video: runbook

Output: `demo/video/shopvoice_demo.mp4` (1920x1080, H.264 + AAC, no music) and `demo/video/shopvoice_demo.srt`. The subtitles are burned in; the .srt can also be uploaded to YouTube as captions. The shot list and narration are in `demo/video/script.md`, and the narration text is in `demo/video/narration.json`.

## Prerequisites

- Node 20+ (`npm ci && npm run build` at the repo root)
- `ffmpeg` / `ffprobe` (`sudo apt-get install ffmpeg`, `brew install ffmpeg`)
- Playwright Chromium. It's in the repo's devDependencies; if `npx playwright --version` shows no browser, run `npx playwright install chromium`.
- **Pronunciation:** narration is written as it should appear in subtitles. `demo/video/lib/speakable.mjs` rewrites money, numbers, units, acronyms, codes and brand names for the voice only; for example `$210` becomes "two hundred ten dollars" and `ShopVoice` becomes "Shop Voice". It is unit-tested in `tests/v2/video-speakable.test.mjs`.
- **Voices** (picked automatically, in this order):
  1. **Amazon Polly** neural voices (narrator Matthew, owner Stephen, assistant Joanna), with AWS credentials that allow `polly:SynthesizeSpeech`.
  2. **Piper**, offline neural TTS: `pip install piper-tts`, then download three voices into `PIPER_VOICES_DIR` (default `/tmp/piper-voices`) from `https://huggingface.co/rhasspy/piper-voices`: narrator `en_US-bryce-medium`, owner `en_US-joe-medium`, assistant `en_US-kristin-medium`. For each voice you need both the `.onnx` and the `.onnx.json` file.
     - **Licenses:** Bryce and Kristin are trained on public-domain LibriVox recordings, and Joe on a CC0 dataset; see each voice's `MODEL_CARD`. Popular voices such as ryan, lessac and hfc_* are non-commercial only, so avoid them for a contest video.
     - **Per-voice settings:** pace, noise and the pause between sentences live in `narration.json` → `voices.*.piper`.
     - **Takes:** `PIPER_TAKES` (default 3) records several takes and keeps the one whose pauses match the punctuation.
  3. `espeak-ng` + MBROLA (`sudo apt-get install espeak-ng mbrola mbrola-us1 mbrola-us2 mbrola-us3`), which sounds robotic and is for rehearsal only.

## Re-render (the exact commands)

```bash
# Final cut with Polly voices and the real Bedrock agent in the simulator:
export AWS_REGION=us-east-1            # plus AWS credentials in env or profile
VIDEO_TTS=polly SIM_BRAIN=bedrock demo/video/build.sh

# Offline neural voices (what the agent rendered for submission while AWS was unavailable):
VIDEO_TTS=piper demo/video/build.sh

# Rehearsal cut with robotic voices:
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

- **Date:** 2026-09-26. **Engine:** Piper offline neural voices: narrator `en_US-bryce-medium`, owner `en_US-joe-medium`, assistant `en_US-kristin-medium`. Polly is still unavailable (BLOCKERS B2).
- **ffprobe:** duration **160.6 s** (2:40, the storyboard target), **1920x1080 h264** + aac, about 10 MB, integrated loudness -16.2 LUFS. `report.json` → `under_3_minutes: true`.
- **Sync check:** each owner turn appears on screen within 0.16 s of its voice (measured on all 5 turns); none of the 37 subtitle cues overlap; no two voices overlap.
- **Listening QA:** `python3 demo/video/audit_audio.py --retake 5` passes **16/16 clips** (6 narration, 10 dialogue turns). Each clip has a Whisper word error rate of at most 0.1 against the intended text and no pause that the punctuation doesn't explain. One dialogue line was re-taken automatically. The narrator's earlier stumbles came from the voice splitting "ShopVoice" into "Shop… Voice" (a 0.87 s gap) and misreading acronyms, money and the protocol date. They are fixed by `speakable.mjs`, a steadier Piper noise setting and the Bryce voice.

### Listening QA (optional)

```bash
pip install faster-whisper
python3 demo/video/audit_audio.py --retake 5   # re-takes failing lines
node demo/video/assemble.mjs                    # only if retakes were applied
```

### Pipeline fixes made while rendering this cut
- `record.mjs` synthesizes every clip in a dry run before recording. Running neural TTS mid-recording starved Chromium, so the captured frame froze on "THINKING…".
- An invisible Web Animations keep-alive keeps the screencast emitting frames. It uses CSSOM because the simulator's CSP blocks injected `<style>` tags.
- The recording is saved through `page.video().saveAs()` into an emptied `raw/` directory, so a partial file from an interrupted run is never used.
- `assemble.mjs` rescales the webm timestamps onto the recorder's clock. Playwright's webm ran 1.13x slower than wall-clock time, which made the picture drift up to 6 s behind the voices by the last turn. It also refuses to assemble if the recording and the timeline disagree by more than 1 s.
