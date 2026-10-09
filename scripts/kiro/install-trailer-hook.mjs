#!/usr/bin/env node
// Installs a prepare-commit-msg hook in this clone that appends the trailer
// "Built-with: Kiro" to every commit message (all worktrees share the hook).
// Used only on the machine where Kiro runs; see docs/hackathon/KIRO_RUNBOOK.md.
//
//   node scripts/kiro/install-trailer-hook.mjs            # install
//   node scripts/kiro/install-trailer-hook.mjs --remove   # uninstall
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MARKER = '# groceryclaw: Built-with: Kiro trailer';
const HOOK = [
  '#!/bin/sh',
  MARKER,
  'git interpret-trailers --in-place --if-exists doNothing --trailer "Built-with: Kiro" "$1"',
  ''
].join('\n');

const commonDir = resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim());
const hooksDir = join(commonDir, 'hooks');
const hookPath = join(hooksDir, 'prepare-commit-msg');

if (process.argv.includes('--remove')) {
  if (existsSync(hookPath) && readFileSync(hookPath, 'utf8').includes(MARKER)) {
    rmSync(hookPath);
    console.log(`Removed ${hookPath}`);
  } else {
    console.log('No Kiro trailer hook installed.');
  }
  process.exit(0);
}

if (existsSync(hookPath) && !readFileSync(hookPath, 'utf8').includes(MARKER)) {
  console.error(`A different prepare-commit-msg hook already exists at ${hookPath}; not overwriting it.`);
  process.exit(1);
}
mkdirSync(hooksDir, { recursive: true });
// LF line endings on purpose: Git for Windows runs hooks with sh.
writeFileSync(hookPath, HOOK, { encoding: 'utf8' });
try {
  chmodSync(hookPath, 0o755);
} catch {
  // Windows ignores the mode bits; Git for Windows runs the hook anyway.
}
console.log(`Installed ${hookPath}: every commit in this clone gets "Built-with: Kiro".`);
