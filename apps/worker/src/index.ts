import { spawnSync } from 'node:child_process';
import {
  createLogger,
  createPgPool,
  query,
  runTenantScopedTransaction,
  loadRedisConfig,
  dbPing,
  redisPing,
  InMemoryTokenBucketRateLimiter,
  loadBaseConfig,
  Queue,
  Worker,
  NotifierOutboundRateLimiter,
  validateWorkerJobEnvelope,
  type WorkerJobEnvelope
} from '../../../packages/common/dist/index.js';
import { recordJobDurationByType, recordJobFailure, recordJobSuccess, recordQueueLag, startWorkerMetricsServer } from './metrics.js';
import { startWorkerHealthServer } from './health-server.js';
import { processInboundEventPipeline } from './process-inbound.js';
import { processMapResolve } from './mapping-resolve.js';
import { HttpKiotvietAdapter } from './kiotviet-adapter.js';
import { processKiotvietSync } from './kiotviet-sync.js';
import { NotifierRetriableError, processFlushPendingNotificationsJob, processNotifyUserJob } from './notifier.js';
import { HttpStubZaloAdapter } from './zalo-adapter.js';

const config = loadBaseConfig({
  serviceName: 'worker',
  defaultHost: '127.0.0.1',
  defaultPort: 3002
});

const logger = createLogger({ service: 'worker', level: config.logLevel });
const metricsHost = process.env.WORKER_METRICS_HOST ?? '127.0.0.1';
const metricsPort = Number(process.env.WORKER_METRICS_PORT ?? '9090');
const dbCmd = process.env.WORKER_DB_CMD ?? process.env.GATEWAY_DB_CMD ?? '';
const queueCmd = process.env.WORKER_QUEUE_CMD ?? '';
const postgresUrl = process.env.DB_APP_URL ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? '';
const workerUsePg = (process.env.WORKER_USE_PG ?? 'true') === 'true';

const redisConfig = loadRedisConfig({
  onWarning: (message) => logger.warn('worker_redis_config_deprecated', { message })
});
const queueName = process.env.BULLMQ_QUEUE_NAME ?? 'process-inbound';
const enableQueueInTest = (process.env.ENABLE_QUEUE_IN_TEST ?? 'false') === 'true';
const readyzStrict = (process.env.READYZ_STRICT ?? 'true') === 'true';
const readyzTimeoutMs = Number(process.env.READYZ_TIMEOUT_MS ?? '300');
const workerHealthServerEnabled = (process.env.WORKER_HEALTH_SERVER_ENABLED ?? 'true') === 'true';
const workerHealthPort = Number(process.env.WORKER_HEALTH_PORT ?? process.env.WORKER_PORT ?? '3002');
const defaultAttempts = Number(process.env.NOTIFIER_MAX_ATTEMPTS ?? '4');

const pgPool = (postgresUrl && workerUsePg)
  ? await createPgPool({
      connectionString: postgresUrl,
      applicationName: 'worker',
      statementTimeoutMs: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? '5000')
    })
  : null;
const queue = (() => {
  if (process.env.NODE_ENV === 'test' && !enableQueueInTest) return null;
  return new Queue(queueName, {
    connection: {
      host: redisConfig.host,
      port: redisConfig.port,
      db: redisConfig.db,
      ...(redisConfig.password ? { password: redisConfig.password } : {})
    }
  });
})();

const interactionWindowEnforced = (process.env.WORKER_INTERACTION_WINDOW_ENFORCED ?? 'true') === 'true';
const flushPendingEnabled = (process.env.WORKER_FLUSH_PENDING_ENABLED ?? 'true') === 'true';
const dlqEnabled = (process.env.NOTIFIER_DLQ_ENABLED ?? 'true') === 'true';
const flushRateLimiter = new InMemoryTokenBucketRateLimiter(
  Number(process.env.WORKER_FLUSH_RATE_PER_MINUTE ?? '60'),
  Number(process.env.WORKER_FLUSH_RATE_PER_MINUTE ?? '60')
);
const outboundRateLimiter = new NotifierOutboundRateLimiter({
  enabled: (process.env.NOTIFIER_RATE_LIMIT_ENABLED ?? 'true') === 'true',
  globalPerMinute: Number(process.env.NOTIFIER_GLOBAL_RATE_PER_MINUTE ?? '120'),
  perTenantPerMinute: Number(process.env.NOTIFIER_TENANT_RATE_PER_MINUTE ?? '30'),
  perUserBurst: Number(process.env.NOTIFIER_USER_BURST ?? '5')
});

function runCmdAdapter(command: string, input: string): string {
  const [exec, ...args] = command.trim().split(/\s+/);
  if (!exec) throw new Error('worker_adapter_error');
  const result = spawnSync(exec, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error('worker_adapter_error');
  return result.stdout.trim();
}

async function runSql(sql: string, params: readonly unknown[] = []): Promise<void> {
  if (pgPool) {
    await query(pgPool, sql, params);
    return;
  }
  if (process.env.NODE_ENV === 'test' && dbCmd) {
    runCmdAdapter(dbCmd, sql);
    return;
  }
  throw new Error('worker_db_not_configured');
}

async function runQueryOne(sql: string, params: readonly unknown[] = []): Promise<string> {
  if (pgPool) {
    const result = await query(pgPool, sql, params);
    if (result.rows.length === 0) return '';
    const row = result.rows[0] ?? {};
    return Object.values(row).join('|').trim();
  }
  if (process.env.NODE_ENV === 'test' && dbCmd) {
    return runCmdAdapter(dbCmd, sql);
  }
  return '';
}

async function runQueryMany(sql: string, params: readonly unknown[] = []): Promise<string[]> {
  const out = await runQueryOne(sql, params);
  return out.split('\n').map((x) => x.trim()).filter(Boolean);
}

async function enqueue(payload: Record<string, unknown>): Promise<void> {
  if (queue) {
    await queue.add(String(payload.job_type ?? 'UNKNOWN_JOB'), payload, {
      attempts: Number(process.env.BULLMQ_DEFAULT_ATTEMPTS ?? '4'),
      removeOnComplete: Number(process.env.BULLMQ_REMOVE_ON_COMPLETE ?? '1000'),
      removeOnFail: Number(process.env.BULLMQ_REMOVE_ON_FAIL ?? '1000')
    });
    return;
  }
  if (process.env.NODE_ENV === 'test' && queueCmd) {
    const [exec, ...args] = queueCmd.trim().split(/\s+/);
    if (!exec) throw new Error('worker_queue_error');
    const result = spawnSync(exec, [...args, JSON.stringify(payload)], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('worker_queue_error');
    return;
  }
  throw new Error('worker_queue_not_configured');
}

async function processInboundEvent(job: WorkerJobEnvelope): Promise<void> {
  await processInboundEventPipeline({
    queryOne: runQueryOne,
    exec: runSql,
    runInTenantTransaction: async (tenantId, jobType, work) => {
      if (!pgPool) {
        return work({ queryOne: runQueryOne, exec: runSql });
      }

      return runTenantScopedTransaction({
        pool: pgPool,
        tenantId,
        applicationName: `worker:${jobType}`,
        work: async (client) => work({
          queryOne: async (sql, params = []) => {
            const result = await query(client, sql, params);
            if (result.rows.length === 0) return '';
            const row = result.rows[0] ?? {};
            return Object.values(row).join('|').trim();
          },
          exec: async (sql, params = []) => {
            await query(client, sql, params);
          }
        })
      });
    },
    enqueue,
    xmlParseEnabled: (process.env.WORKER_XML_PARSE_ENABLED ?? 'true') === 'true',
    allowedDomains: (process.env.WORKER_XML_ALLOWED_DOMAINS ?? 'zalo.me,zadn.vn').split(',').map((x) => x.trim()).filter(Boolean),
    maxBytes: Number(process.env.WORKER_XML_MAX_BYTES ?? '1048576'),
    timeoutMs: Number(process.env.WORKER_XML_TIMEOUT_MS ?? '10000')
  }, job);
}

function notifierDeps() {
  return {
    exec: runSql,
    queryOne: runQueryOne,
    queryMany: runQueryMany,
    adapter: new HttpStubZaloAdapter(
      process.env.ZALO_STUB_BASE_URL ?? 'http://127.0.0.1:18081',
      process.env.ZALO_STUB_TOKEN ?? 'stub-zalo-token',
      Number(process.env.ZALO_STUB_TIMEOUT_MS ?? '2000')
    ),
    enabled: (process.env.WORKER_NOTIFIER_ENABLED ?? 'true') === 'true',
    interactionWindowEnforced,
    flushEnabled: flushPendingEnabled,
    dlqEnabled,
    maxMessageLen: Number(process.env.NOTIFIER_MAX_MESSAGE_LENGTH ?? '500'),
    interactionWindowSeconds: Number(process.env.WORKER_INTERACTION_WINDOW_SECONDS ?? '86400'),
    pendingTtlSeconds: Number(process.env.WORKER_PENDING_TTL_SECONDS ?? '604800'),
    maxPendingPerUser: Number(process.env.WORKER_MAX_PENDING_PER_USER ?? '20'),
    flushBatchSize: Number(process.env.WORKER_FLUSH_BATCH_SIZE ?? '20'),
    flushMaxPerRun: Number(process.env.WORKER_FLUSH_MAX_PER_RUN ?? '50'),
    flushRateLimiter,
    outboundRateLimiter,
    retryBaseMs: Number(process.env.NOTIFIER_RETRY_BASE_MS ?? '500'),
    retryMaxMs: Number(process.env.NOTIFIER_RETRY_MAX_MS ?? '10000')
  };
}

async function processNotifyUser(job: WorkerJobEnvelope): Promise<void> {
  await processNotifyUserJob(notifierDeps(), job);
  logger.info('worker_notify_user_processed', {
    correlation_id: job.correlation_id,
    tenant_id: job.tenant_id,
    platform_user_id: job.platform_user_id,
    notification_type: job.notification_type ?? null
  });
}

async function processFlushPending(job: WorkerJobEnvelope): Promise<void> {
  await processFlushPendingNotificationsJob(notifierDeps(), job);
}

async function processMapResolveJob(job: WorkerJobEnvelope): Promise<void> {
  await processMapResolve({
    queryOne: runQueryOne,
    queryMany: runQueryMany,
    exec: runSql,
    enqueue,
    mappingEnabled: (process.env.WORKER_MAPPING_ENABLED ?? 'true') === 'true'
  }, job);
}

async function processKiotvietSyncJob(job: WorkerJobEnvelope): Promise<void> {
  const adapter = new HttpKiotvietAdapter(
    process.env.KIOTVIET_STUB_BASE_URL ?? 'http://127.0.0.1:18080',
    process.env.KIOTVIET_STUB_TOKEN ?? 'stub-token',
    Number(process.env.KIOTVIET_TIMEOUT_MS ?? '2000')
  );

  await processKiotvietSync({
    queryOne: runQueryOne,
    queryMany: runQueryMany,
    exec: runSql,
    adapter,
    syncEnabled: (process.env.WORKER_KIOTVIET_SYNC_ENABLED ?? 'true') === 'true',
    maxRetries: Number(process.env.KIOTVIET_SYNC_MAX_RETRIES ?? '3'),
    backoffBaseMs: Number(process.env.KIOTVIET_SYNC_BACKOFF_MS ?? '200'),
    mekB64: process.env.WORKER_MEK_B64 ?? process.env.ADMIN_MEK_B64 ?? ''
  }, job);
}

async function checkReady(): Promise<boolean> {
  if (!readyzStrict) {
    return true;
  }

  const dbOk = pgPool ? await dbPing(pgPool, readyzTimeoutMs) : false;
  const redisOk = await redisPing(redisConfig, readyzTimeoutMs);
  return dbOk && redisOk;
}

function getQueueLagMs(rawData: unknown): number | null {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return null;
  const enqueuedAt = (rawData as Record<string, unknown>).enqueued_at_ms;
  if (typeof enqueuedAt !== 'number' || !Number.isFinite(enqueuedAt) || enqueuedAt <= 0) return null;
  const lag = Date.now() - enqueuedAt;
  return lag >= 0 ? lag : null;
}

async function handleEnvelope(rawData: unknown): Promise<void> {
  const validated = validateWorkerJobEnvelope(rawData);
  if (!validated.ok) {
    logger.warn('worker_job_invalid_envelope', {});
    return;
  }

  const job = validated.value;
  if (job.job_type === 'PROCESS_INBOUND_EVENT') {
    await processInboundEvent(job);
  } else if (job.job_type === 'MAP_RESOLVE') {
    await processMapResolveJob(job);
  } else if (job.job_type === 'KIOTVIET_SYNC') {
    await processKiotvietSyncJob(job);
  } else if (job.job_type === 'FLUSH_PENDING_NOTIFICATIONS') {
    await processFlushPending(job);
  } else {
    await processNotifyUser(job);
  }
}

async function runWithFailureAccounting(rawData: unknown): Promise<void> {
  const queueLagMs = getQueueLagMs(rawData);
  if (queueLagMs !== null) {
    recordQueueLag(queueLagMs);
    logger.info('queue_lag_ms', { queue_lag_ms: queueLagMs });
  }

  const start = Date.now();
  const validated = validateWorkerJobEnvelope(rawData);
  const jobType = validated.ok ? validated.value.job_type : 'invalid';

  try {
    await handleEnvelope(rawData);
    const durationMs = Date.now() - start;
    recordJobSuccess(durationMs);
    recordJobDurationByType(jobType, durationMs);
    logger.info('job_duration_ms', { job_type: jobType, job_duration_ms: durationMs });
  } catch (error) {
    const durationMs = Date.now() - start;
    recordJobFailure(durationMs);
    recordJobDurationByType(jobType, durationMs);
    logger.warn('job_duration_ms', { job_type: jobType, job_duration_ms: durationMs, status: 'failed' });
    throw error;
  }
}

async function startBullMqWorker() {
  const connection: { host: string; port: number; db?: number; password?: string } = {
    host: redisConfig.host,
    port: redisConfig.port,
    db: redisConfig.db
  };
  if (redisConfig.password) {
    connection.password = redisConfig.password;
  }

  const worker = new Worker(queueName, async (job: { data: unknown; attemptsMade?: number; opts?: { attempts?: number } }) => {
    try {
      await runWithFailureAccounting(job.data);
    } catch (error) {
      if (error instanceof NotifierRetriableError) {
        const maxAttempts = job.opts?.attempts ?? defaultAttempts;
        const currentAttempt = (job.attemptsMade ?? 0) + 1;
        if (currentAttempt >= maxAttempts && dlqEnabled) {
          logger.error('worker_notifier_dlq', {
            attempts_made: currentAttempt,
            max_attempts: maxAttempts,
            error_code: error.errorCode
          });
          return;
        }
        throw error;
      }

      logger.error('worker_job_failed', {
        reason: error instanceof Error ? error.message : 'unknown_error'
      });
      throw error;
    }
  }, {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? '5')
  });

  worker.on('failed', (...args: unknown[]) => {
    const err = args[1] instanceof Error ? args[1] : new Error('unknown');
    logger.error('worker_bullmq_job_failed', { reason: err.message });
  });

  worker.on('error', (...args: unknown[]) => {
    const err = args[0] instanceof Error ? args[0] : new Error('unknown');
    logger.error('worker_bullmq_error', { reason: err.message });
  });

  await worker.waitUntilReady();
  logger.info('worker_bullmq_started', {
    queue: queueName,
    notifier_dlq_enabled: dlqEnabled,
    notifier_max_attempts: defaultAttempts
  });
}

startWorkerMetricsServer(metricsHost, metricsPort);
if (workerHealthServerEnabled) {
  startWorkerHealthServer({ host: config.host, port: workerHealthPort, isReady: checkReady });
}
logger.info('worker startup', {
  host: config.host,
  port: workerHealthPort,
  metrics_host: metricsHost,
  metrics_port: metricsPort,
  health_server_enabled: workerHealthServerEnabled,
  queue_enabled_in_test: enableQueueInTest,
  queue_transport: queue ? 'redis' : (process.env.NODE_ENV === 'test' && queueCmd ? 'queue_cmd' : 'none')
});

startBullMqWorker().catch((error) => {
  logger.error('worker_startup_failed', { reason: error instanceof Error ? error.message : 'unknown_error' });
  (globalThis as { process?: { exit?: (code: number) => void } }).process?.exit?.(1);
});

setInterval(() => {
  logger.debug('worker heartbeat', { interval_seconds: 30 });
}, 30_000);
