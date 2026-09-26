#!/usr/bin/env node
// Records the live simulator at 1080p with Playwright recordVideo while
// driving the 5 demo turns. The owner's and assistant's voices are
// synthesized per turn (Polly or fallback), and each turn waits for its
// audio to finish, so the timeline in out/timeline.json lines up exactly
// with the audio that assemble.mjs mixes in.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startLocalStack } from '../../scripts/demo/e2e_voice_flow.mjs';
import { synthesize } from './lib/tts.mjs';

const cfg = JSON.parse(readFileSync('demo/video/narration.json', 'utf8'));
const narr = JSON.parse(readFileSync('demo/video/narration/durations.json', 'utf8')).durations;
const OUT = 'demo/video/out';
mkdirSync(join(OUT, 'turns'), { recursive: true });
process.env.DEMO_ANCHOR_DATE = process.env.DEMO_ANCHOR_DATE ?? '2026-10-16'; // a Friday: "today vs last Friday"

// Start from an empty raw/ so a partial video from an interrupted run is never picked up.
rmSync(join(OUT, 'raw'), { recursive: true, force: true });

// Dry run first: the demo shop is deterministic, so the replies are known in
// advance and every voice clip can be synthesized before recording starts.
// Neural TTS saturates the CPU; doing it mid-recording starves Chromium's
// compositor and freezes the captured frames.
const clips = new Map();
async function clip(role, text, file) {
  const key = `${role}:${text}`;
  if (!clips.has(key)) clips.set(key, { file, seconds: await synthesize(text, cfg.voices[role], file) });
  return clips.get(key);
}
{
  const dry = await startLocalStack();
  try {
    let conversationId;
    for (const [i, text] of cfg.turns.entries()) {
      await clip('owner', text, join(OUT, 'turns', `owner-${i + 1}.mp3`));
      const res = await fetch(`${dry.url}/api/turn`, { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ text, conversationId }) });
      const data = await res.json();
      conversationId = data.conversationId;
      await clip('assistant', data.reply ?? '', join(OUT, 'turns', `assistant-${i + 1}.mp3`));
    }
  } finally {
    dry.stop();
  }
}

const stack = await startLocalStack();
const browser = await chromium.launch();
// Record 1440x810 natively; assemble.mjs upscales to 1920x1080 so the UI stays legible.
const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, recordVideo: { dir: join(OUT, 'raw'), size: { width: 1440, height: 810 } } });
const t0 = Date.now();
const at = () => (Date.now() - t0) / 1000;
const events = [];
let video = null;
try {
  const page = await context.newPage();
  video = page.video();
  await page.goto(stack.url);
  await page.evaluate(() => window.shopvoice.setMuted(true));
  // An invisible, always-animating pixel keeps the compositor producing frames,
  // so the screencast never holds a stale frame after a DOM update.
  // (CSSOM + Web Animations API: the simulator's CSP rightly blocks injected <style>.)
  await page.evaluate(() => {
    const d = document.createElement('div');
    Object.assign(d.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', background: '#000', pointerEvents: 'none' });
    document.body.append(d);
    d.animate([{ opacity: 0.01 }, { opacity: 0.02 }], { duration: 500, iterations: Infinity, direction: 'alternate' });
  });
  // N2 plays over the opening seconds of this shot.
  events.push({ role: 'narrator', id: 'N2', start: at(), file: narr.N2.file, seconds: narr.N2.seconds, text: narr.N2.text });
  await page.waitForTimeout((narr.N2.seconds + 0.6) * 1000);

  for (const [i, text] of cfg.turns.entries()) {
    const { file: ownerFile, seconds: ownerSec } = await clip('owner', text, join(OUT, 'turns', `owner-${i + 1}.mp3`));
    const words = text.split(/\s+/).length;
    events.push({ role: 'owner', start: at(), file: ownerFile, seconds: ownerSec, text });
    const data = await page.evaluate(([t, d]) => window.shopvoice.say(t, { wordDelayMs: d }), [text, Math.max(120, Math.round((ownerSec * 1000) / words))]);
    const reply = data?.reply ?? '';
    const tools = (data?.toolCalls ?? []).map((c) => c.name);
    const known = clips.has(`assistant:${reply}`);
    if (!known) console.warn(`turn ${i + 1}: reply differs from the dry run; synthesizing during recording`);
    const { file: replyFile, seconds: replySec } = await clip('assistant', reply, join(OUT, 'turns', `assistant-${i + 1}-live.mp3`));
    events.push({ role: 'assistant', start: at() + 0.2, file: replyFile, seconds: replySec, text: reply, tools });
    await page.waitForTimeout((replySec + 1.3) * 1000);
  }
  await page.waitForTimeout(1200);
} finally {
  const duration = at();
  await context.close();
  // saveAs waits until Playwright has finished writing this page's video; it
  // needs the browser connection, so it runs before browser.close().
  if (video) await video.saveAs(join(OUT, 'sim.webm'));
  await browser.close();
  stack.stop();
  writeFileSync(join(OUT, 'timeline.json'), `${JSON.stringify({ duration, anchorDate: process.env.DEMO_ANCHOR_DATE, events }, null, 2)}\n`);
  console.log(`recorded ${duration.toFixed(1)}s, ${events.length} speech events`);
}
