#!/usr/bin/env node
// Records the live simulator at 1080p with Playwright recordVideo while
// driving the 5 demo turns. The owner's and assistant's voices are
// synthesized per turn (Polly or fallback), and each turn waits for its
// audio to finish, so the timeline in out/timeline.json lines up exactly
// with the audio that assemble.mjs mixes in.
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startLocalStack } from '../../scripts/demo/e2e_voice_flow.mjs';
import { synthesize } from './lib/tts.mjs';

const cfg = JSON.parse(readFileSync('demo/video/narration.json', 'utf8'));
const narr = JSON.parse(readFileSync('demo/video/narration/durations.json', 'utf8')).durations;
const OUT = 'demo/video/out';
mkdirSync(join(OUT, 'turns'), { recursive: true });
process.env.DEMO_ANCHOR_DATE = process.env.DEMO_ANCHOR_DATE ?? '2026-10-16'; // a Friday: "today vs last Friday"

const stack = await startLocalStack();
const browser = await chromium.launch();
// Record 1440x810 natively; assemble.mjs upscales to 1920x1080 so the UI stays legible.
const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, recordVideo: { dir: join(OUT, 'raw'), size: { width: 1440, height: 810 } } });
const t0 = Date.now();
const at = () => (Date.now() - t0) / 1000;
const events = [];
try {
  const page = await context.newPage();
  await page.goto(stack.url);
  await page.evaluate(() => window.shopvoice.setMuted(true));
  // N2 plays over the opening seconds of this shot.
  events.push({ role: 'narrator', id: 'N2', start: at(), file: narr.N2.file, seconds: narr.N2.seconds, text: narr.N2.text });
  await page.waitForTimeout((narr.N2.seconds + 0.6) * 1000);

  for (const [i, text] of cfg.turns.entries()) {
    const ownerFile = join(OUT, 'turns', `owner-${i + 1}.mp3`);
    const ownerSec = await synthesize(text, cfg.voices.owner, ownerFile);
    const words = text.split(/\s+/).length;
    events.push({ role: 'owner', start: at(), file: ownerFile, seconds: ownerSec, text });
    const data = await page.evaluate(([t, d]) => window.shopvoice.say(t, { wordDelayMs: d }), [text, Math.max(120, Math.round((ownerSec * 1000) / words))]);
    const reply = data?.reply ?? '';
    const tools = (data?.toolCalls ?? []).map((c) => c.name);
    const replyFile = join(OUT, 'turns', `assistant-${i + 1}.mp3`);
    const replySec = await synthesize(reply, cfg.voices.assistant, replyFile);
    events.push({ role: 'assistant', start: at() + 0.2, file: replyFile, seconds: replySec, text: reply, tools });
    await page.waitForTimeout((replySec + 1.3) * 1000);
  }
  await page.waitForTimeout(1200);
} finally {
  const duration = at();
  await context.close();
  await browser.close();
  stack.stop();
  const raw = readdirSync(join(OUT, 'raw')).filter((f) => f.endsWith('.webm')).map((f) => join(OUT, 'raw', f));
  if (raw[0]) renameSync(raw[0], join(OUT, 'sim.webm'));
  writeFileSync(join(OUT, 'timeline.json'), `${JSON.stringify({ duration, anchorDate: process.env.DEMO_ANCHOR_DATE, events }, null, 2)}\n`);
  console.log(`recorded ${duration.toFixed(1)}s, ${events.length} speech events`);
}
