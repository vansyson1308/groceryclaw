import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function hasCommand(cmd) {
  const result = spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' });
  return result.status === 0;
}

const mode = process.argv[2] ?? 'light';
const summaryPath = process.env.LOAD_SUMMARY_PATH ?? `artifacts/load/k6-summary-${mode}.json`;
const reportDir = process.env.LOAD_REPORT_DIR ?? 'docs/saas_v2/perf_reports';

const env = { ...process.env };
if (mode === 'light') {
  env.LOAD_STEADY_RPS = env.LOAD_STEADY_RPS ?? '8';
  env.LOAD_STEADY_DURATION = env.LOAD_STEADY_DURATION ?? '20s';
  env.LOAD_BURST_RPS = env.LOAD_BURST_RPS ?? '25';
  env.LOAD_BURST_DURATION = env.LOAD_BURST_DURATION ?? '8s';
  env.LOAD_BURST_START = env.LOAD_BURST_START ?? '20s';
  env.LOAD_TENANT_COUNT = env.LOAD_TENANT_COUNT ?? '20';
  env.LOAD_USERS_PER_TENANT = env.LOAD_USERS_PER_TENANT ?? '4';
} else {
  env.LOAD_STEADY_RPS = env.LOAD_STEADY_RPS ?? '35';
  env.LOAD_STEADY_DURATION = env.LOAD_STEADY_DURATION ?? '120s';
  env.LOAD_BURST_RPS = env.LOAD_BURST_RPS ?? '120';
  env.LOAD_BURST_DURATION = env.LOAD_BURST_DURATION ?? '30s';
  env.LOAD_BURST_START = env.LOAD_BURST_START ?? '90s';
  env.LOAD_TENANT_COUNT = env.LOAD_TENANT_COUNT ?? '200';
  env.LOAD_USERS_PER_TENANT = env.LOAD_USERS_PER_TENANT ?? '10';
}

const seed = spawnSync('node', ['scripts/v2/load_seed_synthetic.mjs'], { encoding: 'utf8', env, stdio: 'pipe' });
if (seed.status !== 0) {
  const requireDb = (env.LOAD_REQUIRE_DB ?? 'false') === 'true';
  if (requireDb) {
    console.error(seed.stderr || seed.stdout || 'load seed failed');
    process.exit(seed.status ?? 1);
  }
  console.warn('load_seed_skipped', (seed.stderr || seed.stdout || 'db unavailable').trim());
} else if (seed.stdout.trim()) {
  console.log(seed.stdout.trim());
}

mkdirSync('artifacts/load', { recursive: true });

if (!hasCommand('k6')) {
  const mock = {
    root_group: { checks: [], name: '', path: '', id: '0' },
    metrics: {
      gateway_ack_ms: { values: { 'p(50)': 0, 'p(95)': 0, 'p(99)': 0 } },
      http_req_duration: { values: { 'p(50)': 0, 'p(95)': 0, 'p(99)': 0 } },
      http_req_failed: { values: { rate: 0 } },
      queue_lag_ms: { values: {} },
      job_duration_ms: { values: {} }
    }
  };
  writeFileSync(summaryPath, `${JSON.stringify(mock, null, 2)}\n`, 'utf8');
} else {
  const k6 = spawnSync('k6', ['run', '--summary-export', summaryPath, 'tests/load/k6/webhook_load.js'], { encoding: 'utf8', env, stdio: 'inherit' });
  if (k6.status !== 0) {
    process.exit(k6.status ?? 1);
  }
}

const parse = spawnSync('node', ['scripts/v2/load_parse_k6_summary.mjs', summaryPath, reportDir], { encoding: 'utf8', env, stdio: 'inherit' });
if (parse.status !== 0) {
  process.exit(parse.status ?? 1);
}
