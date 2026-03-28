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
  validateTelegramUpdate,
  verifyTelegramWebhook,
  getSecurityHeaders,
  loadSecurityHeadersConfig,
  TelegramBotClient,
  TelegramApiError,
  type TelegramBotEvent,
} from '../../../packages/common/dist/index.js';

const config = loadGatewayConfig();
const logger = createLogger({ service: 'gateway', level: config.logLevel });

const onboardingEnabled = (process.env.V2_ONBOARDING_ENABLED ?? 'true') === 'true';
const maxBodyBytes = Number(process.env.GATEWAY_MAX_BODY_BYTES ?? '262144');
const dbCmd = process.env.GATEWAY_DB_CMD ?? '';
const queueCmd = process.env.GATEWAY_QUEUE_CMD ?? '';
const postgresUrl = process.env.DB_APP_URL ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? '';
const redisConfig = loadRedisConfig({
  onWarning: (message) => logger.warn('gateway_redis_config_deprecated', { message })
});
const queueName = process.env.BULLMQ_QUEUE_NAME ?? 'process-inbound';
const enableQueueInTest = (process.env.ENABLE_QUEUE_IN_TEST ?? 'false') === 'true';
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

async function runTenantScopedSql(tenantId: string, sql: string, params: readonly unknown[] = []): Promise<string> {
  if (pgPool) {
    const client = await pgPool.connect();
    try {
      await query(client, 'BEGIN');
      await query(client, `SET LOCAL app.current_tenant = ${sqlQuote(tenantId)}`);
      const result = await query(client, sql, params);
      await query(client, 'COMMIT');
      if (result.rows.length === 0) return '';
      return result.rows.map((row) => Object.values(row).join('|')).join('\n').trim();
    } catch (err) {
      try { await query(client, 'ROLLBACK'); } catch {}
      throw err;
    } finally {
      client.release();
    }
  }
  if (process.env.NODE_ENV === 'test' && dbCmd) {
    const scopedSql = `BEGIN;\nSET LOCAL app.current_tenant = ${sqlQuote(tenantId)};\n${renderSqlForAdapter(sql, params)}\nCOMMIT;`;
    return runCmdAdapter(dbCmd, scopedSql);
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

async function consumeInviteCode(platformUserId: string, inviteCode: string, telegramChatId?: number): Promise<{ ok: boolean; tenantId?: string; roleAssigned?: string }> {
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
        FROM consume_invite_code($1, $2, $3)
        LIMIT 1;
      `, [platformUserId, inviteCode, telegramChatId ?? null]);
      await query(tx, 'COMMIT');
      const row = result.rows[0];
      if (!row) return { ok: false };
      const okRaw = String(row.ok_raw ?? 'false');
      const tenantIdVal = String(row.tenant_id_raw ?? '').trim();
      const roleAssigned = String((row.role_assigned_raw ?? '')).trim();
      return { ok: okRaw === 't' || okRaw === 'true', ...(tenantIdVal ? { tenantId: tenantIdVal } : {}), ...(roleAssigned ? { roleAssigned } : {}) };
    } catch {
      try { await query(tx, 'ROLLBACK'); } catch {}
      return { ok: false };
    } finally {
      tx.release();
    }
  }

  return { ok: false };
}

async function recordInboundInteraction(tenantId: string, platformUserId: string): Promise<string | undefined> {
  if (!pgPool && !(process.env.NODE_ENV === 'test' && dbCmd)) {
    return undefined;
  }

  await runTenantScopedSql(tenantId, `
    UPDATE platform_users
    SET last_interaction_at = now()
    WHERE platform_user_id = $1;
  `, [platformUserId]);

  const out = await runTenantScopedSql(tenantId, `
    SELECT id::text
    FROM platform_users
    WHERE platform_user_id = $1
    LIMIT 1;
  `, [platformUserId]);

  return out.split('\n').map((line) => line.trim()).find((line) => /^[0-9a-f-]{36}$/i.test(line));
}

function tryReplayCache(tenantId: string | undefined, messageId: string): boolean {
  const scope = tenantId ?? 'unlinked';
  const key = `${scope}:${messageId}`;
  const now = Date.now();
  const cachedUntil = replayCache.get(key) ?? 0;
  if (cachedUntil > now) {
    return false;
  }
  replayCache.set(key, now + replayCacheTtlSeconds * 1000);
  return true;
}

async function insertInboundEvent(event: TelegramBotEvent, tenantId?: string): Promise<{ inserted: boolean; inboundEventId: string }> {
  if (!pgPool && !(process.env.NODE_ENV === 'test' && dbCmd)) {
    const resolvedTenant = tenantId ?? 'unlinked';
    const key = `${resolvedTenant}:${event.message_id}`;
    return { inserted: true, inboundEventId: randomUUID() };
  }

  const resolvedTenant = tenantId ?? '00000000-0000-0000-0000-000000000000';
  const messageId = String(event.message_id);
  const sql = `
    INSERT INTO inbound_events (tenant_id, user_id, message_id, event_type, payload, status)
    VALUES (
      $1::uuid,
      COALESCE((SELECT id FROM platform_users WHERE platform_user_id = $2 LIMIT 1), '00000000-0000-0000-0000-000000000000'::uuid),
      $3,
      $4,
      $5::jsonb,
      'received'
    )
    ON CONFLICT (tenant_id, message_id) DO NOTHING
    RETURNING id::text;
  `;
  const payload = {
    update_id: event.update_id,
    chat_id: event.chat_id,
    user_id: event.user_id,
    message_type: event.message_type,
    text: event.text,
    document: event.document,
    caption: event.caption
  };
  const sqlParams = [resolvedTenant, String(event.user_id), messageId, event.message_type, JSON.stringify(payload)];
  const out = tenantId
    ? await runTenantScopedSql(tenantId, sql, sqlParams)
    : await runSql(sql, sqlParams);
  const id = out.split('\n').map((x) => x.trim()).find((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!id) {
    return { inserted: false, inboundEventId: `${resolvedTenant}:${messageId}` };
  }
  return { inserted: true, inboundEventId: id };
}

async function enqueue(payload: Record<string, unknown>) {
  if (!queue && !(process.env.NODE_ENV === 'test' && queueCmd)) {
    if (enableQueueInTest) {
      throw new Error('queue_not_configured');
    }
    return;
  }

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

function classifyTelegramMessage(event: TelegramBotEvent): 'excel_invoice' | 'image_invoice' | 'text_chat' {
  if (event.message_type === 'document' && event.document) {
    const fileName = (event.document.file_name ?? '').toLowerCase();
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      return 'excel_invoice';
    }
  }
  if (event.message_type === 'photo') {
    return 'image_invoice';
  }
  return 'text_chat';
}

async function enqueueLinkedFlow(event: TelegramBotEvent, requestId: string, tenantId: string) {
  const inserted = await insertInboundEvent(event, tenantId);
  const userId = await recordInboundInteraction(tenantId, String(event.user_id));
  const messageId = String(event.message_id);

  if (inserted.inserted) {
    const messageClass = classifyTelegramMessage(event);
    let jobType: string;

    if (messageClass === 'excel_invoice') {
      jobType = 'PROCESS_EXCEL_INVOICE';
    } else if (messageClass === 'image_invoice') {
      jobType = 'PROCESS_IMAGE_INVOICE';
    } else {
      jobType = 'CHATBOT_REPLY';
    }

    await enqueue({
      job_type: jobType,
      correlation_id: requestId,
      tenant_id: tenantId,
      inbound_event_id: inserted.inboundEventId,
      platform_user_id: String(event.user_id),
      message_id: messageId,
      telegram_chat_id: event.chat_id,
      ...(event.document?.file_id ? { file_id: event.document.file_id } : {}),
      ...(event.photo?.length ? { file_id: event.photo[event.photo.length - 1]!.file_id } : {}),
      ...(messageClass === 'text_chat' && event.text ? { message_text: event.text } : {})
    });
  }

  logger.info('gateway_webhook_accepted', {
    request_id: requestId,
    tenant_id: tenantId,
    dedupe_hit: !inserted.inserted,
    platform_user_id: String(event.user_id),
    message_id: messageId
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

async function handleTelegramUpdate(event: TelegramBotEvent, requestId: string, startedAtMs: number, res: ResponseLike) {
  const platformUserId = String(event.user_id);
  const messageId = String(event.message_id);

  const membership = await resolveMembership(platformUserId);

  if (!membership.tenantId) {
    if (onboardingEnabled) {
      const textContent = event.text ?? event.caption ?? '';
      const inviteIntent = detectInviteIntent(textContent);
      if (inviteIntent.isInviteAttempt && inviteIntent.inviteCode) {
        const byUser = inviteByUserLimiter.consume(`invite:user:${platformUserId}`);
        const byIp = inviteByIpLimiter.consume(`invite:ip:${platformUserId}`);

        if (!byUser.allowed || !byIp.allowed) {
          await enqueue({
            job_type: 'NOTIFY_USER',
            notification_type: 'RATE_LIMITED',
            platform_user_id: platformUserId,
            tenant_id: null,
            inbound_event_id: null,
            message_id: messageId,
            correlation_id: requestId,
            telegram_chat_id: event.chat_id
          });
          respondAccepted(res, requestId, startedAtMs, { stage: 'invite_rate_limited' });
          return;
        }

        const consumeResult = await consumeInviteCode(platformUserId, inviteIntent.inviteCode, event.chat_id);
        if (consumeResult.ok && consumeResult.tenantId) {
          await enqueue({
            job_type: 'NOTIFY_USER',
            notification_type: 'WELCOME_LINKED',
            platform_user_id: platformUserId,
            tenant_id: consumeResult.tenantId,
            inbound_event_id: null,
            message_id: messageId,
            correlation_id: requestId,
            telegram_chat_id: event.chat_id
          });
        } else {
          await enqueue({
            job_type: 'NOTIFY_USER',
            notification_type: 'GENERIC_INFO',
            platform_user_id: platformUserId,
            tenant_id: null,
            inbound_event_id: null,
            message_id: messageId,
            correlation_id: requestId,
            telegram_chat_id: event.chat_id,
            template_vars: { message: 'Ma moi khong hop le hoac da het han. Vui long kiem tra lai.' }
          });
        }
        respondAccepted(res, requestId, startedAtMs, { stage: 'invite_processed' });
        return;
      }
    }

    await enqueue({
      job_type: 'NOTIFY_USER',
      notification_type: 'GENERIC_INFO',
      platform_user_id: platformUserId,
      tenant_id: null,
      inbound_event_id: null,
      message_id: messageId,
      correlation_id: requestId,
      telegram_chat_id: event.chat_id,
      template_vars: { message: 'Chao ban! De su dung, vui long gui ma moi tu chu cua hang cua ban.' }
    });
    respondAccepted(res, requestId, startedAtMs, { stage: 'onboarding_prompt' });
    return;
  }

  if (!tryReplayCache(membership.tenantId, messageId)) {
    respondAccepted(res, requestId, startedAtMs, { stage: 'replay_deduped' });
    return;
  }

  await enqueueLinkedFlow(event, requestId, membership.tenantId);
  respondAccepted(res, requestId, startedAtMs, { stage: 'linked_flow_enqueued' });
}

// ====== Ops endpoints ======

async function handleOps(req: { method?: string; url?: string; headers?: Record<string, string | string[] | undefined> }, res: ResponseLike) {
  const url = req.url ?? '';

  if (req.method === 'GET' && url.startsWith('/ops/link-kiotviet')) {
    const opsKey = process.env.OPS_KEY ?? '';
    const params = new URL(url, 'http://localhost').searchParams;
    if (!opsKey || params.get('key') !== opsKey) {
      json(res, 403, { error: 'forbidden' });
      return true;
    }
    try {
      const tenantId = '11111111-1111-1111-1111-111111111111';
      const retailer = params.get('retailer') ?? 'taphoatuyetbachd';
      await runSql(`UPDATE tenants SET kiotviet_retailer = $1, name = $2 WHERE id = $3`, [retailer, `Tap Hoa ${retailer}`, tenantId]);
      json(res, 200, { tenant_id: tenantId, kiotviet_retailer: retailer, status: 'linked' });
    } catch (err) {
      json(res, 500, { error: String(err) });
    }
    return true;
  }

  if (req.method === 'GET' && url.startsWith('/ops/create-invite')) {
    const opsKey = process.env.OPS_KEY ?? '';
    const urlKey = new URL(url, 'http://localhost').searchParams.get('key') ?? '';
    if (!opsKey || urlKey !== opsKey) {
      json(res, 403, { error: 'forbidden' });
      return true;
    }
    try {
      const tenantId = '11111111-1111-1111-1111-111111111111';
      await runSql(`
        INSERT INTO tenants (id, name, status, processing_mode)
        VALUES ($1, 'Tap Hoa GroceryClaw', 'active', 'v2')
        ON CONFLICT (id) DO NOTHING
      `, [tenantId]);

      const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const bytes = Array.from({ length: 10 }, () => Math.floor(Math.random() * 256));
      const code = bytes.map(b => ALPHABET[b % ALPHABET.length]).join('');
      const pepper = Buffer.from(invitePepperB64, 'base64');
      const codeHash = createHash('sha256').update(Buffer.concat([pepper, Buffer.from(code, 'utf8')])).digest('hex');
      const codeHint = code.slice(0, 2) + '****' + code.slice(-2);

      await runSql(`
        INSERT INTO invite_codes (tenant_id, code_hash, code_hint, target_role, status, expires_at)
        VALUES ($1, decode($2, 'hex'), $3, 'staff', 'active', now() + interval '720 hours')
      `, [tenantId, codeHash, codeHint]);

      json(res, 200, { tenant_id: tenantId, code, code_hint: codeHint, expires_in: '30 days' });
    } catch (err) {
      json(res, 500, { error: String(err) });
    }
    return true;
  }

  return false;
}

// ====== HTTP Server ======

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

  // Ops endpoints
  if (req.url?.startsWith('/ops/')) {
    const handled = await handleOps(req, res);
    if (handled) return;
  }

  // Telegram webhook endpoint
  if (req.method === 'POST' && req.url === '/webhooks/telegram') {
    const startedAtMs = Date.now();

    try {
      // Verify secret token (Telegram sends X-Telegram-Bot-Api-Secret-Token header)
      const secretToken = String(req.headers?.['x-telegram-bot-api-secret-token'] ?? '');
      const authResult = verifyTelegramWebhook(config.telegram.webhookSecret ?? '', secretToken);
      if (!authResult.ok) {
        metrics.webhookAuthFailuresTotal += 1;
        logger.warn('webhook_auth_fail', { request_id: requestId, reason: authResult.reason });
        json(res, authResult.statusCode, { error: 'unauthorized' });
        return;
      }

      const raw = await readBody(req);
      const parsed = JSON.parse(raw.toString('utf8')) as unknown;
      const validated = validateTelegramUpdate(parsed);

      if (!validated.ok) {
        json(res, 200, { status: 'ok', note: 'unprocessable_update' });
        return;
      }

      const event = validated.value;
      await handleTelegramUpdate(event, requestId, startedAtMs, res);
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
      logger.error('gateway_webhook_failed', { request_id: requestId, reason });
      json(res, 500, { error: 'internal_error' });
    }
    return;
  }

  json(res, 404, { error: 'not_found' });
});

metricsServer.listen(metricsPort, metricsHost, () => {
  logger.info('gateway metrics server started', { metrics_host: metricsHost, metrics_port: metricsPort });
});

// ====== Telegram Polling Mode ======

if (config.telegram.mode === 'polling' && config.telegram.botToken) {
  const bot = new TelegramBotClient({ botToken: config.telegram.botToken });

  (async () => {
    try {
      const me = await bot.getMe();
      logger.info(`Telegram bot started in polling mode: @${me.username ?? me.first_name}`);
      await bot.deleteWebhook();
    } catch (err) {
      logger.error('Failed to start Telegram polling', { error: err instanceof Error ? err.message : 'unknown' });
      return;
    }

    let offset: number | undefined;

    while (true) {
      try {
        const updates = await bot.getUpdates(offset);

        for (const raw of updates) {
          const result = validateTelegramUpdate(raw);
          if (!result.ok) {
            const updateId = (raw as Record<string, unknown>).update_id;
            if (typeof updateId === 'number') offset = updateId + 1;
            continue;
          }

          const event = result.value;
          offset = event.update_id + 1;
          const requestId = randomUUID();
          const startedAtMs = Date.now();

          // Create a fake response object for polling mode
          const fakeRes: ResponseLike = {
            writeHead: () => fakeRes,
            end: () => {}
          };

          try {
            await handleTelegramUpdate(event, requestId, startedAtMs, fakeRes);
          } catch (err) {
            logger.error('Error handling telegram update', {
              error: err instanceof Error ? err.message : 'unknown',
              update_id: String(event.update_id)
            });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        if (err instanceof TelegramApiError && err.statusCode === 409) {
          logger.error('Polling conflict — another bot instance or webhook is active', { error: message });
        } else {
          logger.error('Polling error', { error: message });
        }
        const delay = (err instanceof TelegramApiError && err.retryAfterMs) ? err.retryAfterMs : 5000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  })();
}

server.listen(config.port, config.host, () => {
  logger.info('gateway server started', {
    port: config.port,
    host: config.host,
    telegram_mode: config.telegram.mode,
    onboarding_enabled: onboardingEnabled,
    queue_transport: queue ? 'redis' : (process.env.NODE_ENV === 'test' && queueCmd ? 'queue_cmd' : 'none')
  });
});
