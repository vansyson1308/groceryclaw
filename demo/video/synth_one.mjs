// Synthesizes one line in one of the demo voices; used by audit_audio.py --retake.
// Usage: node demo/video/synth_one.mjs <narrator|owner|assistant> <out.mp3> <text>
import { readFileSync } from 'node:fs';
import { synthesize } from './lib/tts.mjs';

const [role, out, ...words] = process.argv.slice(2);
const cfg = JSON.parse(readFileSync('demo/video/narration.json', 'utf8'));
if (!cfg.voices[role]) throw new Error(`unknown voice role: ${role}`);
const seconds = await synthesize(words.join(' '), cfg.voices[role], out);
process.stdout.write(`${seconds}\n`);
