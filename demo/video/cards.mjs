#!/usr/bin/env node
// Renders the title, safety and end cards (1920x1080 PNG) with Playwright.
// No logos or third-party marks, just text on the ShopVoice palette.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const REPO = process.env.VIDEO_REPO_URL ?? 'github.com/vansyson1308/groceryclaw';
const base = `
  body{margin:0;width:1920px;height:1080px;display:flex;flex-direction:column;justify-content:center;
  padding:0 160px;box-sizing:border-box;background:radial-gradient(1400px 800px at 15% -10%,#1b2446 0%,#0b1020 60%);
  color:#e8ecf5;font-family:"DejaVu Sans",system-ui,sans-serif}
  .bar{width:220px;height:10px;border-radius:5px;background:linear-gradient(90deg,#34d399,#8b5cf6);margin-bottom:48px}
  h1{font-size:112px;margin:0 0 24px;letter-spacing:-2px} h2{font-size:52px;margin:0 0 40px;color:#b7c3dd;font-weight:500}
  p,li{font-size:40px;line-height:1.5;color:#c9d3e8} li{margin-bottom:18px} ul{padding-left:44px;margin:0}
  .muted{color:#95a1bb;font-size:32px} .accent{color:#34d399}`;
const cards = {
  title: `<div class="bar"></div><h1>ShopVoice</h1><h2>Run your grocery shop by voice</h2>
    <p>An MCP server for Alexa+ · Amazon Bedrock · Amazon Polly</p>
    <p class="muted">"What's running low?" · "Reorder milk and eggs" · "Yes, confirm"</p>`,
  safety: `<div class="bar"></div><h2 style="color:#e8ecf5;font-size:64px">Safe by design</h2><ul>
    <li><span class="accent">Two-step reorders</span>: draft, then an explicit "yes" within 5 minutes</li>
    <li>The language model <span class="accent">never sees</span> the confirmation token</li>
    <li><span class="accent">Tenant isolation</span> with Postgres row-level security</li>
    <li>Every tool call <span class="accent">audited</span>; answers ≤ 35 spoken words</li></ul>`,
  end: `<div class="bar"></div><h1 style="font-size:96px">ShopVoice</h1><h2>${REPO}</h2>
    <p>Open source · MIT License · MCP 2025-11-25</p>
    <p class="muted">Built during Build, Ship, Shape: Amazon Developer Hackathon 2026</p>`
};

mkdirSync('demo/video/cards', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [name, body] of Object.entries(cards)) {
  await page.setContent(`<html><head><style>${base}</style></head><body>${body}</body></html>`);
  await page.screenshot({ path: `demo/video/cards/${name}.png` });
}
await browser.close();
console.log('cards: title, safety, end');
