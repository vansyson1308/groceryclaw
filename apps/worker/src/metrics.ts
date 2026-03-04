import { createServer } from 'node:http';

const counters = {
  processed: 0,
  failed: 0,
  durationMsTotal: 0,
  notifierSentTotal: 0,
  notifierDeferredTotal: 0,
  notifierFailedTotal: 0,
  notifierSendDurationMsTotal: 0,
  notifierFlushDurationMsTotal: 0,
  notifierPendingBacklogGauge: 0,
  queueLagMsTotal: 0,
  queueLagSamples: 0,
  jobDurationMsByType: new Map<string, { total: number; count: number }>()
};

export function recordJobSuccess(durationMs: number) {
  counters.processed += 1;
  counters.durationMsTotal += durationMs;
}

export function recordJobFailure(durationMs: number) {
  counters.failed += 1;
  counters.durationMsTotal += durationMs;
}

export function recordNotifierSent(durationMs: number) {
  counters.notifierSentTotal += 1;
  counters.notifierSendDurationMsTotal += durationMs;
}

export function recordNotifierDeferred() {
  counters.notifierDeferredTotal += 1;
}

export function recordNotifierFailed() {
  counters.notifierFailedTotal += 1;
}

export function recordNotifierFlushDuration(durationMs: number) {
  counters.notifierFlushDurationMsTotal += durationMs;
}

export function setNotifierPendingBacklog(value: number) {
  counters.notifierPendingBacklogGauge = Math.max(0, value);
}


export function recordQueueLag(durationMs: number) {
  counters.queueLagSamples += 1;
  counters.queueLagMsTotal += Math.max(0, durationMs);
}

export function recordJobDurationByType(jobType: string, durationMs: number) {
  const current = counters.jobDurationMsByType.get(jobType) ?? { total: 0, count: 0 };
  current.total += Math.max(0, durationMs);
  current.count += 1;
  counters.jobDurationMsByType.set(jobType, current);
}

export function startWorkerMetricsServer(host: string, port: number) {
  const server = createServer((req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found\n');
      return;
    }

    const lines = [
      '# TYPE groceryclaw_worker_jobs_processed_total counter',
      `groceryclaw_worker_jobs_processed_total ${counters.processed}`,
      '# TYPE groceryclaw_worker_job_failures_total counter',
      `groceryclaw_worker_job_failures_total ${counters.failed}`,
      '# TYPE groceryclaw_worker_job_duration_ms_total counter',
      `groceryclaw_worker_job_duration_ms_total ${counters.durationMsTotal}`,
      '# TYPE groceryclaw_notifier_sent_total counter',
      `groceryclaw_notifier_sent_total ${counters.notifierSentTotal}`,
      '# TYPE groceryclaw_notifier_deferred_total counter',
      `groceryclaw_notifier_deferred_total ${counters.notifierDeferredTotal}`,
      '# TYPE groceryclaw_notifier_failed_total counter',
      `groceryclaw_notifier_failed_total ${counters.notifierFailedTotal}`,
      '# TYPE groceryclaw_notifier_send_duration_ms_total counter',
      `groceryclaw_notifier_send_duration_ms_total ${counters.notifierSendDurationMsTotal}`,
      '# TYPE groceryclaw_notifier_flush_duration_ms_total counter',
      `groceryclaw_notifier_flush_duration_ms_total ${counters.notifierFlushDurationMsTotal}`,
      '# TYPE groceryclaw_notifier_pending_backlog gauge',
      `groceryclaw_notifier_pending_backlog ${counters.notifierPendingBacklogGauge}`,
      '# TYPE groceryclaw_worker_queue_lag_ms_total counter',
      `groceryclaw_worker_queue_lag_ms_total ${counters.queueLagMsTotal}`,
      '# TYPE groceryclaw_worker_queue_lag_samples_total counter',
      `groceryclaw_worker_queue_lag_samples_total ${counters.queueLagSamples}`
    ];

    for (const [jobType, value] of counters.jobDurationMsByType.entries()) {
      lines.push(`# TYPE groceryclaw_worker_job_duration_ms_by_type_total counter`);
      lines.push(`groceryclaw_worker_job_duration_ms_by_type_total{job_type="${jobType}"} ${value.total}`);
      lines.push(`# TYPE groceryclaw_worker_job_duration_ms_by_type_count counter`);
      lines.push(`groceryclaw_worker_job_duration_ms_by_type_count{job_type="${jobType}"} ${value.count}`);
    }

    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
    res.end(`${lines.join('\n')}\n`);
  });

  server.listen(port, host);
}
