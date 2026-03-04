import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  createLogger,
  detectInviteIntent,
  InMemoryTokenBucketRateLimiter,
  loadGatewayConfig,
  validateZaloWebhookPayload,
  verifyWebhookRequest,
  type ZaloWebhookEvent
} from '../../../packages/common/dist/index.js';

const config = loadGatewayConfig();
const logger = createLogger({ service: 'gateway', level: config.logLevel });

const webhookEnabled = (process.env.V2_GATEWAY_WEBHOOK_ENABLED ?? 'true') === 'true';
const onboardingEnabled = (process.env.V2_ONBOARDING_ENABLED ?? 'true') === 'true';
const maxBodyBytes = Number(process.env.GATEWAY_MAX_BODY_BYTES ?? '262144');
const dbCmd = process.env.GATEWAY_DB_CMD ?? '';
const queueCmd = process.env.GATEWAY_QUEUE_CMD ?? '';
const replayCacheTtlSeconds = Number(process.env.WEBHOOK_REPLAY_TTL_SECONDS ?? '86400');
const invitePepperHex = process.env.INVITE_PEPPER_HEX ?? '';
const invitePepperB64 = process.env.INVITE_PEPPER_B64 ?? '';

const inMemoryDedupe = new Set<string>();
const replayCache = new Map<string, number>();
const inviteUserRatePerMinute = Number(process.env.ONBOARDING_INVITE_USER_RATE_PER_MINUTE ?? '10');
const inviteIpRatePerMinute = Number(process.env.ONBOARDING_INVITE_IP_RATE_PER_MINUTE ?? '20');
const inviteByUserLimiter = new InMemoryTokenBucketRateLimiter(inviteUserRatePerMinute, inviteUserRatePerMinute);
const inviteByIpLimiter = new InMemoryTokenBucketRateLimiter(inviteIpRatePerMinute, inviteIpRatePerMinute);

type ResponseLike = {
  writeHead: (statusCode: number, headers?: Record<string, string>) => unknown;
  end: (chunk?: string) => void;
};

function json(res: ResponseLike, code: number, body: Record<string, unknown>) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
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

function runSql(sql: string): string {
  if (!dbCmd) return '';
  const result = spawnSync('bash', ['-lc', dbCmd], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    throw new Error('db_error');
  }
  return result.stdout.trim();
}

function resolveMembership(platformUserId: string): { tenantId?: string } {
  if (!dbCmd) return {};

  const out = runSql(`
    SELECT tenant_id::text
    FROM resolve_membership_by_platform_user_id(${sqlQuote(platformUserId)})
    LIMIT 1;
  `);
  if (!out) return {};
  const tenantId = out.split('\n')[0]?.trim();
  return tenantId ? { tenantId } : {};
}

function consumeInviteCode(platformUserId: string, inviteCode: string): { ok: boolean; tenantId?: string; roleAssigned?: string } {
  if (!dbCmd) return { ok: false };

  const setPepperSql = invitePepperHex
    ? `SET LOCAL app.invite_pepper = ${sqlQuote(invitePepperHex)};`
    : invitePepperB64
      ? `SET LOCAL app.invite_pepper_b64 = ${sqlQuote(invitePepperB64)};`
      : '';

  const out = runSql(`
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

function getTenantProcessingMode(tenantId: string): 'legacy' | 'v2' {
  if (!dbCmd) return 'v2';
  const out = runSql(`
    BEGIN;
    SET LOCAL app.current_tenant = ${sqlQuote(tenantId)};
    SELECT processing_mode
    FROM tenants
    WHERE id = ${sqlQuote(tenantId)}::uuid
    LIMIT 1;
    COMMIT;
  `);

  const line = out.split('\n').map((item) => item.trim()).find((item) => item === 'legacy' || item === 'v2');
  return line === 'legacy' ? 'legacy' : 'v2';
}


function resolveZaloUserId(platformUserId: string): string | undefined {
  if (!dbCmd) {
    return undefined;
  }
  const out = runSql(`
    SELECT id::text
    FROM zalo_users
    WHERE platform_user_id = ${sqlQuote(platformUserId)}
    LIMIT 1;
  `);
  const value = out.split('\n').map((line) => line.trim()).find((line) => /^[0-9a-f-]{36}$/i.test(line));
  return value;
}

function recordInboundInteraction(tenantId: string, platformUserId: string): string | undefined {
  if (!dbCmd) {
    return undefined;
  }

  const out = runSql(`
    BEGIN;
    SET LOCAL app.current_tenant = ${sqlQuote(tenantId)};
    UPDATE zalo_users
    SET last_interaction_at = now()
    WHERE platform_user_id = ${sqlQuote(platformUserId)};
    SELECT id::text
    FROM zalo_users
    WHERE platform_user_id = ${sqlQuote(platformUserId)}
    LIMIT 1;
    COMMIT;
  `);

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

function insertInboundEvent(event: ZaloWebhookEvent, tenantId?: string): { inserted: boolean; inboundEventId: string } {
  if (!dbCmd) {
    const resolvedTenant = tenantId ?? 'unlinked';
    const key = `${resolvedTenant}:${event.zalo_msg_id}`;
    if (inMemoryDedupe.has(key)) {
      return { inserted: false, inboundEventId: key };
    }
    inMemoryDedupe.add(key);
    return { inserted: true, inboundEventId: randomUUID() };
  }

  const resolvedTenant = tenantId ?? '00000000-0000-0000-0000-000000000000';
  const insertSql = `
    BEGIN;
    INSERT INTO inbound_events (tenant_id, zalo_user_id, zalo_msg_id, event_type, payload, status)
    VALUES (
      ${sqlQuote(resolvedTenant)}::uuid,
      COALESCE((SELECT id FROM zalo_users WHERE platform_user_id = ${sqlQuote(event.platform_user_id)} LIMIT 1), '00000000-0000-0000-0000-000000000000'::uuid),
      ${sqlQuote(event.zalo_msg_id)},
      ${sqlQuote(event.message_type)},
      ${sqlQuote(JSON.stringify(event.raw))}::jsonb,
      'received'
    )
    ON CONFLICT (tenant_id, zalo_msg_id) DO NOTHING
    RETURNING id::text;
    COMMIT;
  `;

  const out = runSql(insertSql);
  const id = out.split('\n').map((x) => x.trim()).find((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!id) {
    return { inserted: false, inboundEventId: `${resolvedTenant}:${event.zalo_msg_id}` };
  }
  return { inserted: true, inboundEventId: id };
}

function enqueue(payload: Record<string, unknown>) {
  if (!queueCmd) return;

  const withEnqueueTs = ('enqueued_at_ms' in payload) ? payload : { ...payload, enqueued_at_ms: Date.now() };
  const message = JSON.stringify(withEnqueueTs).replace(/'/g, "''");
  const cmd = `${queueCmd} '${message}'`;
  const result = spawnSync('bash', ['-lc', cmd], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error('queue_error');
  }
}

function enqueueNotify(platformUserId: string, template: 'invite_success' | 'invite_generic_failure' | 'invite_wait_retry' | 'onboarding_prompt', tenantId?: string) {
  enqueue({
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

function enqueueLinkedFlow(event: ZaloWebhookEvent, requestId: string, tenantId: string) {
  const inserted = insertInboundEvent(event, tenantId);
  const processingMode = getTenantProcessingMode(tenantId);
  const zaloUserId = recordInboundInteraction(tenantId, event.platform_user_id) ?? resolveZaloUserId(event.platform_user_id);

  if (zaloUserId) {
    enqueue({
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
    enqueue({
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
  logger.info('gateway_ack_ms', { request_id: requestId, gateway_ack_ms: ackMs, ...(extras ?? {}) });
  json(res, 200, { status: 'accepted', request_id: requestId });
}

const server = createServer(async (req, res) => {
  const requestId = (req.headers?.['x-request-id'] as string | undefined) ?? randomUUID();

  if ((req.method === 'GET') && (req.url === '/healthz' || req.url === '/readyz')) {
    json(res, 200, { status: 'ok', service: 'gateway' });
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
      const membership = resolveMembership(event.platform_user_id);

      if (!membership.tenantId) {
        if (onboardingEnabled) {
          const inviteIntent = detectInviteIntent(event.text);
          if (inviteIntent.isInviteAttempt && inviteIntent.inviteCode) {
            const sourceIp = getSourceIp(req.headers as Record<string, string | string[] | undefined>) || 'unknown';
            const byUser = inviteByUserLimiter.consume(`invite:user:${event.platform_user_id}`);
            const byIp = inviteByIpLimiter.consume(`invite:ip:${sourceIp}`);

            if (!byUser.allowed || !byIp.allowed) {
              enqueueNotify(event.platform_user_id, 'invite_wait_retry');
              respondAccepted(res, requestId, startedAtMs, { stage: 'invite_rate_limited' });
              return;
            }

            const consumeResult = consumeInviteCode(event.platform_user_id, inviteIntent.inviteCode);
            if (consumeResult.ok && consumeResult.tenantId) {
              enqueueNotify(event.platform_user_id, 'invite_success', consumeResult.tenantId);
            } else {
              enqueueNotify(event.platform_user_id, 'invite_generic_failure');
            }
            respondAccepted(res, requestId, startedAtMs, { stage: 'invite_processed' });
            return;
          }
        }

        enqueueNotify(event.platform_user_id, 'onboarding_prompt');
        respondAccepted(res, requestId, startedAtMs, { stage: 'onboarding_prompt' });
        return;
      }

      if (!tryReplayCache(membership.tenantId, event.zalo_msg_id)) {
        respondAccepted(res, requestId, startedAtMs, { stage: 'replay_deduped' });
        return;
      }

      enqueueLinkedFlow(event, requestId, membership.tenantId);
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

server.listen(config.port, config.host, () => {
  logger.info('gateway server started', {
    port: config.port,
    host: config.host,
    webhook_enabled: webhookEnabled,
    onboarding_enabled: onboardingEnabled,
    webhook_verify_mode: config.webhookAuth.verifyMode
  });
});
