#!/usr/bin/env node
// Checks docs/directory/SUBMISSION_KIT.md: every `<!-- kit:<field> max=N -->`
// block is within its portal limit; the reviewer password is only a placeholder;
// no secrets. With --host <host>, replaces the SHOPVOICE_HOST placeholder in the
// kit (run once after deploy) and then checks that none remains.
//
// Usage: node scripts/directory/check_kit.mjs [--host d123.cloudfront.net] [--file path]
import { readFileSync, writeFileSync } from 'node:fs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const file = arg('--file', 'docs/directory/SUBMISSION_KIT.md');
const host = arg('--host');
let text = readFileSync(file, 'utf8');
const errors = [];

if (host) {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) {
    console.error(`--host must be a bare hostname, got "${host}"`);
    process.exit(2);
  }
  text = text.replaceAll('SHOPVOICE_HOST', host);
  writeFileSync(file, text);
  console.log(`replaced SHOPVOICE_HOST with ${host} in ${file}`);
}

const re = /<!-- kit:([a-z_]+) max=(\d+) -->\s*```text\n([\s\S]*?)\n```/g;
const rows = [];
for (const m of text.matchAll(re)) {
  const [, field, max, body] = m;
  const length = [...body].length; // code points, as the portal counts characters
  rows.push({ field, length, max: Number(max) });
  if (length > Number(max)) errors.push(`${field}: ${length} > ${max} characters`);
  if (length === 0) errors.push(`${field}: empty`);
}
const required = ['server_url', 'name', 'tagline', 'description', 'docs_url', 'privacy_url', 'support', 'slug', 'use_cases', 'prerequisites', 'test_instructions', 'plugin_repo'];
for (const f of required) if (!rows.some((r) => r.field === f)) errors.push(`missing field block: ${f}`);

if (!text.includes('<<REVIEWER_PASSWORD>>')) errors.push('reviewer password placeholder <<REVIEWER_PASSWORD>> is missing');
if (/Password:\s*(?!<<REVIEWER_PASSWORD>>)\S{8,}/.test(text)) errors.push('a literal password appears in the kit; keep only the placeholder');
if (/svat_|svrt_|sv_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|OAUTH_COOKIE_SECRET=\S/.test(text)) errors.push('something that looks like a secret appears in the kit');
if (host && text.includes('SHOPVOICE_HOST')) errors.push('SHOPVOICE_HOST placeholder still present');
const slug = rows.find((r) => r.field === 'slug');
if (slug && !/```text\n[a-z0-9-]+\n```/.test(text.slice(text.indexOf('kit:slug')))) errors.push('slug must be lowercase letters, digits and hyphens');

for (const r of rows) console.log(`${r.length <= r.max ? 'ok  ' : 'FAIL'} ${r.field.padEnd(18)} ${String(r.length).padStart(5)} / ${r.max}`);
const pending = text.includes('SHOPVOICE_HOST');
console.log(pending ? '\nnote: host placeholder SHOPVOICE_HOST still present (run with --host <deployed host> after deploy)' : '\nhost filled in');
if (errors.length) {
  console.error(`\n${errors.join('\n')}`);
  process.exit(1);
}
console.log('kit OK');
