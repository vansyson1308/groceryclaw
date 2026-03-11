import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

const pathRegex = /`((?:docs|infra|scripts|tools|tests|apps|packages)\/[^`\s]+)`/g;
const missing = new Set();
const allowMissing = new Set(['infra/compose/v2/.env']);

for (const match of readme.matchAll(pathRegex)) {
  const rel = match[1];
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs) && !allowMissing.has(rel)) missing.add(rel);
}

if (missing.size > 0) {
  console.error('README contains missing relative paths:');
  for (const item of [...missing].sort()) console.error(` - ${item}`);
  process.exit(1);
}

console.log('README path check passed.');
