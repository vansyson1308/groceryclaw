#!/usr/bin/env node
// Builds the publishable ShopVoice plugin from plugins/shopvoice:
//   - fills in the deployed host (SHOPVOICE_HOST in .mcp.json, plugin.json, README)
//   - adds the plugin repo's CI workflow and .gitignore
//   - checks the directory rules (README >= 40 words, file sizes and types,
//     no placeholders or secrets), runs `claude plugin validate`
//   - writes dist/shopvoice-plugin/ (the vansyson1308/shopvoice-plugin repo
//     root) and dist/shopvoice-plugin.zip (Customize > Plugins > Upload plugin)
//
// Usage: node scripts/directory/build_plugin.mjs --host shopvoice.example.com [--out dist]
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const host = (arg('--host') ?? '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const outRoot = arg('--out', 'dist');
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) || /SHOPVOICE_HOST|example\.(com|org)$/i.test(host)) {
  console.error('usage: build_plugin.mjs --host <deployed host, e.g. d123.cloudfront.net or shopvoice.app>');
  process.exit(2);
}
const SRC = 'plugins/shopvoice';
const OUT = join(outRoot, 'shopvoice-plugin');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });
cpSync(SRC, OUT, { recursive: true, filter: (p) => !/\/evals\/results(\/|$)/.test(p) && !/\.DS_Store$/.test(p) });

for (const rel of ['.mcp.json', '.claude-plugin/plugin.json', 'README.md']) {
  const p = join(OUT, rel);
  writeFileSync(p, readFileSync(p, 'utf8').replaceAll('SHOPVOICE_HOST', host));
}

mkdirSync(join(OUT, '.github/workflows'), { recursive: true });
writeFileSync(join(OUT, '.github/workflows/validate.yml'), `name: validate
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: claude plugin validate
        run: npx -y @anthropic-ai/claude-code@2.1.283 plugin validate .
      - name: directory rules
        run: node .github/check-plugin.mjs
`);
writeFileSync(join(OUT, '.github/check-plugin.mjs'), `// Directory pre-submission rules that plugin validate does not cover.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const errors = [];
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === '.git' ? [] : walk(p)) : [p]; });
const files = walk('.');
const readme = readFileSync('README.md', 'utf8').replace(/\`\`\`[\\s\\S]*?\`\`\`/g, '');
if (readme.split(/\\s+/).filter(Boolean).length < 40) errors.push('README.md needs at least 40 words outside code blocks');
if (!files.some((f) => f === 'LICENSE')) errors.push('LICENSE missing');
if (files.length > 512) errors.push('more than 512 files');
for (const f of files) {
  const size = statSync(f).size;
  if (!/\\.(png|jpe?g|gif|webp)$/i.test(f) && size > 256 * 1024) errors.push(\`\${f} is over 256 KiB\`);
  if (/(^|\\/)(\\.DS_Store|Thumbs\\.db|desktop\\.ini)$/.test(f)) errors.push(\`\${f} must not be committed\`);
  if (/\\.(zip|pdf|ico|exe|dll|so|dylib|mcpb|dxt)$/i.test(f)) errors.push(\`\${f}: binary type is held for review\`);
  if (/(^|\\/)(package-lock\\.json|npm-shrinkwrap\\.json|bun\\.lockb?|\\.npmrc)$/.test(f)) errors.push(\`\${f}: lockfiles and registry config are not allowed\`);
}
const mcp = JSON.parse(readFileSync('.mcp.json', 'utf8'));
for (const [name, s] of Object.entries(mcp.mcpServers ?? {})) {
  if (s.type !== 'http' || !/^https:\\/\\/[^/]+\\/mcp$/.test(s.url ?? '')) errors.push(\`.mcp.json server \${name} must be type http with an https .../mcp url\`);
  if (s.headers) errors.push(\`.mcp.json server \${name} must not carry headers (no secrets in plugins)\`);
}
if (existsSyncSafe('bin')) errors.push('a top-level bin/ stops claude.ai and Cowork from installing the plugin');
function existsSyncSafe(p) { try { statSync(p); return true; } catch { return false; } }
if (errors.length) { console.error(errors.join('\\n')); process.exit(1); }
console.log(\`plugin rules OK (\${files.length} files)\`);
`);
writeFileSync(join(OUT, '.gitignore'), 'evals/results/\n.DS_Store\n');

// Local checks (same as the repo's CI).
const bad = [];
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
for (const f of walk(OUT)) {
  const text = /\.(md|json|yml|mjs|txt)$|LICENSE$|\.gitignore$/.test(f) ? readFileSync(f, 'utf8') : '';
  if (text.includes('SHOPVOICE_HOST')) bad.push(`${relative(OUT, f)} still contains SHOPVOICE_HOST`);
  if (/svat_[A-Za-z0-9_-]{20}|svrt_[A-Za-z0-9_-]{20}|sv_[A-Za-z0-9]{40}|BEGIN (RSA|EC) PRIVATE KEY|AKIA[0-9A-Z]{16}/.test(text)) bad.push(`${relative(OUT, f)} looks like it contains a secret`);
}
if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
execFileSync('node', ['.github/check-plugin.mjs'], { cwd: OUT, stdio: 'inherit' });
execFileSync('claude', ['plugin', 'validate', '.'], { cwd: OUT, stdio: 'inherit' });

const zip = join(outRoot, 'shopvoice-plugin.zip');
rmSync(zip, { force: true });
// Zip the plugin contents at the archive root (evals and CI files are not needed to install).
execFileSync('zip', ['-qr', relative(OUT, zip), '.', '-x', '.git/*', 'evals/*', '.github/*', '.gitignore'], { cwd: OUT });
console.log(`\nBuilt ${OUT} (repo root) and ${zip} for host ${host}.`);
if (!existsSync(join(OUT, '.mcp.json'))) process.exit(1);
