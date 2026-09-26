// Text-to-speech for the demo video: Amazon Polly (neural) when AWS
// credentials work, otherwise an offline espeak-ng + MBROLA fallback so the
// pipeline always renders. VIDEO_TTS=polly|espeak|auto (default auto).
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let engine = null;

async function pollyClient() {
  const { PollyClient, SynthesizeSpeechCommand } = await import('@aws-sdk/client-polly');
  return { client: new PollyClient({ region: process.env.AWS_REGION ?? 'us-east-1' }), SynthesizeSpeechCommand };
}

export async function ttsEngine() {
  if (engine) return engine;
  const wanted = process.env.VIDEO_TTS ?? 'auto';
  if (wanted === 'espeak') return (engine = 'espeak');
  try {
    const { client, SynthesizeSpeechCommand } = await pollyClient();
    await client.send(new SynthesizeSpeechCommand({ Text: 'test', OutputFormat: 'mp3', VoiceId: 'Joanna', Engine: 'neural' }));
    engine = 'polly';
  } catch (error) {
    if (wanted === 'polly') throw new Error(`VIDEO_TTS=polly but Polly failed: ${error.name}`);
    engine = 'espeak';
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

/** Synthesize `text` in `voice` ({ polly, espeak }) to an MP3 at `out`; returns its duration in seconds. */
export async function synthesize(text, voice, out) {
  const which = await ttsEngine();
  if (which === 'polly') {
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
