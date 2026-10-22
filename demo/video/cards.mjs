#!/usr/bin/env node
// Renders the title, before/after, impact and end cards (1920x1080 PNG) with Playwright.
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
  title: `<div class="bar"></div><h1>ShopVoice</h1><h2>An agent that watches the shop for you</h2>
    <p>Morning briefing · a reorder plan that remembers your rules · nothing bought without a spoken "yes"</p>
    <p class="muted">A simulated Alexa+ experience over a standard MCP server</p>`,
  beforeafter: `<div class="bar"></div><h2 style="color:#e8ecf5;font-size:64px">Before → after</h2>
    <table style="font-size:36px;line-height:1.45;border-collapse:collapse;color:#c9d3e8">
    <tr><td style="padding:0 48px 26px 0;color:#95a1bb;vertical-align:top">Before<br><span style="font-size:26px">tag pre-hackathon-baseline</span></td>
        <td style="padding-bottom:26px">GroceryClaw: supplier invoices (photo, XML, Excel) → the KiotViet point of sale, by chat</td></tr>
    <tr><td style="padding:0 48px 0 0;color:#34d399;vertical-align:top">After<br><span style="font-size:26px">built Sep–Oct 2026</span></td>
        <td>A voice agent: morning briefing → plan by supplier → spoken "yes".<br>Shop memory across days · English and Vietnamese · an MCP server any assistant can use · open-source kiotviet-mcp</td></tr>
    </table>`,
  impact: `<div class="bar"></div><h2 style="color:#e8ecf5;font-size:64px">For every corner shop</h2><ul>
    <li><span class="accent">An agent that keeps watch</span>: briefing, plan, memory, two-step orders</li>
    <li><span class="accent">Safe by design</span>: the model never sees the confirmation token</li>
    <li><span class="accent">Open standard</span>: MCP 2025-11-25 over Streamable HTTP, RLS per shop</li>
    <li><span class="accent">Open source</span>: kiotviet-mcp (MIT) for any KiotViet shop</li></ul>`,
  end: `<div class="bar"></div><h1 style="font-size:96px">ShopVoice</h1><h2>${REPO}</h2>
    <p>Try the hosted demo: link in the description · Open source · MIT License</p>
    <p class="muted">Built during Build, Ship, Shape: Amazon Developer Hackathon 2026</p>
    <p class="muted" style="font-size:24px">Voices: Piper (en_US bryce, joe, kristin: public domain / CC0; vi_VN vais1000: VAIS-1000 corpus, CC BY 4.0). Simulated Alexa+ experience; no affiliation implied.</p>`
};

mkdirSync('demo/video/cards', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [name, body] of Object.entries(cards)) {
  await page.setContent(`<html><head><style>${base}</style></head><body>${body}</body></html>`);
  await page.screenshot({ path: `demo/video/cards/${name}.png` });
}
await browser.close();
console.log(`cards: ${Object.keys(cards).join(', ')}`);
