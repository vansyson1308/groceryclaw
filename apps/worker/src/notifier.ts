import {
  NotifierOutboundRateLimiter,
  createLogger,
  InMemoryTokenBucketRateLimiter,
  renderNotificationTemplate,
  type NotifyUserPayload,
  type WorkerJobEnvelope
} from '../../../packages/common/dist/index.js';
import {
  recordNotifierDeferred,
  recordNotifierFailed,
  recordNotifierFlushDuration,
  recordNotifierSent,
  setNotifierPendingBacklog
} from './metrics.js';
import { runTenantScopedTransaction } from './db-session.js';
import { ZaloSendError, type ZaloOutboundAdapter } from './zalo-adapter.js';

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

type PendingNotificationRow = {
  id: string;
  platform_user_id: string;
  message_type: string;
  payload: Record<string, string | number | boolean>;
};

const coalescedTypes = new Set(['INVOICE_PROCESSED', 'GENERIC_INFO', 'RATE_LIMITED']);
const logger = createLogger({ service: 'worker-notifier', level: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined) ?? 'info' });

export class NotifierRetriableError extends Error {
  constructor(readonly errorCode: string, readonly retryAfterMs: number) {
    super(errorCode);
  }
}

export interface NotifierDeps {
  readonly exec: (sql: string) => Promise<void>;
  readonly queryOne: (sql: string) => Promise<string>;
  readonly queryMany: (sql: string) => Promise<string[]>;
  readonly adapter: ZaloOutboundAdapter;
  readonly enabled: boolean;
  readonly interactionWindowEnforced: boolean;
  readonly flushEnabled: boolean;
  readonly dlqEnabled: boolean;
  readonly maxMessageLen: number;
  readonly interactionWindowSeconds: number;
  readonly pendingTtlSeconds: number;
  readonly maxPendingPerUser: number;
  readonly flushBatchSize: number;
  readonly flushMaxPerRun: number;
  readonly flushRateLimiter: InMemoryTokenBucketRateLimiter;
  readonly outboundRateLimiter: NotifierOutboundRateLimiter;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
}

function computeRetryDelayMs(correlationId: string, baseMs: number, maxMs: number): number {
  const hash = correlationId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const jitter = hash % Math.max(1, Math.floor(baseMs / 2));
  return Math.min(maxMs, baseMs * 2 + jitter);
}

async function canSendNow(deps: NotifierDeps, tenantId: string, zaloUserId: string): Promise<boolean> {
  const out = await deps.queryOne(`
    BEGIN;
    SET LOCAL app.current_tenant = ${sqlQuote(tenantId)};
    SELECT COALESCE(EXTRACT(EPOCH FROM (now() - last_interaction_at))::bigint, 9999999)::text
    FROM zalo_users
    WHERE id = ${sqlQuote(zaloUserId)}::uuid
    LIMIT 1;
    COMMIT;
  `);

  const ageSeconds = Number(out.split('\n').map((line) => line.trim()).find((line) => /^\d+$/.test(line)) ?? '9999999');
  return ageSeconds <= deps.interactionWindowSeconds;
}

async function persistJobStatus(deps: NotifierDeps, payload: NotifyUserPayload, status: 'failed' | 'dead_letter' | 'completed', errorCode: string | null): Promise<void> {
  if (!payload.tenant_id) {
    return;
  }

  await runTenantScopedTransaction({
    db: { runSql: deps.exec },
    tenantId: payload.tenant_id,
    jobType: 'NOTIFY_USER',
    work: async () => {
      await deps.exec(`
        INSERT INTO jobs (tenant_id, type, status, payload, attempts, max_attempts, error_message, available_at, completed_at)
        VALUES (
          ${sqlQuote(payload.tenant_id!)}::uuid,
          'NOTIFY_USER',
          ${sqlQuote(status)},
          ${sqlQuote(JSON.stringify({
            platform_user_id: payload.platform_user_id,
            notification_type: payload.notification_type,
            correlation_id: payload.correlation_id
          }))}::jsonb,
          1,
          1,
          ${sqlQuote(errorCode ?? '')},
          now(),
          now()
        );
      `);
    }
  });
}

async function markTerminalFailure(deps: NotifierDeps, payload: NotifyUserPayload, errorCode: string, pendingNotificationId?: string): Promise<void> {
  if (!payload.tenant_id) {
    return;
  }

  await runTenantScopedTransaction({
    db: { runSql: deps.exec },
    tenantId: payload.tenant_id,
    jobType: 'NOTIFY_USER',
    work: async () => {
      if (pendingNotificationId) {
        await deps.exec(`
          UPDATE pending_notifications
          SET status = 'failed_terminal', flushed_at = now(), error_code = ${sqlQuote(errorCode)}
          WHERE id = ${sqlQuote(pendingNotificationId)}::uuid
            AND tenant_id = ${sqlQuote(payload.tenant_id!)}::uuid
            AND status = 'pending';
        `);
      }

      await deps.exec(`
        INSERT INTO audit_logs (tenant_id, actor_type, actor_id, event_type, resource_type, resource_id, payload)
        VALUES (
          ${sqlQuote(payload.tenant_id!)}::uuid,
          'system',
          'notifier',
          'notification_terminal_failure',
          'zalo_messages',
          ${sqlQuote(payload.platform_user_id)},
          ${sqlQuote(JSON.stringify({
            internal_error_code: errorCode,
            correlation_id: payload.correlation_id,
            notification_type: payload.notification_type
          }))}::jsonb
        );
      `);
    }
  });

  await persistJobStatus(deps, payload, deps.dlqEnabled ? 'dead_letter' : 'failed', errorCode);
}

async function deferNotification(deps: NotifierDeps, payload: NotifyUserPayload): Promise<void> {
  if (!payload.tenant_id || !payload.zalo_user_id) {
    return;
  }

  const ttlSeconds = Math.max(60, deps.pendingTtlSeconds);
  const maxPending = Math.max(1, deps.maxPendingPerUser);

  await runTenantScopedTransaction({
    db: { runSql: deps.exec },
    tenantId: payload.tenant_id,
    jobType: 'NOTIFY_USER',
    work: async () => {
      if (coalescedTypes.has(payload.notification_type)) {
        await deps.exec(`
          DELETE FROM pending_notifications
          WHERE tenant_id = ${sqlQuote(payload.tenant_id!)}::uuid
            AND zalo_user_id = ${sqlQuote(payload.zalo_user_id!)}::uuid
            AND status = 'pending'
            AND message_type = ${sqlQuote(payload.notification_type)};
        `);
      }

      await deps.exec(`
        INSERT INTO pending_notifications (tenant_id, zalo_user_id, platform_user_id, message_type, payload, expires_at, status)
        VALUES (
          ${sqlQuote(payload.tenant_id!)}::uuid,
          ${sqlQuote(payload.zalo_user_id!)}::uuid,
          ${sqlQuote(payload.platform_user_id)},
          ${sqlQuote(payload.notification_type)},
          ${sqlQuote(JSON.stringify(payload.template_vars ?? {}))}::jsonb,
          now() + make_interval(secs => ${ttlSeconds}),
          'pending'
        );
      `);

      await deps.exec(`
        DELETE FROM pending_notifications
        WHERE id IN (
          SELECT id
          FROM pending_notifications
          WHERE tenant_id = ${sqlQuote(payload.tenant_id!)}::uuid
            AND zalo_user_id = ${sqlQuote(payload.zalo_user_id!)}::uuid
            AND status = 'pending'
          ORDER BY created_at DESC
          OFFSET ${maxPending}
        );
      `);

      await deps.exec(`
        UPDATE pending_notifications
        SET status = 'expired'
        WHERE tenant_id = ${sqlQuote(payload.tenant_id!)}::uuid
          AND zalo_user_id = ${sqlQuote(payload.zalo_user_id!)}::uuid
          AND status = 'pending'
          AND expires_at <= now();
      `);

      await deps.exec(`
        INSERT INTO audit_logs (tenant_id, actor_type, actor_id, event_type, resource_type, resource_id, payload)
        VALUES (
          ${sqlQuote(payload.tenant_id!)}::uuid,
          'system',
          'notifier',
          'notification_deferred',
          'pending_notifications',
          ${sqlQuote(payload.zalo_user_id!)},
          ${sqlQuote(JSON.stringify({
            notification_type: payload.notification_type,
            correlation_id: payload.correlation_id
          }))}::jsonb
        );
      `);
    }
  });
  recordNotifierDeferred();
}

async function sendNotification(deps: NotifierDeps, payload: NotifyUserPayload, pendingNotificationId?: string): Promise<boolean> {
  const text = renderNotificationTemplate(payload, deps.maxMessageLen);
  const limiter = deps.outboundRateLimiter.consume({ tenantId: payload.tenant_id, platformUserId: payload.platform_user_id });
  if (!limiter.allowed) {
    logger.warn('notifier_outbound_limited', {
      tenant_id: payload.tenant_id,
      correlation_id: payload.correlation_id,
      platform_user_id: payload.platform_user_id,
      limit_scope: limiter.scope
    });

    if (payload.tenant_id && payload.zalo_user_id) {
      await deferNotification(deps, payload);
      return false;
    }

    throw new NotifierRetriableError(`rate_limited_${limiter.scope}`, computeRetryDelayMs(payload.correlation_id, deps.retryBaseMs, deps.retryMaxMs));
  }

  const startedAt = Date.now();

  const send = async () => {
    if (payload.tenant_id) {
      await deps.exec(`
        INSERT INTO audit_logs (tenant_id, actor_type, actor_id, event_type, resource_type, resource_id, payload)
        VALUES (
          ${sqlQuote(payload.tenant_id)}::uuid,
          'system',
          'notifier',
          'notification_attempted',
          'zalo_messages',
          ${sqlQuote(payload.platform_user_id)},
          ${sqlQuote(JSON.stringify({ notification_type: payload.notification_type, correlation_id: payload.correlation_id }))}::jsonb
        );
      `);
    }

    const result = await deps.adapter.sendText(payload.platform_user_id, text, { correlation_id: payload.correlation_id });

    if (payload.tenant_id) {
      await deps.exec(`
        INSERT INTO audit_logs (tenant_id, actor_type, actor_id, event_type, resource_type, resource_id, payload)
        VALUES (
          ${sqlQuote(payload.tenant_id)}::uuid,
          'system',
          'notifier',
          'notification_sent',
          'zalo_messages',
          ${sqlQuote(payload.platform_user_id)},
          ${sqlQuote(JSON.stringify({ notification_type: payload.notification_type, correlation_id: payload.correlation_id, message_id: result.message_id }))}::jsonb
        );
      `);
    }
  };

  try {
    if (payload.tenant_id) {
      await runTenantScopedTransaction({
        db: { runSql: deps.exec },
        tenantId: payload.tenant_id,
        jobType: 'NOTIFY_USER',
        work: send
      });
      await persistJobStatus(deps, payload, 'completed', null);
    } else {
      await send();
    }
    recordNotifierSent(Date.now() - startedAt);
    return true;
  } catch (error) {
    recordNotifierFailed();
    if (error instanceof ZaloSendError) {
      if (error.kind === 'TERMINAL') {
        await markTerminalFailure(deps, payload, error.code, pendingNotificationId);
        logger.error('notifier_send_terminal_failure', {
          tenant_id: payload.tenant_id,
          correlation_id: payload.correlation_id,
          error_code: error.code
        });
        return false;
      }

      logger.warn('notifier_send_retryable_failure', {
        tenant_id: payload.tenant_id,
        correlation_id: payload.correlation_id,
        error_code: error.code
      });
      throw new NotifierRetriableError(error.code, error.retryAfterMs ?? computeRetryDelayMs(payload.correlation_id, deps.retryBaseMs, deps.retryMaxMs));
    }

    throw error;
  }
}

function parsePendingRow(line: string): PendingNotificationRow | null {
  const [id, platformUserId, messageType, payloadRaw] = line.split('|');
  if (!id || !platformUserId || !messageType) {
    return null;
  }
  const payloadText = payloadRaw && payloadRaw.length > 0 ? payloadRaw : '{}';
  return {
    id,
    platform_user_id: platformUserId,
    message_type: messageType,
    payload: JSON.parse(payloadText) as Record<string, string | number | boolean>
  };
}

export async function processNotifyUserJob(deps: NotifierDeps, job: WorkerJobEnvelope): Promise<void> {
  if (!deps.enabled || !job.notification_type) {
    return;
  }

  const payload: NotifyUserPayload = {
    tenant_id: job.tenant_id,
    platform_user_id: job.platform_user_id,
    ...(job.zalo_user_id ? { zalo_user_id: job.zalo_user_id } : {}),
    notification_type: job.notification_type,
    template_vars: job.template_vars ?? {},
    correlation_id: job.correlation_id
  };

  if (deps.interactionWindowEnforced && payload.tenant_id && payload.zalo_user_id) {
    const open = await canSendNow(deps, payload.tenant_id, payload.zalo_user_id);
    if (!open) {
      await deferNotification(deps, payload);
      return;
    }
  }

  await sendNotification(deps, payload);
}

export async function processFlushPendingNotificationsJob(deps: NotifierDeps, job: WorkerJobEnvelope): Promise<void> {
  if (!deps.enabled || !deps.flushEnabled) {
    return;
  }

  if (!job.tenant_id || !job.zalo_user_id) {
    return;
  }
  const startedAt = Date.now();
  const zaloUserId = job.zalo_user_id;
  const maxRows = Math.max(1, Math.min(deps.flushBatchSize, deps.flushMaxPerRun));

  await runTenantScopedTransaction({
    db: { runSql: deps.exec },
    tenantId: job.tenant_id,
    jobType: 'FLUSH_PENDING_NOTIFICATIONS',
    work: async () => {
      await deps.exec(`
        UPDATE pending_notifications
        SET status = 'expired'
        WHERE tenant_id = ${sqlQuote(job.tenant_id!)}::uuid
          AND zalo_user_id = ${sqlQuote(zaloUserId)}::uuid
          AND status = 'pending'
          AND expires_at <= now();
      `);

      const rowsRaw = await deps.queryMany(`
        SELECT id::text || '|' || COALESCE(platform_user_id, '') || '|' || message_type || '|' || payload::text
        FROM pending_notifications
        WHERE tenant_id = ${sqlQuote(job.tenant_id!)}::uuid
          AND zalo_user_id = ${sqlQuote(zaloUserId)}::uuid
          AND status = 'pending'
          AND expires_at > now()
        ORDER BY created_at ASC
        LIMIT ${maxRows}
        FOR UPDATE SKIP LOCKED;
      `);
      setNotifierPendingBacklog(rowsRaw.length);

      for (const line of rowsRaw) {
        if (!deps.flushRateLimiter.consume(`flush:${job.tenant_id}:${zaloUserId}`).allowed) {
          break;
        }

        const row = parsePendingRow(line);
        if (!row) {
          continue;
        }

        const notifyPayload: NotifyUserPayload = {
          tenant_id: job.tenant_id,
          zalo_user_id: zaloUserId,
          platform_user_id: row.platform_user_id,
          notification_type: row.message_type as NotifyUserPayload['notification_type'],
          template_vars: row.payload,
          correlation_id: job.correlation_id
        };

        const sent = await sendNotification(deps, notifyPayload, row.id);

        if (sent) {
          await deps.exec(`
            UPDATE pending_notifications
            SET status = 'flushed', flushed_at = now()
            WHERE id = ${sqlQuote(row.id)}::uuid
              AND tenant_id = ${sqlQuote(job.tenant_id!)}::uuid
              AND status = 'pending';
          `);
        }
      }
    }
  });

  recordNotifierFlushDuration(Date.now() - startedAt);
}
