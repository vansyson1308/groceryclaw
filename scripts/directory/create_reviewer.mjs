#!/usr/bin/env node
// Creates the Claude-directory reviewer account on a ShopVoice deployment
// through the public sign-up form (so it gets a fully populated demo shop),
// then proves the password works by signing in again.
// The password is generated here and NEVER printed: it goes only to an SSM
// SecureString (--ssm-name) or a 0600 file (--password-file), or both.
//
// Usage:
//   node scripts/directory/create_reviewer.mjs --base-url https://xxx.cloudfront.net \
//     --email claude-reviewer@example.com --ssm-name /shopvoice/demo/reviewer-password [--region us-east-1]
//   node scripts/directory/create_reviewer.mjs --base-url http://localhost:8090 --email r@example.com --password-file /tmp/pw
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const base = (arg('--base-url') ?? '').replace(/\/+$/, '');
const email = arg('--email');
const ssmName = arg('--ssm-name');
const passwordFile = arg('--password-file');
const region = arg('--region', process.env.AWS_REGION ?? 'us-east-1');
const locale = arg('--locale', 'en');
if (!base || !email || (!ssmName && !passwordFile)) {
  console.error('usage: create_reviewer.mjs --base-url <url> --email <email> (--ssm-name <param> | --password-file <path>)');
  process.exit(2);
}

// 24 characters from an unambiguous alphabet.
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const password = [...randomBytes(24)].map((b) => alphabet[b % alphabet.length]).join('');

const cookies = new Map();
const absorb = (res) => {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return res;
};
const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
const csrfOf = (html) => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';

async function accountPost(fields, csrf) {
  return absorb(await fetch(`${base}/account`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader() },
    body: new URLSearchParams({ csrf, ...fields })
  }));
}

const page = absorb(await fetch(`${base}/account`));
const csrf = csrfOf(await page.text());
const signup = await accountPost({ action: 'signup', email, password, password_confirm: password, locale, accept_terms: 'on' }, csrf);
if (signup.status !== 303) {
  const body = await signup.text();
  const reason = /class="err"[^>]*>([^<]+)</.exec(body)?.[1] ?? `HTTP ${signup.status}`;
  console.error(`sign-up failed: ${reason}`);
  process.exit(1);
}
cookies.delete('sv_session');
const again = absorb(await fetch(`${base}/account`, { headers: { cookie: cookieHeader() } }));
const login = await accountPost({ action: 'login', email, password }, csrfOf(await again.text()));
if (login.status !== 303) {
  console.error(`sign-in check failed: HTTP ${login.status}`);
  process.exit(1);
}
const acct = await (await fetch(`${base}/account`, { headers: { cookie: cookieHeader() } })).text();
const shop = /<div class="muted">(?:Shop|Cửa hàng)<\/div>([^<]+)/.exec(acct)?.[1]?.trim() ?? '?';

if (passwordFile) writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });
if (ssmName) {
  // Pass the value through a 0600 temp file so it never appears in a process list.
  const dir = mkdtempSync(join(tmpdir(), 'svrev-'));
  const input = join(dir, 'input.json');
  writeFileSync(input, JSON.stringify({ Name: ssmName, Type: 'SecureString', Overwrite: true, Value: password, Description: 'ShopVoice Claude-directory reviewer password' }), { mode: 0o600 });
  try {
    execFileSync('aws', ['ssm', 'put-parameter', '--region', region, '--cli-input-json', `file://${input}`], { stdio: ['ignore', 'ignore', 'inherit'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(`Reviewer account ready: ${email} (shop: ${shop}).`);
console.log(`Password stored in ${[ssmName && `SSM ${ssmName} (${region})`, passwordFile && passwordFile].filter(Boolean).join(' and ')}; it was not printed.`);
