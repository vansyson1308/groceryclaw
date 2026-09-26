#!/usr/bin/env node
// Assembles demo/video/shopvoice_demo.mp4 (1920x1080, H.264 + AAC, no music):
// title card -> live simulator recording -> architecture -> MCP Inspector ->
// safety card -> end card, with narration + owner/assistant voices mixed at
// their timeline offsets and English subtitles (.srt) burned in.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { durationSec } from './lib/tts.mjs';

const OUT = 'demo/video/out';
const FINAL = 'demo/video/shopvoice_demo.mp4';
const SRT = 'demo/video/shopvoice_demo.srt';
const MAX_SECONDS = 179;
mkdirSync(join(OUT, 'seg'), { recursive: true });

const narr = JSON.parse(readFileSync('demo/video/narration/durations.json', 'utf8')).durations;
const timeline = JSON.parse(readFileSync(join(OUT, 'timeline.json'), 'utf8'));
const evidence = 'docs/hackathon/evidence';
const pick = (...c) => c.find((f) => existsSync(f));
const inspectorA = pick(`${evidence}/inspector-deployed-connected.png`, `${evidence}/inspector-local-connected.png`);
const inspectorB = pick(`${evidence}/inspector-deployed-tool-result.png`, `${evidence}/inspector-local-tool-result.png`);

function ff(args) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}

const VIDEO = ['-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-an'];
const FIT = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0b1020,setsar=1';

function still(image, seconds, name) {
  const out = join(OUT, 'seg', `${name}.mp4`);
  ff(['-loop', '1', '-t', seconds.toFixed(3), '-i', image, '-vf', `${FIT},fade=t=in:st=0:d=0.4`, ...VIDEO, out]);
  return { out, seconds };
}

// ---- video segments ----
const segs = [];
const speech = []; // { file, start, seconds, text, role }
let cursor = 0;
function addNarration(id, offset) {
  speech.push({ role: 'narrator', file: narr[id].file, start: cursor + offset, seconds: narr[id].seconds, text: narr[id].text });
}

const titleSec = narr.N1.seconds + 1.6;
addNarration('N1', 0.6);
segs.push(still('demo/video/cards/title.png', titleSec, '1-title'));
cursor += titleSec;

const simOut = join(OUT, 'seg', '2-sim.mp4');
// Playwright's webm timestamps do not run at wall-clock speed (measured: 80.8 s of
// video for 71.5 s of real time, a constant 1.13x stretch), so rescale them onto the
// recorder's own clock; the speech events use that clock.
const simWebm = join(OUT, 'sim.webm');
const pts = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', simWebm], { encoding: 'utf8' });
const lastPts = Math.max(...pts.stdout.split('\n').map(Number).filter((n) => Number.isFinite(n) && n > 0));
if (!(lastPts > 0)) throw new Error('could not read sim.webm timestamps');
const stretch = timeline.duration / lastPts;
ff(['-i', simWebm, '-vf', `setpts=PTS*${stretch.toFixed(6)},${FIT}`, '-t', timeline.duration.toFixed(3), ...VIDEO, simOut]);
const simSec = durationSec(simOut);
// The speech events are placed on the wall-clock timeline, so the recording must cover it.
if (Math.abs(simSec - timeline.duration) > 1) {
  throw new Error(`sim recording is ${simSec.toFixed(1)}s but the timeline is ${timeline.duration.toFixed(1)}s; re-run record.mjs`);
}
// Optional fine-tuning of the sim audio against the picture (seconds, default 0).
const simAvOffset = Number(process.env.VIDEO_SIM_AV_OFFSET ?? '0');
for (const e of timeline.events) speech.push({ ...e, start: cursor + e.start + simAvOffset });
segs.push({ out: simOut, seconds: simSec });
cursor += simSec;

const archSec = narr.N3.seconds + 1.2;
addNarration('N3', 0.4);
segs.push(still('docs/hackathon/architecture.png', archSec, '3-architecture'));
cursor += archSec;

const inspSec = narr.N4.seconds + 1.2;
addNarration('N4', 0.4);
segs.push(still(inspectorA, inspSec * 0.45, '4a-inspector'));
segs.push(still(inspectorB, inspSec * 0.55, '4b-inspector'));
cursor += inspSec;

const safetySec = narr.N5.seconds + 1.2;
addNarration('N5', 0.4);
segs.push(still('demo/video/cards/safety.png', safetySec, '5-safety'));
cursor += safetySec;

const endSec = narr.N6.seconds + 2.5;
addNarration('N6', 0.4);
segs.push(still('demo/video/cards/end.png', endSec, '6-end'));
cursor += endSec;

if (cursor > MAX_SECONDS) throw new Error(`video would be ${cursor.toFixed(1)}s (> ${MAX_SECONDS}s); shorten narration or turns`);

const list = join(OUT, 'concat.txt');
writeFileSync(list, segs.map((s) => `file '${s.out.replace(`${OUT}/`, '')}'`).join('\n') + '\n');
const silentVideo = join(OUT, 'video-silent.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silentVideo]);

// ---- audio: every clip delayed to its offset, mixed without normalisation ----
const inputs = speech.flatMap((s) => ['-i', s.file]);
const filters = speech.map((s, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(s.start * 1000)}|${Math.round(s.start * 1000)}[a${i}]`);
const mixed = `${speech.map((_, i) => `[a${i}]`).join('')}amix=inputs=${speech.length}:normalize=0:dropout_transition=0,apad,atrim=0:${cursor.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[mix]`;
const audio = join(OUT, 'audio.m4a');
ff([...inputs, '-filter_complex', [...filters, mixed].join(';'), '-map', '[mix]', '-c:a', 'aac', '-b:a', '160k', audio]);

// ---- subtitles ----
const ts = (sec) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
function chunks(text, seconds) {
  // Split long lines into ~12-word cues spread over the clip duration.
  const words = text.split(/\s+/);
  const n = Math.max(1, Math.ceil(words.length / 12));
  const per = Math.ceil(words.length / n);
  return Array.from({ length: n }, (_, i) => ({ text: words.slice(i * per, (i + 1) * per).join(' '), start: (seconds * i) / n, end: (seconds * (i + 1)) / n }));
}
const label = { owner: 'Owner: ', assistant: 'Assistant: ', narrator: '' };
let idx = 0;
const srt = speech
  .slice()
  .sort((a, b) => a.start - b.start)
  .flatMap((s) => chunks(s.text, s.seconds).map((c, i) => `${++idx}\n${ts(s.start + c.start)} --> ${ts(s.start + c.end)}\n${i === 0 ? label[s.role] : ''}${c.text}\n`))
  .join('\n');
writeFileSync(SRT, srt);

const style = 'FontName=DejaVu Sans,FontSize=15,PrimaryColour=&H00FFFFFF,BackColour=&H99000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=28';
ff(['-i', silentVideo, '-i', audio, '-vf', `subtitles=${SRT}:force_style='${style}'`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', '-shortest', FINAL]);

const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name:format=duration', '-of', 'json', FINAL], { encoding: 'utf8' });
const info = JSON.parse(probe.stdout);
const duration = Number(info.format.duration);
const v = info.streams[0];
const report = { file: FINAL, duration_seconds: Math.round(duration * 10) / 10, width: v.width, height: v.height, codec: v.codec_name, under_3_minutes: duration < 180, segments: segs.length, speech_clips: speech.length };
writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (!report.under_3_minutes || v.width !== 1920 || v.height !== 1080 || v.codec_name !== 'h264') process.exit(1);
