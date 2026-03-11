#!/usr/bin/env node
/**
 * Example script (template): detect changed deploy units from git diff.
 *
 * Usage:
 *   node infra/deploy/ci/detect-changed-services.example.mjs <base> <head>
 * Example:
 *   node infra/deploy/ci/detect-changed-services.example.mjs origin/main HEAD
 */
import { execSync } from 'node:child_process';

const base = process.argv[2] ?? 'origin/main';
const head = process.argv[3] ?? 'HEAD';

function listChangedFiles() {
  const out = execSync(`git diff --name-only ${base}...${head}`, { encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

const changed = listChangedFiles();

const sharedMatchers = [
  /^packages\/common\//,
  /^db\/v2\//,
  /^scripts\/v2\/db_v2_/,
  /^infra\/k8s\/base\//,
  /^infra\/k8s\/overlays\/prod\//,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^tsconfig\.base\.json$/,
  /^tsconfig\.build\.json$/
];

const serviceMatchers = {
  gateway: [/^apps\/gateway\//, /^infra\/deploy\/gateway\//],
  admin: [/^apps\/admin\//, /^infra\/deploy\/admin\//],
  worker: [/^apps\/worker\//, /^infra\/deploy\/worker\//]
};

const hasShared = changed.some((f) => sharedMatchers.some((m) => m.test(f)));
let services = new Set();

if (hasShared) {
  services = new Set(['gateway', 'admin', 'worker']);
} else {
  for (const [service, matchers] of Object.entries(serviceMatchers)) {
    if (changed.some((f) => matchers.some((m) => m.test(f)))) {
      services.add(service);
    }
  }
}

const runMigrations = changed.some((f) => /^db\/v2\//.test(f) || /^scripts\/v2\/db_v2_/.test(f));

const result = {
  base,
  head,
  changed_files_count: changed.length,
  shared_trigger: hasShared,
  services: [...services],
  run_migrations: runMigrations
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
