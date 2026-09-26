// Text-to-speech for the demo video: Amazon Polly (neural) when AWS
// credentials work, otherwise Piper (offline neural voices, `pip install piper-tts`
// + voice models in PIPER_VOICES_DIR), otherwise espeak-ng + MBROLA so the
// pipeline always renders. VIDEO_TTS=polly|piper|espeak|auto (default auto).
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let engine = null;

async function pollyClient() {
  const { PollyClient, SynthesizeSpeechCommand } = await import('@aws-sdk/client-polly');
  return { client: new PollyClient({ region: process.env.AWS_REGION ?? 'us-east-1' }), SynthesizeSpeechCommand };
}

const piperDir = process.env.PIPER_VOICES_DIR ?? '/tmp/piper-voices';
// < 1 speaks faster; 0.9 keeps the cut near the 2:40 storyboard target.
const piperLengthScale = process.env.PIPER_LENGTH_SCALE ?? '0.9';

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

/** Synthesize `text` in `voice` ({ polly, piper, espeak }) to an MP3 at `out`; returns its duration in seconds. */
export async function synthesize(text, voice, out) {
  const which = await ttsEngine();
  if (which === 'piper') {
    const wav = join(mkdtempSync(join(tmpdir(), 'tts-')), 'a.wav');
    const r = spawnSync('python3', ['-m', 'piper', '-m', join(piperDir, `${voice.piper}.onnx`), '--length-scale', piperLengthScale, '-f', wav], { input: text, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`piper failed: ${r.stderr?.slice(0, 400)}`);
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-q:a', '3', out]);
  } else if (which === 'polly') {
    const { client, SynthesizeSpeechCommand } = await pollyClient();
    const res = await client.send(new SynthesizeSpeechCommand({ Text: text, OutputFormat: 'mp3', VoiceId: voice.polly, Engine: 'neural', SampleRate: '24000' }));
    writeFileSync(out, Buffer.from(await res.AudioStream.transformToByteArray()));
  } else {
    const wav = join(mkdtempSync(join(tmpdir(), 'tts-')), 'a.wav');
    run('espeak-ng', ['-v', voice.espeak, '-s', '150', '-w', wav, text]);
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-q:a', '3', out]);
  }
  return durationSec(out);
}
