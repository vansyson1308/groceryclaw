#!/usr/bin/env bash
# Renders demo/video/shopvoice_demo.mp4 (1080p H.264, < 3:00, no music) end to end.
# Usage: demo/video/build.sh [--skip-record]
# Env: VIDEO_TTS=auto|polly|piper|espeak (default auto: Polly if AWS works, else Piper offline neural
#      voices if installed (PIPER_VOICES_DIR), else espeak-ng + MBROLA)
#      SIM_BRAIN=rules|bedrock (default rules), DEMO_ANCHOR_DATE (default 2026-10-16),
#      VIDEO_NARRATION_DIR=<dir with N1.mp3..N6.mp3 recorded by the owner>
set -euo pipefail
cd "$(dirname "$0")/../.."

for tool in node ffmpeg ffprobe; do command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }; done
[[ -f apps/mcp-server/dist/server.js && -f apps/alexa-sim/dist/server.js ]] || npm run build

node demo/video/cards.mjs
node demo/video/narrate.mjs
if [[ "${1:-}" != "--skip-record" ]]; then
  node demo/video/record.mjs
fi
node demo/video/assemble.mjs
echo "Done: demo/video/shopvoice_demo.mp4 (+ shopvoice_demo.srt). Upload to YouTube as Public."
