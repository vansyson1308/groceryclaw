import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { loadPerfReport, evaluatePerfGate } from '../../scripts/v2/perf_gate.mjs';

test('perf gate passes with compliant report fixture', () => {
  const report = loadPerfReport('tests/fixtures/perf_report_good.json');
  const result = evaluatePerfGate(report, {
    variance: 0.1,
    requireQueueLagMetric: true,
    requireDuplicateMetric: true
  });
  assert.equal(result.pass, true);
  assert.equal(result.checks.every((x) => x.pass), true);
});

test('perf gate fails with bad report fixture', () => {
  const report = loadPerfReport('tests/fixtures/perf_report_bad.json');
  const result = evaluatePerfGate(report, {
    variance: 0.05,
    requireQueueLagMetric: true,
    requireDuplicateMetric: true
  });
  assert.equal(result.pass, false);
  assert.equal(result.checks.some((x) => x.pass === false), true);
});

test('perf gate CLI exits non-zero on bad fixture by default', () => {
  const run = spawnSync('node', ['scripts/v2/perf_gate.mjs', 'tests/fixtures/perf_report_bad.json'], {
    encoding: 'utf8'
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stdout, /perf_gate_pass=false/);
});

test('perf gate CLI supports warn-only mode', () => {
  const run = spawnSync('node', ['scripts/v2/perf_gate.mjs', 'tests/fixtures/perf_report_bad.json'], {
    encoding: 'utf8',
    env: { ...process.env, PERF_GATE_WARN_ONLY: 'true' }
  });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /perf_gate_pass=false/);
});
