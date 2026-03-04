import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const summaryPath = process.argv[2] ?? 'artifacts/load/k6-summary.json';
const outputDir = process.argv[3] ?? 'docs/saas_v2/perf_reports';
const now = new Date();
const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}_${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}`;

const raw = JSON.parse(readFileSync(summaryPath, 'utf8'));

function metric(name) {
  return raw.metrics?.[name]?.values ?? {};
}

const ack = metric('gateway_ack_ms');
const httpDuration = metric('http_req_duration');
const failedRate = metric('http_req_failed');
const queueLag = metric('queue_lag_ms');
const jobDuration = metric('job_duration_ms');

const budgets = {
  ackP95Ms: 200,
  queueLagP95Ms: 2000
};

function passFail(value, budget) {
  if (typeof value !== 'number') return 'N/A';
  return value <= budget ? 'PASS' : 'FAIL';
}

const report = {
  generated_at: now.toISOString(),
  source: summaryPath,
  budgets,
  metrics: {
    ack_ms: ack,
    http_req_duration_ms: httpDuration,
    queue_lag_ms: queueLag,
    job_duration_ms: jobDuration,
    http_req_failed: failedRate
  },
  evaluation: {
    ack_p95: passFail(ack['p(95)'], budgets.ackP95Ms),
    queue_lag_p95: passFail(queueLag['p(95)'], budgets.queueLagP95Ms),
    error_rate: typeof failedRate.rate === 'number' ? (failedRate.rate < 0.01 ? 'PASS' : 'FAIL') : 'N/A'
  }
};

mkdirSync(outputDir, { recursive: true });
mkdirSync(dirname(summaryPath), { recursive: true });

const jsonOut = join(outputDir, `${stamp}.json`);
const mdOut = join(outputDir, `${stamp}.md`);

writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const md = `# V2 Load Report (${stamp})

- Generated: ${report.generated_at}
- Source: \`${summaryPath}\`

## SLO Budget Check

| Metric | Value | Budget | Result |
|---|---:|---:|---|
| Webhook ACK p95 (ms) | ${ack['p(95)'] ?? 'n/a'} | < ${budgets.ackP95Ms} | ${report.evaluation.ack_p95} |
| Queue lag p95 (ms) | ${queueLag['p(95)'] ?? 'n/a'} | < ${budgets.queueLagP95Ms} | ${report.evaluation.queue_lag_p95} |
| Error rate | ${failedRate.rate ?? 'n/a'} | < 0.01 | ${report.evaluation.error_rate} |

## Latency Distribution (ms)

| Metric | p50 | p95 | p99 |
|---|---:|---:|---:|
| gateway_ack_ms | ${ack['p(50)'] ?? 'n/a'} | ${ack['p(95)'] ?? 'n/a'} | ${ack['p(99)'] ?? 'n/a'} |
| http_req_duration | ${httpDuration['p(50)'] ?? 'n/a'} | ${httpDuration['p(95)'] ?? 'n/a'} | ${httpDuration['p(99)'] ?? 'n/a'} |
| queue_lag_ms | ${queueLag['p(50)'] ?? 'n/a'} | ${queueLag['p(95)'] ?? 'n/a'} | ${queueLag['p(99)'] ?? 'n/a'} |
| job_duration_ms | ${jobDuration['p(50)'] ?? 'n/a'} | ${jobDuration['p(95)'] ?? 'n/a'} | ${jobDuration['p(99)'] ?? 'n/a'} |
`;

writeFileSync(mdOut, md, 'utf8');
console.log(JSON.stringify({ report_json: jsonOut, report_md: mdOut }));
