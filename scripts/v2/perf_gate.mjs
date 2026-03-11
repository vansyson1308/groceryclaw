import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function findLatestPerfReport(reportDir = process.env.PERF_REPORT_DIR ?? 'docs/saas_v2/perf_reports') {
  const files = readdirSync(reportDir)
    .filter((name) => name.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    throw new Error(`no_perf_reports_found:${reportDir}`);
  }

  return join(reportDir, files[files.length - 1]);
}

export function loadPerfReport(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function evaluatePerfGate(report, options = {}) {
  const variance = asNumber(options.variance) ?? Number(process.env.PERF_GATE_VARIANCE ?? '0.10') ?? 0.10;
  const requireQueueLagMetric = (options.requireQueueLagMetric ?? process.env.PERF_GATE_REQUIRE_QUEUE_LAG ?? 'false') === 'true';
  const requireDuplicateMetric = (options.requireDuplicateMetric ?? process.env.PERF_GATE_REQUIRE_DUPLICATE_METRIC ?? 'false') === 'true';

  const budgets = {
    ackP95Ms: asNumber(options.ackP95Ms) ?? 200,
    queueLagP95Ms: asNumber(options.queueLagP95Ms) ?? 2000,
    errorRate: asNumber(options.errorRate) ?? 0.01,
    duplicateSideEffectRate: asNumber(options.duplicateSideEffectRate) ?? 0
  };

  const effective = {
    ackP95Ms: budgets.ackP95Ms * (1 + variance),
    queueLagP95Ms: budgets.queueLagP95Ms * (1 + variance),
    errorRate: budgets.errorRate * (1 + variance),
    duplicateSideEffectRate: budgets.duplicateSideEffectRate
  };

  const ackP95 = asNumber(report?.metrics?.ack_ms?.['p(95)']);
  const queueLagP95 = asNumber(report?.metrics?.queue_lag_ms?.['p(95)']);
  const errorRate = asNumber(report?.metrics?.http_req_failed?.rate);
  const duplicateRate = asNumber(report?.metrics?.duplicate_side_effect_rate);

  const checks = [
    {
      name: 'ack_p95',
      actual: ackP95,
      threshold: effective.ackP95Ms,
      pass: ackP95 !== null && ackP95 <= effective.ackP95Ms,
      required: true
    },
    {
      name: 'queue_lag_p95',
      actual: queueLagP95,
      threshold: effective.queueLagP95Ms,
      pass: queueLagP95 !== null ? queueLagP95 <= effective.queueLagP95Ms : !requireQueueLagMetric,
      required: requireQueueLagMetric
    },
    {
      name: 'error_rate',
      actual: errorRate,
      threshold: effective.errorRate,
      pass: errorRate !== null && errorRate <= effective.errorRate,
      required: true
    },
    {
      name: 'duplicate_side_effect_rate',
      actual: duplicateRate,
      threshold: effective.duplicateSideEffectRate,
      pass: duplicateRate !== null ? duplicateRate <= effective.duplicateSideEffectRate : !requireDuplicateMetric,
      required: requireDuplicateMetric
    }
  ];

  return {
    pass: checks.every((x) => x.pass),
    variance,
    budgets,
    effective,
    checks
  };
}

export function formatGateResult(result, reportPath) {
  const lines = [`perf_gate_report=${reportPath}`, `perf_gate_pass=${result.pass}`];
  for (const check of result.checks) {
    lines.push([
      check.name,
      `pass=${check.pass}`,
      `actual=${check.actual === null ? 'n/a' : check.actual}`,
      `threshold=${check.threshold}`,
      `required=${check.required}`
    ].join(' '));
  }
  return lines.join('\n');
}

function main() {
  const reportPath = process.argv[2] || findLatestPerfReport();
  const report = loadPerfReport(reportPath);
  const result = evaluatePerfGate(report, {});
  const output = formatGateResult(result, reportPath);
  console.log(output);

  const warnOnly = (process.env.PERF_GATE_WARN_ONLY ?? 'false') === 'true';
  if (!result.pass && !warnOnly) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
