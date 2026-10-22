#!/usr/bin/env node
// Records the simulator at 1440x810 with Playwright recordVideo while driving
// the demo turns, and writes out/timeline.json for assemble.mjs.
//
//   node demo/video/record.mjs                                  # local stack (in-memory shop, rules brain)
//   VIDEO_SIM_URL=https://shopvoice.onrender.com node demo/video/record.mjs   # the hosted demo (Claude brain)
//
// The owner's lines are known in advance and synthesized before recording
// (neural TTS mid-recording starves Chromium and freezes frames). Claude's
// replies are not deterministic, so each reply gets a slot sized from its word
// count; its voice is synthesized after recording and, if it runs long,
// sped up slightly (at most 1.2x) to fit the slot.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { startLocalStack } from '../../scripts/demo/e2e_voice_flow.mjs';
import { synthesize, durationSec } from './lib/tts.mjs';

const cfg = JSON.parse(readFileSync('demo/video/narration.json', 'utf8'));
const narr = JSON.parse(readFileSync('demo/video/narration/durations.json', 'utf8')).durations;
const OUT = 'demo/video/out';
const SECONDS_PER_WORD = { en: 0.37, vi: 0.33 };
const MAX_TEMPO = 1.2;
mkdirSync(join(OUT, 'turns'), { recursive: true });
process.env.DEMO_ANCHOR_DATE = process.env.DEMO_ANCHOR_DATE ?? '2026-10-16'; // local stack only: a Friday
rmSync(join(OUT, 'raw'), { recursive: true, force: true });

const voiceFor = (role, lang) => (lang === 'vi' ? cfg.voices.vietnamese : cfg.voices[role]);
const words = (text) => text.trim().split(/\s+/).filter(Boolean).length;
const isVietnamese = (text) => /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/iu.test(text);

// Owner clips first.
const owner = [];
for (const [i, turn] of cfg.turns.entries()) {
  const file = join(OUT, 'turns', `owner-${i + 1}.mp3`);
  owner.push({ file, seconds: await synthesize(turn.text, voiceFor('owner', turn.lang), file) });
}

const hosted = process.env.VIDEO_SIM_URL?.replace(/\/+$/, '');
const stack = hosted ? null : await startLocalStack();
const simUrl = hosted ?? stack.url;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, recordVideo: { dir: join(OUT, 'raw'), size: { width: 1440, height: 810 } } });
const t0 = Date.now();
const at = () => (Date.now() - t0) / 1000;
const events = [];
const replies = [];
let video = null;
try {
  const page = await context.newPage();
  video = page.video();
  await page.goto(simUrl);
  await page.evaluate(() => window.shopvoice.setMuted(true));
  // An invisible, always-animating pixel keeps the compositor producing frames.
  await page.evaluate(() => {
    const d = document.createElement('div');
    Object.assign(d.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', background: '#000', pointerEvents: 'none' });
    document.body.append(d);
    d.animate([{ opacity: 0.01 }, { opacity: 0.02 }], { duration: 500, iterations: Infinity, direction: 'alternate' });
  });
  events.push({ role: 'narrator', id: 'N3', start: at(), file: narr.N3.file, seconds: narr.N3.seconds, text: narr.N3.text });
  await page.waitForTimeout((narr.N3.seconds + 0.5) * 1000);

  for (const [i, turn] of cfg.turns.entries()) {
    const o = owner[i];
    events.push({ role: 'owner', start: at(), file: o.file, seconds: o.seconds, text: turn.text, ...(turn.en ? { en: turn.en } : {}) });
    const data = await page.evaluate(([t, d]) => window.shopvoice.say(t, { wordDelayMs: d }), [turn.text, Math.max(120, Math.round((o.seconds * 1000) / words(turn.text)))]);
    const reply = data?.reply ?? '';
    const lang = isVietnamese(reply) ? 'vi' : 'en';
    const slot = words(reply) * SECONDS_PER_WORD[lang] + 0.4;
    const start = at() + 0.2;
    replies.push({ index: i, start, slot, reply, lang, tools: (data?.toolCalls ?? []).map((c) => c.name), brain: data?.brainLabel ?? data?.brain?.model ?? null, fallback: data?.brainFallback ?? false });
    await page.waitForTimeout((slot + 0.9) * 1000);
  }
  await page.waitForTimeout(1200);
} finally {
  const duration = at();
  await context.close();
  if (video) await video.saveAs(join(OUT, 'sim.webm'));
  await browser.close();
  stack?.stop();

  // Assistant voices, after recording; fit each into its slot.
  for (const r of replies) {
    const raw = join(OUT, 'turns', `assistant-${r.index + 1}-raw.mp3`);
    const seconds = await synthesize(r.reply, voiceFor('assistant', r.lang), raw);
    let file = raw;
    let final = seconds;
    if (seconds > r.slot + 0.3) {
      const tempo = Math.min(MAX_TEMPO, seconds / r.slot);
      file = join(OUT, 'turns', `assistant-${r.index + 1}.mp3`);
      spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-filter:a', `atempo=${tempo.toFixed(3)}`, file]);
      final = durationSec(file);
      if (final > r.slot + 1.2) console.warn(`turn ${r.index + 1}: reply audio ${final.toFixed(1)}s overruns its ${r.slot.toFixed(1)}s slot`);
    }
    events.push({ role: 'assistant', start: r.start, file, seconds: final, text: r.reply, tools: r.tools, lang: r.lang });
  }
  events.sort((a, b) => a.start - b.start);
  writeFileSync(join(OUT, 'timeline.json'), `${JSON.stringify({ duration, simUrl, anchorDate: hosted ? null : process.env.DEMO_ANCHOR_DATE, replies, events }, null, 2)}\n`);
  console.log(`recorded ${duration.toFixed(1)}s from ${simUrl}, ${events.length} speech events`);
  for (const r of replies) console.log(`  ${r.index + 1}. [${r.tools.join(', ')}] ${r.fallback ? '(fallback) ' : ''}${r.reply}`);
}
