#!/usr/bin/env node
import { execSync } from 'node:child_process';

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const base = arg('base', process.env.RELEASE_BASE ?? 'origin/main');
const head = arg('head', process.env.RELEASE_HEAD ?? 'HEAD');
const forceAll = (arg('force-all', 'false') ?? 'false') === 'true';
const githubOutput = arg('github-output', process.env.GITHUB_OUTPUT ?? '');

const serviceMatchers = {
  gateway: [/^apps\/gateway\//, /^infra\/deploy\/gateway\//],
  admin: [/^apps\/admin\//, /^infra\/deploy\/admin\//],
  worker: [/^apps\/worker\//, /^infra\/deploy\/worker\//]
};

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

function output(result) {
  if (githubOutput) {
    const lines = [
      `services=${JSON.stringify(result.services)}`,
      `run_migrations=${result.run_migrations}`,
      `shared_trigger=${result.shared_trigger}`,
      `fallback_all=${result.fallback_all}`,
      `reason=${result.reason.replace(/\n/g, ' ')}`
    ];
    execSync(`cat >> "${githubOutput}" <<'OUT'\n${lines.join('\n')}\nOUT\n`, { stdio: 'inherit', shell: '/bin/bash' });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (forceAll) {
  output({
    base,
    head,
    changed_files_count: 0,
    shared_trigger: true,
    services: ['gateway', 'admin', 'worker'],
    run_migrations: true,
    fallback_all: true,
    reason: 'force_all_requested'
  });
  process.exit(0);
}

let files;
try {
  const out = execSync(`git diff --name-only ${base}...${head}`, { encoding: 'utf8' });
  files = out.split('\n').map((x) => x.trim()).filter(Boolean);
} catch (error) {
  output({
    base,
    head,
    changed_files_count: 0,
    shared_trigger: true,
    services: ['gateway', 'admin', 'worker'],
    run_migrations: true,
    fallback_all: true,
    reason: `git_diff_failed:${error instanceof Error ? error.message : 'unknown'}`
  });
  process.exit(0);
}

if (files.length === 0) {
  output({
    base,
    head,
    changed_files_count: 0,
    shared_trigger: true,
    services: ['gateway', 'admin', 'worker'],
    run_migrations: false,
    fallback_all: true,
    reason: 'no_changed_files_detected'
  });
  process.exit(0);
}

const sharedTrigger = files.some((f) => sharedMatchers.some((m) => m.test(f)));
const services = new Set();
if (sharedTrigger) {
  services.add('gateway');
  services.add('admin');
  services.add('worker');
} else {
  for (const [svc, matchers] of Object.entries(serviceMatchers)) {
    if (files.some((f) => matchers.some((m) => m.test(f)))) services.add(svc);
  }
}

if (services.size === 0) {
  output({
    base,
    head,
    changed_files_count: files.length,
    shared_trigger: true,
    services: ['gateway', 'admin', 'worker'],
    run_migrations: false,
    fallback_all: true,
    reason: 'unmapped_changes_default_all'
  });
  process.exit(0);
}

const runMigrations = files.some((f) => /^db\/v2\//.test(f) || /^scripts\/v2\/db_v2_/.test(f));
output({
  base,
  head,
  changed_files_count: files.length,
  shared_trigger: sharedTrigger,
  services: [...services],
  run_migrations: runMigrations,
  fallback_all: false,
  reason: 'ok'
});
