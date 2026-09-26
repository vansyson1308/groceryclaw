// Text-to-speech for the demo video: Amazon Polly (neural) when AWS
// credentials work, otherwise Piper (offline neural voices, `pip install piper-tts`
// + voice models in PIPER_VOICES_DIR), otherwise espeak-ng + MBROLA so the
// pipeline always renders. VIDEO_TTS=polly|piper|espeak|auto (default auto).
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { speakable } from './speakable.mjs';

let engine = null;

async function pollyClient() {
  const { PollyClient, SynthesizeSpeechCommand } = await import('@aws-sdk/client-polly');
  return { client: new PollyClient({ region: process.env.AWS_REGION ?? 'us-east-1' }), SynthesizeSpeechCommand };
}

const piperDir = process.env.PIPER_VOICES_DIR ?? '/tmp/piper-voices';
// Best-of-N takes per line: Piper is stochastic, so keep the take with the
// fewest pauses that punctuation doesn't explain (those read as hesitation).
const piperTakes = Math.max(1, Number(process.env.PIPER_TAKES ?? '3'));

function piperAvailable() {
  const r = spawnSync('python3', ['-c', 'import piper'], { encoding: 'utf8' });
  return r.status === 0 && existsSync(piperDir);
}

export async function ttsEngine() {
  if (engine) return engine;
  const wanted = process.env.VIDEO_TTS ?? 'auto';
  if (wanted === 'espeak') return (engine = 'espeak');
  if (wanted === 'piper') {
    if (!piperAvailable()) throw new Error(`VIDEO_TTS=piper but piper-tts or ${piperDir} is missing`);
    return (engine = 'piper');
  }
  try {
    const { client, SynthesizeSpeechCommand } = await pollyClient();
    await client.send(new SynthesizeSpeechCommand({ Text: 'test', OutputFormat: 'mp3', VoiceId: 'Joanna', Engine: 'neural' }));
    engine = 'polly';
  } catch (error) {
    if (wanted === 'polly') throw new Error(`VIDEO_TTS=polly but Polly failed: ${error.name}`);
    engine = piperAvailable() ? 'piper' : 'espeak';
  }
  return engine;
}

export function durationSec(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe failed for ${file}: ${r.stderr}`);
  return Number(r.stdout.trim());
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr?.slice(0, 400)}`);
}

/** Inner silences (not leading/trailing) of at least `minSec`, in seconds. */
function innerPauses(file, minSec = 0.28) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', `silencedetect=noise=-35dB:d=${minSec}`, '-f', 'null', '-'], { encoding: 'utf8' });
  const starts = [...r.stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...r.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const total = durationSec(file);
  return starts.map((a, i) => [a, ends[i] ?? total]).filter(([a, b]) => a > 0.05 && b < total - 0.05).map(([a, b]) => b - a);
}

function piperTake(spoken, cfg, wav) {
  const args = ['-m', 'piper', '-m', join(piperDir, `${cfg.model}.onnx`),
    '--length-scale', String(process.env.PIPER_LENGTH_SCALE ?? cfg.lengthScale ?? 0.85),
    '--noise-scale', String(cfg.noiseScale ?? 0.5),
    '--noise-w-scale', String(cfg.noiseW ?? 0.4),
    '--sentence-silence', String(cfg.sentenceSilence ?? 0.2),
    '-f', wav];
  const r = spawnSync('python3', args, { input: spoken, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`piper failed: ${r.stderr?.slice(0, 400)}`);
  // Pauses at commas and sentence ends are expected; anything beyond reads as a stumble.
  const expected = (spoken.replace(/[.!?]\s*$/, '').match(/[.,;:!?]/g) ?? []).length;
  const pauses = innerPauses(wav);
  const longest = pauses.length ? Math.max(...pauses) : 0;
  return Math.max(0, pauses.length - expected) + Math.max(0, longest - 0.6) * 3;
}

/**
 * Synthesize `text` in `voice` ({ polly, piper, espeak }) to an MP3 at `out`; returns
 * its duration in seconds. The text is rewritten with `speakable()` first (subtitles
 * keep the original). `voice.piper` is a model name or { model, lengthScale,
 * noiseScale, noiseW, sentenceSilence }.
 */
export async function synthesize(text, voice, out) {
  const which = await ttsEngine();
  const spoken = speakable(text);
  if (which === 'piper') {
    const cfg = typeof voice.piper === 'string' ? { model: voice.piper } : voice.piper;
    const dir = mkdtempSync(join(tmpdir(), 'tts-'));
    let best = null;
    for (let k = 0; k < piperTakes; k += 1) {
      const wav = join(dir, `take-${k}.wav`);
      const score = piperTake(spoken, cfg, wav);
      if (!best || score < best.score) best = { score, wav };
      if (score === 0) break;
    }
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', best.wav, '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-q:a', '3', out]);
  } else if (which === 'polly') {
    const { client, SynthesizeSpeechCommand } = await pollyClient();
    const res = await client.send(new SynthesizeSpeechCommand({ Text: spoken, OutputFormat: 'mp3', VoiceId: voice.polly, Engine: 'neural', SampleRate: '24000' }));
    writeFileSync(out, Buffer.from(await res.AudioStream.transformToByteArray()));
  } else {
    const wav = join(mkdtempSync(join(tmpdir(), 'tts-')), 'a.wav');
    run('espeak-ng', ['-v', voice.espeak, '-s', '150', '-w', wav, spoken]);
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-q:a', '3', out]);
  }
  return durationSec(out);
}
