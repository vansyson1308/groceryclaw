#!/usr/bin/env node
// Daily reseed of the hosted demo shop (Render cron, 00:05 shop time).
// Replaces only the demo tenant's rows with the demo seed anchored to today in
// DEMO_SHOP_TIMEZONE, so "today" and "last Friday" always have data during
// judging, and visitors' drafts and remembered preferences are cleared.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { adminConnectionString, connectWithRetry, todayIn } from './pg_admin.mjs';
import { registerDemoTokens } from './demo_tokens.mjs';

const SEED_FILE = new URL('../../db/v2/seed/002_demo_shop_seed.sql', import.meta.url);

/** Applies the demo seed anchored to `today` and re-registers the demo tokens. */
export async function reseedDemo(client, { today, env = process.env } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? '')) throw new Error('today must be YYYY-MM-DD');
  // Session-level setting read by the seed's demo_anchor table; the seed has its own BEGIN/COMMIT.
  await client.query("SELECT set_config('demo.anchor_date', $1, false)", [today]);
  await client.query(readFileSync(SEED_FILE, 'utf8'));
  return registerDemoTokens(client, env);
}

async function main() {
  const today = todayIn(process.env.DEMO_SHOP_TIMEZONE || 'Asia/Ho_Chi_Minh');
  const client = await connectWithRetry(adminConnectionString());
  try {
    const tokens = await reseedDemo(client, { today });
    console.log(`reseeded demo tenant for ${today} (${tokens.length} token(s) registered)`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`reseed failed: ${error.message}`);
    process.exit(1);
  });
}
