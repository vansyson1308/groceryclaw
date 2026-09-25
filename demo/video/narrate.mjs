#!/usr/bin/env node
// Generates narration clips N1..N6 (Amazon Polly, or offline fallback) into
// demo/video/narration/ and writes durations.json. If VIDEO_NARRATION_DIR
// points at owner-recorded files (N1.mp3 ...), those are used instead.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { synthesize, durationSec, ttsEngine } from './lib/tts.mjs';

const cfg = JSON.parse(readFileSync('demo/video/narration.json', 'utf8'));
const dir = 'demo/video/narration';
mkdirSync(dir, { recursive: true });
const custom = process.env.VIDEO_NARRATION_DIR;
const durations = {};
for (const [id, text] of Object.entries(cfg.lines)) {
  const out = join(dir, `${id}.mp3`);
  const own = custom && ['mp3', 'wav', 'm4a'].map((ext) => join(custom, `${id}.${ext}`)).find((f) => existsSync(f));
  durations[id] = { file: own ?? out, seconds: own ? durationSec(own) : await synthesize(text, cfg.voices.narrator, out), text: cfg.subtitles?.[id] ?? text };
}
writeFileSync(join(dir, 'durations.json'), `${JSON.stringify({ engine: custom ? 'custom+' + (await ttsEngine()) : await ttsEngine(), durations }, null, 2)}\n`);
console.log(`narration: ${Object.entries(durations).map(([k, v]) => `${k}=${v.seconds.toFixed(1)}s`).join(' ')} (engine ${await ttsEngine()})`);
