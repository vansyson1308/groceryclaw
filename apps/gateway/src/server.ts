import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  createLogger,
  detectInviteIntent,
  InMemoryTokenBucketRateLimiter,
  createPgPool,
  query,
  Queue,
  loadGatewayConfig,
  loadRedisConfig,
  dbPing,
  redisPing,
  validateZaloWebhookPayload,
  verifyWebhookRequest,
  getSecurityHeaders,
  loadSecurityHeadersConfig,
  type ZaloWebhookEvent
} from '../../../packages/common/dist/index.js';

const config = loadGatewayConfig();
const logger = createLogger({ service: 'gateway', level: config.logLevel });

const webhookEnabled = (process.env.V2_GATEWAY_WEBHOOK_ENABLED ?? 'true') === 'true';
const onboardingEnabled = (process.env.V2_ONBOARDING_ENABLED ?? 'true') === 'true';
const maxBodyBytes = Number(process.env.GATEWAY_MAX_BODY_BYTES ?? '262144');
const dbCmd = process.env.GATEWAY_DB_CMD ?? '';
const queueCmd = process.env.GATEWAY_QUEUE_CMD ?? '';
const postgresUrl = process.env.DB_APP_URL ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? '';
const redisConfig = loadRedisConfig({
  onWarning: (message) => logger.warn('gateway_redis_config_deprecated', { message })
});
const queueName = process.env.BULLMQ_QUEUE_NAME ?? 'process-inbound';
const readyzStrict = (process.env.READYZ_STRICT ?? 'true') === 'true';
const readyzTimeoutMs = Number(process.env.READYZ_TIMEOUT_MS ?? '300');
const metricsHost = process.env.GATEWAY_METRICS_HOST ?? '0.0.0.0';
const metricsPort = Number(process.env.GATEWAY_METRICS_PORT ?? '9100');
const securityHeadersConfig = loadSecurityHeadersConfig(process.env);
const replayCacheTtlSeconds = Number(process.env.WEBHOOK_REPLAY_TTL_SECONDS ?? '86400');
const invitePepperB64 = process.env.INVITE_PEPPER_B64
  ?? (process.env.INVITE_PEPPER_HEX ? Buffer.from(process.env.INVITE_PEPPER_HEX, 'hex').toString('base64') : '');


if (process.env.INVITE_PEPPER_HEX && !process.env.INVITE_PEPPER_B64) {
  logger.warn('gateway_invite_pepper_hex_deprecated', { message: 'Use INVITE_PEPPER_B64 instead of INVITE_PEPPER_HEX' });
}

const inMemoryDedupe = new Set<string>();
const replayCache = new Map<string, number>();
const inviteUserRatePerMinute = Number(process.env.ONBOARDING_INVITE_USER_RATE_PER_MINUTE ?? '10');
const inviteIpRatePerMinute = Number(process.env.ONBOARDING_INVITE_IP_RATE_PER_MINUTE ?? '20');
const inviteByUserLimiter = new InMemoryTokenBucketRateLimiter(inviteUserRatePerMinute, inviteUserRatePerMinute);
const inviteByIpLimiter = new InMemoryTokenBucketRateLimiter(inviteIpRatePerMinute, inviteIpRatePerMinute);

const pgPool = postgresUrl
  ? await createPgPool({
      connectionString: postgresUrl,
      applicationName: 'gateway',
      statementTimeoutMs: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? '5000')
    })
  : null;
const queue = (() => {
  if (process.env.NODE_ENV === 'test') return null;
  return new Queue(queueName, {
    connection: {
      host: redisConfig.host,
      port: redisConfig.port,
      db: redisConfig.db,
      ...(redisConfig.password ? { password: redisConfig.password } : {})
    }
  });
})();

const metrics = {
  readyzChecksTotal: 0,
  readyzFailuresTotal: 0,
  dbReadyzFailuresTotal: 0,
  redisReadyzFailuresTotal: 0,
  webhookAcceptedTotal: 0,
  webhookAuthFailuresTotal: 0,
  webhookServerErrorsTotal: 0,
  webhookAckMsTotal: 0,
  webhookAckMsCount: 0
};

function renderMetrics(): string {
  return [
    '# TYPE groceryclaw_gateway_readyz_checks_total counter',
    `groceryclaw_gateway_readyz_checks_total ${metrics.readyzChecksTotal}`,
    '# TYPE groceryclaw_gateway_readyz_failures_total counter',
    `groceryclaw_gateway_readyz_failures_total ${metrics.readyzFailuresTotal}`,
    '# TYPE groceryclaw_gateway_dependency_failures_total counter',
    `groceryclaw_gateway_dependency_failures_total{dependency="db"} ${metrics.dbReadyzFailuresTotal}`,
    `groceryclaw_gateway_dependency_failures_total{dependency="redis"} ${metrics.redisReadyzFailuresTotal}`,
    '# TYPE groceryclaw_gateway_webhook_accepted_total counter',
    `groceryclaw_gateway_webhook_accepted_total ${metrics.webhookAcceptedTotal}`,
    '# TYPE groceryclaw_gateway_webhook_auth_failures_total counter',
    `groceryclaw_gateway_webhook_auth_failures_total ${metrics.webhookAuthFailuresTotal}`,
    '# TYPE groceryclaw_gateway_webhook_server_errors_total counter',
    `groceryclaw_gateway_webhook_server_errors_total ${metrics.webhookServerErrorsTotal}`,
    '# TYPE groceryclaw_gateway_webhook_ack_ms_total counter',
    `groceryclaw_gateway_webhook_ack_ms_total ${metrics.webhookAckMsTotal}`,
    '# TYPE groceryclaw_gateway_webhook_ack_ms_count counter',
    `groceryclaw_gateway_webhook_ack_ms_count ${metrics.webhookAckMsCount}`
  ].join('\n');
}

const metricsServer = createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/metrics') {
    res.writeHead(404);
    res.end('not_found');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
  res.end(`${renderMetrics()}\n`);
});

type ResponseLike = {
  writeHead: (statusCode: number, headers?: Record<string, string>) => unknown;
  end: (chunk?: string) => void;
};

function json(res: ResponseLike, code: number, body: Record<string, unknown>) {
  res.writeHead(code, { ...getSecurityHeaders(securityHeadersConfig), 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}


async function checkReady(): Promise<{ ready: boolean; dbOk: boolean; redisOk: boolean }> {
  if (!readyzStrict) {
    return { ready: true, dbOk: true, redisOk: true };
  }

  const dbOk = pgPool ? await dbPing(pgPool, readyzTimeoutMs) : false;
  const redisOk = await redisPing(redisConfig, readyzTimeoutMs);
  return { ready: dbOk && redisOk, dbOk, redisOk };
}

function readBody(req: { on: (event: 'data' | 'end' | 'error', listener: (...args: unknown[]) => void) => void }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];

    req.on('data', (chunk) => {
      const data = chunk as Buffer;
      total += data.length;
      if (total > maxBodyBytes) {
        reject(new Error('payload_too_large'));
        return;
      }
      chunks.push(data);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function runCmdAdapter(command: string, input: string): string {
  const [exec, ...args] = command.trim().split(/\s+/);
  if (!exec) throw new Error('adapter_error');
  const result = spawnSync(exec, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error('adapter_error');
  return result.stdout.trim();
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function renderSqlForAdapter(sql: string, params: readonly unknown[]): string {
  return params.reduce<string>((acc, value, index) => {
    const pattern = new RegExp(`\\$${index + 1}(?!\\d)`, 'g');
    return acc.replace(pattern, sqlLiteral(value));
  }, sql);
}

async function runSql(sql: string, params: readonly unknown[] = []): Promise<string> {
  if (pgPool) {
    const result = await query(pgPool, sql, params);
    if (result.rows.length === 0) return '';
    return result.rows.map((row) => Object.values(row).join('|')).join('\n').trim();
  }
  if (process.env.NODE_ENV === 'test' && dbCmd) {
    return runCmdAdapter(dbCmd, renderSqlForAdapter(sql, params));
  }
  return '';
}

async function resolveMembership(platformUserId: string): Promise<{ tenantId?: string }> {
  if (!pgPool && !(process.env.NODE_ENV === 'test' && dbCmd)) return {};

  const out = await runSql(`
    SELECT tenant_id::text
    FROM resolve_membership_by_platform_user_id($1)
    LIMIT 1;
  `, [platformUserId]);
  if (!out) return {};
  const tenantId = out.split('\n')[0]?.trim();
  return tenantId ? { tenantId } : {};
}

async function consumeInviteCode(platformUserId: string, inviteCode: string): Promise<{ ok: boolean; tenantId?: string; roleAssigned?: string }> {
  if (!pgPool && !(process.env.NODE_ENV === 'test' && dbCmd)) return { ok: false };

  if (pgPool) {
    const tx = await pgPool.connect();
    try {
      await query(tx, 'BEGIN');
      if (invitePepperB64) {
        await query(tx, "SELECT set_config('app.invite_pepper_b64', $1, true)", [invitePepperB64]);
      }
      const result = await query(tx, `
        SELECT ok::text AS ok_raw, COALESCE(tenant_id::text, '') AS tenant_id_raw, COALESCE(role_assigned, '') AS role_assigned_raw
        FROM consume_invite_code($1, $2)
        LIMIT 1;
      `, [platformUserId, inviteCode]);
      await query(tx, 'COMMIT');
      const row = result.rows[0];
      if (!row) return { ok: false };
      const okRaw = String(row.ok_raw ?? 'false');
      const tenantId = String(row.tenant_id_raw ?? '').trim();
      const roleAssigned = String((row.role_assigned_raw ?? '')).trim();
      return { ok: okRaw === 't' || okRaw === 'true', ...(tenantId ? { tenantId } : {}), ...(roleAssigned ? { roleAssigned } : {}) };
    } catch {
      try { await query(tx, 'ROLLBACK'); } catch {}
      return { ok: false };
    } finally {
      tx.release();
    }
  }

  const setPepperSql = invitePepperB64 ? `SET LOCAL app.invite_pepper_b64 = ${sqlQuote(invitePepperB64)};` : '';
  const out = await runSql(`
    BEGIN;
    ${setPepperSql}
    SELECT ok::text, COALESCE(tenant_id::text, ''), COALESCE(role_assigned, '')
    FROM consume_invite_code(${sqlQuote(platformUserId)}, ${sqlQuote(inviteCode)})
    LIMIT 1;
    COMMIT;
  `);

  const line = out.split('\n').map((item) => item.trim()).find((item) => item.includes('|'));
  if (!line) {
    return { ok: false };
  }

  const [okRaw, tenantId, roleAssigned] = line.split('|');
  return {
    ok: okRaw === 't' || okRaw === 'true',
    ...(tenantId ? { tenantId } : {}),
    ...(roleAssigned ? { roleAssigned } : {})
  };
}

async function getTenantProcessingMode(tenantId: string): Promise<'legacy' | 'v2'> {
  if (!pgPool && !(process.env.NODE_ENV === 'test' && dbCmd)) return 'v2';
  const out = await runSql(`
    SELECT processing_mode
    FROM tenants
    WHERE id = $1::uuid
    LIMIT 1;
  `, [tenantId]);

  const line = out.split('\n').map((item) => item.trim()).find((item) => item === 'legacy' || item === 'v2');
  return line === 'legacy' ? 'legacy' : 'v2';
}


async function resolveZaloUserId(platformUserId: string): Promise<string | undefined> {
  if (!pgPool && !(process.env.NODE_ENV === 'test' && dbCmd)) {
    return undefined;
  }
  const out = await runSql(`
    SELECT id::text
    FROM zalo_users
    WHERE platform_user_id = $1
    LIMIT 1;
  `, [platformUserId]);
  const value = out.split('\n').map((line) => line.trim()).find((line) => /^[0-9a-f-]{36}$/i.test(line));
  return value;
}

async function recordInboundInteraction(tenantId: string, platformUserId: string): Promise<string | undefined> {
  if (!pgPool && !(process.env.NODE_ENV === 'test' && dbCmd)) {
    return undefined;
  }

  await runSql(`
    UPDATE zalo_users
    SET last_interaction_at = now()
    WHERE platform_user_id = $1;
  `, [platformUserId]);

  const out = await runSql(`
    SELECT id::text
    FROM zalo_users
    WHERE platform_user_id = $1
    LIMIT 1;
  `, [platformUserId]);

  return out.split('\n').map((line) => line.trim()).find((line) => /^[0-9a-f-]{36}$/i.test(line));
}

function tryReplayCache(tenantId: string | undefined, zaloMsgId: string): boolean {
  const scope = tenantId ?? 'unlinked';
  const key = `${scope}:${zaloMsgId}`;
  const now = Date.now();
  const cachedUntil = replayCache.get(key) ?? 0;
  if (cachedUntil > now) {
    return false;
  }
  replayCache.set(key, now + replayCacheTtlSeconds * 1000);
  return true;
}

async function insertInboundEvent(event: ZaloWebhookEvent, tenantId?: string): Promise<{ inserted: boolean; inboundEventId: string }> {
  if (!pgPool && !(process.env.NODE_ENV === 'test' && dbCmd)) {
    const resolvedTenant = tenantId ?? 'unlinked';
    const key = `${resolvedTenant}:${event.zalo_msg_id}`;
    if (inMemoryDedupe.has(key)) {
      return { inserted: false, inboundEventId: key };
    }
    inMemoryDedupe.add(key);
    return { inserted: true, inboundEventId: randomUUID() };
  }

  const resolvedTenant = tenantId ?? '00000000-0000-0000-0000-000000000000';
  const out = await runSql(`
    INSERT INTO inbound_events (tenant_id, zalo_user_id, zalo_msg_id, event_type, payload, status)
    VALUES (
      $1::uuid,
      COALESCE((SELECT id FROM zalo_users WHERE platform_user_id = $2 LIMIT 1), '00000000-0000-0000-0000-000000000000'::uuid),
      $3,
      $4,
      $5::jsonb,
      'received'
    )
    ON CONFLICT (tenant_id, zalo_msg_id) DO NOTHING
    RETURNING id::text;
  `, [resolvedTenant, event.platform_user_id, event.zalo_msg_id, event.message_type, JSON.stringify(event.raw)]);
  const id = out.split('\n').map((x) => x.trim()).find((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!id) {
    return { inserted: false, inboundEventId: `${resolvedTenant}:${event.zalo_msg_id}` };
  }
  return { inserted: true, inboundEventId: id };
}

async function enqueue(payload: Record<string, unknown>) {
  if (!queue && !(process.env.NODE_ENV === 'test' && queueCmd)) return;

  const withEnqueueTs = ('enqueued_at_ms' in payload) ? payload : { ...payload, enqueued_at_ms: Date.now() };
  if (queue) {
    await queue.add(String(withEnqueueTs.job_type ?? 'UNKNOWN_JOB'), withEnqueueTs, {
      removeOnComplete: Number(process.env.BULLMQ_REMOVE_ON_COMPLETE ?? '1000'),
      removeOnFail: Number(process.env.BULLMQ_REMOVE_ON_FAIL ?? '1000')
    });
    return;
  }
  if (process.env.NODE_ENV === 'test' && queueCmd) {
    const [exec, ...args] = queueCmd.trim().split(/\s+/);
    if (!exec) throw new Error('queue_error');
    const result = spawnSync(exec, [...args, JSON.stringify(withEnqueueTs)], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('queue_error');
  }
}

async function enqueueNotify(platformUserId: string, template: 'invite_success' | 'invite_generic_failure' | 'invite_wait_retry' | 'onboarding_prompt', tenantId?: string) {
  await enqueue({
    job_type: 'NOTIFY_USER',
    template,
    platform_user_id: platformUserId,
    tenant_id: tenantId ?? null
  });
}

function getSourceIp(headers: Record<string, string | string[] | undefined>): string {
  const xff = headers['x-forwarded-for'];
  if (typeof xff === 'string') {
    return xff.split(',')[0]?.trim() ?? '';
  }
  return '';
}

async function enqueueLinkedFlow(event: ZaloWebhookEvent, requestId: string, tenantId: string) {
  const inserted = await insertInboundEvent(event, tenantId);
  const processingMode = await getTenantProcessingMode(tenantId);
  const zaloUserId = (await recordInboundInteraction(tenantId, event.platform_user_id)) ?? await resolveZaloUserId(event.platform_user_id);

  if (zaloUserId) {
    await enqueue({
      job_type: 'FLUSH_PENDING_NOTIFICATIONS',
      correlation_id: requestId,
      tenant_id: tenantId,
      zalo_user_id: zaloUserId,
      platform_user_id: event.platform_user_id,
      inbound_event_id: inserted.inboundEventId,
      zalo_msg_id: event.zalo_msg_id
    });
  }

  if (inserted.inserted) {
    await enqueue({
      job_type: processingMode === 'legacy' ? 'LEGACY_FORWARD_INBOUND' : 'PROCESS_INBOUND_EVENT',
      correlation_id: requestId,
      request_hash: createHash('sha256').update(JSON.stringify(event.raw)).digest('hex').slice(0, 12),
      tenant_id: tenantId,
      inbound_event_id: inserted.inboundEventId,
      platform_user_id: event.platform_user_id,
      ...(zaloUserId ? { zalo_user_id: zaloUserId } : {}),
      zalo_msg_id: event.zalo_msg_id,
      processing_mode: processingMode,
      dedupe_hit: !inserted.inserted
    });
  }

  logger.info('gateway_webhook_accepted', {
    request_id: requestId,
    tenant_id: tenantId,
    processing_mode: processingMode,
    dedupe_hit: !inserted.inserted,
    platform_user_id: event.platform_user_id,
    zalo_msg_id: event.zalo_msg_id
  });
}


function respondAccepted(
  res: { writeHead: (statusCode: number, headers?: Record<string, string>) => void; end: (body?: string) => void },
  requestId: string,
  startedAtMs: number,
  extras?: Record<string, unknown>
) {
  const ackMs = Date.now() - startedAtMs;
  metrics.webhookAcceptedTotal += 1;
  metrics.webhookAckMsTotal += ackMs;
  metrics.webhookAckMsCount += 1;
  logger.info('gateway_ack_ms', { request_id: requestId, gateway_ack_ms: ackMs, ...(extras ?? {}) });
  json(res, 200, { status: 'accepted', request_id: requestId });
}

const server = createServer(async (req, res) => {
  const requestId = (req.headers?.['x-request-id'] as string | undefined) ?? randomUUID();

  if ((req.method === 'GET') && req.url === '/healthz') {
    json(res, 200, { status: 'ok', service: 'gateway' });
    return;
  }

  if ((req.method === 'GET') && req.url === '/readyz') {
    const ready = await checkReady();
    metrics.readyzChecksTotal += 1;
    if (!ready.ready) {
      metrics.readyzFailuresTotal += 1;
      if (!ready.dbOk) metrics.dbReadyzFailuresTotal += 1;
      if (!ready.redisOk) metrics.redisReadyzFailuresTotal += 1;
    }
    json(res, ready.ready ? 200 : 503, { status: ready.ready ? 'ok' : 'not_ready', service: 'gateway' });
    return;
  }

  if (req.method === 'POST' && req.url === '/webhooks/zalo') {
    const startedAtMs = Date.now();
    if (!webhookEnabled) {
      json(res, 404, { error: 'not_found' });
      return;
    }

    const contentType = String(req.headers?.['content-type'] ?? '');
    if (!contentType.toLowerCase().includes('application/json')) {
      json(res, 415, { error: 'unsupported_media_type' });
      return;
    }

    try {
      const raw = await readBody(req);
      const headerMap: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(req.headers ?? {})) {
        headerMap[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
      }

      const authResult = verifyWebhookRequest(config.webhookAuth, {
        headers: headerMap,
        sourceIp: getSourceIp(req.headers as Record<string, string | string[] | undefined>)
      }, raw);

      if (!authResult.ok) {
        metrics.webhookAuthFailuresTotal += 1;
        logger.warn('webhook_auth_fail', {
          request_id: requestId,
          reason: authResult.reason,
          verify_mode: config.webhookAuth.verifyMode
        });

        if (authResult.statusCode === 429) {
          json(res, 429, { error: 'rate_limited' });
          return;
        }

        json(res, authResult.statusCode, { error: authResult.statusCode === 401 ? 'unauthorized' : 'forbidden' });
        return;
      }

      const parsed = JSON.parse(raw.toString('utf8')) as unknown;
      const validated = validateZaloWebhookPayload(parsed);

      if (!validated.ok) {
        json(res, 400, { error: 'bad_request' });
        return;
      }

      const event = validated.value;
      const membership = await resolveMembership(event.platform_user_id);

      if (!membership.tenantId) {
        if (onboardingEnabled) {
          const inviteIntent = detectInviteIntent(event.text);
          if (inviteIntent.isInviteAttempt && inviteIntent.inviteCode) {
            const sourceIp = getSourceIp(req.headers as Record<string, string | string[] | undefined>) || 'unknown';
            const byUser = inviteByUserLimiter.consume(`invite:user:${event.platform_user_id}`);
            const byIp = inviteByIpLimiter.consume(`invite:ip:${sourceIp}`);

            if (!byUser.allowed || !byIp.allowed) {
              await enqueueNotify(event.platform_user_id, 'invite_wait_retry');
              respondAccepted(res, requestId, startedAtMs, { stage: 'invite_rate_limited' });
              return;
            }

            const consumeResult = await consumeInviteCode(event.platform_user_id, inviteIntent.inviteCode);
            if (consumeResult.ok && consumeResult.tenantId) {
              await enqueueNotify(event.platform_user_id, 'invite_success', consumeResult.tenantId);
            } else {
              await enqueueNotify(event.platform_user_id, 'invite_generic_failure');
            }
            respondAccepted(res, requestId, startedAtMs, { stage: 'invite_processed' });
            return;
          }
        }

        await enqueueNotify(event.platform_user_id, 'onboarding_prompt');
        respondAccepted(res, requestId, startedAtMs, { stage: 'onboarding_prompt' });
        return;
      }

      if (!tryReplayCache(membership.tenantId, event.zalo_msg_id)) {
        respondAccepted(res, requestId, startedAtMs, { stage: 'replay_deduped' });
        return;
      }

      await enqueueLinkedFlow(event, requestId, membership.tenantId);
      respondAccepted(res, requestId, startedAtMs, { stage: 'linked_flow_enqueued' });
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_error';
      if (reason === 'payload_too_large') {
        json(res, 413, { error: 'payload_too_large' });
        return;
      }

      if (reason.includes('JSON')) {
        json(res, 400, { error: 'bad_request' });
        return;
      }

      metrics.webhookServerErrorsTotal += 1;
      logger.error('gateway_webhook_failed', {
        request_id: requestId,
        reason
      });
      json(res, 500, { error: 'internal_error' });
      return;
    }
  }

  json(res, 404, { error: 'not_found' });
});

metricsServer.listen(metricsPort, metricsHost, () => {
  logger.info('gateway metrics server started', { metrics_host: metricsHost, metrics_port: metricsPort });
});

server.listen(config.port, config.host, () => {
  logger.info('gateway server started', {
    port: config.port,
    host: config.host,
    webhook_enabled: webhookEnabled,
    onboarding_enabled: onboardingEnabled,
    webhook_verify_mode: config.webhookAuth.verifyMode
  });
});
