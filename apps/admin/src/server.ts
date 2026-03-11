import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { computeInviteCodeHashHex, createLogger, createPgPool, dbPing, encryptPayload, getSecurityHeaders, InMemoryTokenBucketRateLimiter, loadBaseConfig, loadRedisConfig, loadSecurityHeadersConfig, normalizeInviteCode, query, redisPing, type PgPoolLike } from '../../../packages/common/dist/index.js';
import { authenticateRequest, loadAdminAuthConfig, type AdminRole, type AuthenticatedPrincipal } from './auth.js';
import { isAllowedByRole } from './rbac.js';

const config = loadBaseConfig({
  serviceName: 'admin',
  defaultHost: '127.0.0.1',
  defaultPort: 3001
});

const authConfig = loadAdminAuthConfig(process.env);
const logger = createLogger({ service: 'admin', level: config.logLevel });
const redisConfig = loadRedisConfig({
  onWarning: (message) => logger.warn('admin_redis_config_deprecated', { message })
});
const dbCmd = process.env.ADMIN_DB_CMD ?? '';
const postgresUrl = process.env.DB_ADMIN_URL ?? process.env.DB_APP_URL ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? '';
const tenantEndpointsEnabled = (process.env.ADMIN_TENANT_ENDPOINTS_ENABLED ?? 'true') === 'true';
const invitePepperB64 = process.env.INVITE_PEPPER_B64
  ?? process.env.ADMIN_INVITE_PEPPER_B64
  ?? ((process.env.ADMIN_INVITE_PEPPER ?? '').trim() ? Buffer.from(process.env.ADMIN_INVITE_PEPPER ?? '', 'utf8').toString('base64') : '');


if (process.env.ADMIN_INVITE_PEPPER && !process.env.INVITE_PEPPER_B64 && !process.env.ADMIN_INVITE_PEPPER_B64) {
  logger.warn('admin_invite_pepper_deprecated', { message: 'Use INVITE_PEPPER_B64 instead of ADMIN_INVITE_PEPPER' });
}
const inviteTtlHours = Number(process.env.ADMIN_INVITE_TTL_HOURS ?? '72');
const inviteRateLimitPerMinute = Number(process.env.ADMIN_INVITE_RATE_PER_TENANT_PER_MINUTE ?? '10');
const inviteLimiter = new InMemoryTokenBucketRateLimiter(inviteRateLimitPerMinute, inviteRateLimitPerMinute);
const secretsEnabled = (process.env.ADMIN_SECRETS_ENABLED ?? 'true') === 'true';
const adminMekB64 = process.env.ADMIN_MEK_B64 ?? '';

function assertAdminPgPoolInitialized(pool: PgPoolLike | null | undefined): asserts pool is PgPoolLike {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new Error('Database pool has not been initialized. Please check your DB connection setup.');
  }
}

async function initializeAdminPool(): Promise<PgPoolLike | null> {
  if (!postgresUrl) {
    return null;
  }

  const pool = await createPgPool({
    connectionString: postgresUrl,
    applicationName: 'admin',
    statementTimeoutMs: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? '5000')
  });

  assertAdminPgPoolInitialized(pool);
  return pool;
}

const pgPool = await initializeAdminPool();
const readyzStrict = (process.env.READYZ_STRICT ?? 'true') === 'true';
const readyzTimeoutMs = Number(process.env.READYZ_TIMEOUT_MS ?? '300');
const metricsHost = process.env.ADMIN_METRICS_HOST ?? '0.0.0.0';
const metricsPort = Number(process.env.ADMIN_METRICS_PORT ?? '9101');
const securityHeadersConfig = loadSecurityHeadersConfig(process.env);
logger.debug('admin_redis_config_loaded', {
  host: redisConfig.host,
  port: redisConfig.port,
  db: redisConfig.db,
  has_password: Boolean(redisConfig.password)
});

function json(
  res: { writeHead: (status: number, headers?: Record<string, string>) => unknown; end: (body?: string) => void },
  code: number,
  body: Record<string, unknown>
) {
  res.writeHead(code, { ...getSecurityHeaders(securityHeadersConfig), 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function runCmdAdapter(command: string, input: string): string {
  const [exec, ...args] = command.trim().split(/\s+/);
  if (!exec) throw new Error('admin_db_error');
  const result = spawnSync(exec, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error('admin_db_error');
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
    assertAdminPgPoolInitialized(pgPool);
    const result = await query(pgPool, sql, params);
    if (result.rows.length === 0) return '';
    return result.rows.map((row) => Object.values(row).join('|')).join('\n').trim();
  }
  if (process.env.NODE_ENV === 'test' && dbCmd) {
    return runCmdAdapter(dbCmd, renderSqlForAdapter(sql, params));
  }
  throw new Error('admin_db_not_configured');
}

async function writeAdminAudit(principal: AuthenticatedPrincipal, action: string, requestId: string, payload: Record<string, unknown>, targetTenantId?: string): Promise<void> {
  try {
    await runSql(`
      INSERT INTO admin_audit_logs (actor_subject, actor_email, auth_mode, action, target_tenant_id, payload, request_id)
      VALUES ($1, NULL, $2, $3, $4::uuid, $5::jsonb, $6::uuid);
    `, [
      principal.subject,
      principal.authMode === 'break_glass' ? 'break_glass' : 'oidc',
      action,
      targetTenantId ?? null,
      JSON.stringify(payload),
      requestId
    ]);
  } catch {
    logger.warn('admin_audit_write_failed', { action, request_id: requestId });
  }
}
const metrics = {
  readyzChecksTotal: 0,
  readyzFailuresTotal: 0,
  dbReadyzFailuresTotal: 0,
  redisReadyzFailuresTotal: 0,
  requestsTotal: 0,
  requestFailuresTotal: 0
};

function renderMetrics(): string {
  return [
    '# TYPE groceryclaw_admin_readyz_checks_total counter',
    `groceryclaw_admin_readyz_checks_total ${metrics.readyzChecksTotal}`,
    '# TYPE groceryclaw_admin_readyz_failures_total counter',
    `groceryclaw_admin_readyz_failures_total ${metrics.readyzFailuresTotal}`,
    '# TYPE groceryclaw_admin_dependency_failures_total counter',
    `groceryclaw_admin_dependency_failures_total{dependency="db"} ${metrics.dbReadyzFailuresTotal}`,
    `groceryclaw_admin_dependency_failures_total{dependency="redis"} ${metrics.redisReadyzFailuresTotal}`,
    '# TYPE groceryclaw_admin_requests_total counter',
    `groceryclaw_admin_requests_total ${metrics.requestsTotal}`,
    '# TYPE groceryclaw_admin_request_failures_total counter',
    `groceryclaw_admin_request_failures_total ${metrics.requestFailuresTotal}`
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


function normalizeHeaders(raw: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    normalized[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return normalized;
}

async function readBody(req: { on: (event: 'data' | 'end' | 'error', listener: (...args: unknown[]) => void) => void }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}


async function checkReady(): Promise<{ ready: boolean; dbOk: boolean; redisOk: boolean }> {
  if (!readyzStrict) {
    return { ready: true, dbOk: true, redisOk: true };
  }

  const dbOk = pgPool ? await dbPing(pgPool, readyzTimeoutMs) : false;
  const redisOk = await redisPing(redisConfig, readyzTimeoutMs);
  return { ready: dbOk && redisOk, dbOk, redisOk };
}

function parseTenantIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/tenants\/([0-9a-f-]{36})(?:\/.*)?$/i);
  return match ? match[1] ?? null : null;
}

function validateTenantCreate(input: unknown): { ok: true; name: string; code: string; metadata: Record<string, unknown> } | { ok: false } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false };
  const payload = input as Record<string, unknown>;
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const code = typeof payload.code === 'string' ? payload.code.trim() : '';
  const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
    ? payload.metadata as Record<string, unknown>
    : {};

  if (!name || !code) return { ok: false };
  return { ok: true, name, code, metadata };
}

function validateTenantPatch(input: unknown): { ok: true; processingMode?: 'legacy' | 'v2'; enabled?: boolean; metadata?: Record<string, unknown> } | { ok: false } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false };
  const payload = input as Record<string, unknown>;
  const processingMode = payload.processing_mode === 'legacy' || payload.processing_mode === 'v2'
    ? payload.processing_mode
    : undefined;
  const enabled = typeof payload.enabled === 'boolean' ? payload.enabled : undefined;
  const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
    ? payload.metadata as Record<string, unknown>
    : undefined;

  if (!processingMode && enabled === undefined && !metadata) {
    return { ok: false };
  }

  return { ok: true, ...(processingMode ? { processingMode } : {}), ...(enabled !== undefined ? { enabled } : {}), ...(metadata ? { metadata } : {}) };
}

function validateSecretRotate(input: unknown): { ok: true; secretType: 'kiotviet_token'; payload: Record<string, unknown> } | { ok: false } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false };
  const payload = input as Record<string, unknown>;
  const secretType = payload.secret_type === 'kiotviet_token' ? payload.secret_type : null;
  const secretPayload = payload.payload;
  if (!secretType || !secretPayload || typeof secretPayload !== 'object' || Array.isArray(secretPayload)) {
    return { ok: false };
  }

  const serialized = JSON.stringify(secretPayload);
  if (serialized.length < 2 || serialized.length > 4096) {
    return { ok: false };
  }

  return { ok: true, secretType, payload: secretPayload as Record<string, unknown> };
}


function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 10; i += 1) {
    const idx = Math.floor(Math.random() * alphabet.length);
    code += alphabet[idx] ?? 'A';
  }
  return code;
}

async function authorize(
  req: { method?: string; headers?: Record<string, string | string[] | undefined> },
  requiredRole: AdminRole,
  requestId: string
): Promise<AuthenticatedPrincipal | null> {
  const headers = normalizeHeaders(req.headers ?? {});

  try {
    const principal = await authenticateRequest(authConfig, headers);
    if (!principal) {
      return null;
    }

    if (!isAllowedByRole(requiredRole, principal.role, req.method ?? 'GET')) {
      return { ...principal, role: 'read_only' };
    }

    if (principal.authMode === 'break_glass') {
      writeAdminAudit(principal, 'break_glass_access', requestId, {
        route: req.method,
        required_role: requiredRole,
        granted_role: principal.role
      });
    }

    return principal;
  } catch {
    return null;
  }
}

function tenantStatusFromEnabled(enabled: boolean): 'active' | 'suspended' {
  return enabled ? 'active' : 'suspended';
}

const server = createServer(async (req, res) => {
  const requestId = (((req.headers ?? {})['x-request-id'] as string | undefined) ?? randomUUID());

  if ((req.method === 'GET') && req.url === '/healthz') {
    json(res, 200, { status: 'ok', service: 'admin' });
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
    json(res, ready.ready ? 200 : 503, { status: ready.ready ? 'ok' : 'not_ready', service: 'admin' });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://admin.local');

  if (url.pathname === '/admin/ping' || url.pathname === '/admin/ops-ping') {
    const requiredRole: AdminRole = url.pathname === '/admin/ops-ping' ? 'ops' : 'read_only';
    const principal = await authorize(req, requiredRole, requestId);
    if (!principal) {
      json(res, 401, { error: 'unauthorized' });
      return;
    }

    if (!isAllowedByRole(requiredRole, principal.role, req.method ?? 'GET')) {
      json(res, 403, { error: 'forbidden' });
      return;
    }

    json(res, 200, {
      status: 'ok',
      subject: principal.subject,
      role: principal.role,
      required_role: requiredRole
    });
    return;
  }

  if (!tenantEndpointsEnabled && (url.pathname.startsWith('/tenants'))) {
    json(res, 404, { error: 'not_found' });
    return;
  }

  if (!secretsEnabled && /^\/tenants\/[0-9a-f-]{36}\/secrets/i.test(url.pathname)) {
    json(res, 404, { error: 'not_found' });
    return;
  }

  try {
    if (req.method === 'POST' && url.pathname === '/tenants') {
      const principal = await authorize(req, 'ops', requestId);
      if (!principal) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }
      if (!isAllowedByRole('ops', principal.role, req.method)) {
        json(res, 403, { error: 'forbidden' });
        return;
      }

      const parsed = validateTenantCreate(JSON.parse((await readBody(req)).toString('utf8')) as unknown);
      if (!parsed.ok) {
        json(res, 400, { error: 'bad_request' });
        return;
      }

      const result = await runSql(`
        INSERT INTO tenants (name, kiotviet_retailer, processing_mode, status, config)
        VALUES ($1, $2, 'legacy', 'active', $3::jsonb)
        RETURNING id::text, name, processing_mode, status;
      `, [parsed.name, parsed.code, JSON.stringify(parsed.metadata)]);

      const line = result.split('\n').map((x) => x.trim()).find((x) => x.includes('|'));
      if (!line) {
        throw new Error('admin_db_error');
      }
      const [id, name, processingMode, status] = line.split('|');
      await writeAdminAudit(principal, 'tenant_create', requestId, { name, processing_mode: processingMode, status }, id);

      json(res, 201, { id, name, processing_mode: processingMode, status });
      return;
    }

    if (req.method === 'GET' && /^\/tenants\/[0-9a-f-]{36}$/i.test(url.pathname)) {
      const principal = await authorize(req, 'read_only', requestId);
      if (!principal) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }
      if (!isAllowedByRole('read_only', principal.role, req.method)) {
        json(res, 403, { error: 'forbidden' });
        return;
      }

      const tenantId = parseTenantIdFromPath(url.pathname);
      if (!tenantId) {
        json(res, 404, { error: 'not_found' });
        return;
      }

      const result = await runSql(`
        SELECT id::text, name, processing_mode, status, config::text
        FROM tenants
        WHERE id = $1::uuid
        LIMIT 1;
      `, [tenantId]);

      const line = result.split('\n').map((x) => x.trim()).find((x) => x.includes('|'));
      if (!line) {
        json(res, 404, { error: 'not_found' });
        return;
      }
      const [id, name, processingMode, status, configRaw] = line.split('|');
      json(res, 200, { id, name, processing_mode: processingMode, status, config: JSON.parse(configRaw || '{}') });
      return;
    }

    if (req.method === 'PATCH' && /^\/tenants\/[0-9a-f-]{36}$/i.test(url.pathname)) {
      const principal = await authorize(req, 'ops', requestId);
      if (!principal) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }
      if (!isAllowedByRole('ops', principal.role, req.method)) {
        json(res, 403, { error: 'forbidden' });
        return;
      }

      const tenantId = parseTenantIdFromPath(url.pathname);
      if (!tenantId) {
        json(res, 404, { error: 'not_found' });
        return;
      }

      const parsed = validateTenantPatch(JSON.parse((await readBody(req)).toString('utf8')) as unknown);
      if (!parsed.ok) {
        json(res, 400, { error: 'bad_request' });
        return;
      }

      const result = await runSql(`
        UPDATE tenants
        SET
          processing_mode = COALESCE($1::text, processing_mode),
          status = COALESCE($2::text, status),
          config = COALESCE($3::jsonb, config),
          updated_at = now()
        WHERE id = $4::uuid
        RETURNING id::text, processing_mode, status, config::text;
      `, [
        parsed.processingMode ?? null,
        parsed.enabled !== undefined ? tenantStatusFromEnabled(parsed.enabled) : null,
        parsed.metadata ? JSON.stringify(parsed.metadata) : null,
        tenantId
      ]);

      const line = result.split('\n').map((x) => x.trim()).find((x) => x.includes('|'));
      if (!line) {
        json(res, 404, { error: 'not_found' });
        return;
      }

      const [id, processingMode, status, configRaw] = line.split('|');
      await writeAdminAudit(principal, 'tenant_patch', requestId, {
        processing_mode: processingMode,
        status
      }, id);

      json(res, 200, { id, processing_mode: processingMode, status, config: JSON.parse(configRaw || '{}') });
      return;
    }

    if (req.method === 'POST' && /^\/tenants\/[0-9a-f-]{36}\/invites$/i.test(url.pathname)) {
      const principal = await authorize(req, 'ops', requestId);
      if (!principal) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }
      if (!isAllowedByRole('ops', principal.role, req.method)) {
        json(res, 403, { error: 'forbidden' });
        return;
      }

      const tenantId = parseTenantIdFromPath(url.pathname);
      if (!tenantId) {
        json(res, 404, { error: 'not_found' });
        return;
      }

      if (!invitePepperB64) {
        json(res, 503, { error: 'service_unavailable' });
        return;
      }

      const rate = inviteLimiter.consume(`admin:invite:${tenantId}`);
      if (!rate.allowed) {
        json(res, 429, { error: 'rate_limited' });
        return;
      }

      const code = generateInviteCode();
      const normalized = normalizeInviteCode(code);
      const codeHashHex = computeInviteCodeHashHex(normalized, invitePepperB64);
      const codeHint = `${normalized.slice(0, 2)}****${normalized.slice(-2)}`;

      const result = await runSql(`
        INSERT INTO invite_codes (tenant_id, code_hash, code_hint, target_role, status, expires_at)
        VALUES (
          $1::uuid,
          decode($2, 'hex'),
          $3,
          'staff',
          'active',
          now() + make_interval(hours => $4)
        )
        RETURNING id::text, expires_at::text, status, target_role;
      `, [tenantId, codeHashHex, codeHint, inviteTtlHours]);

      const line = result.split('\n').map((x) => x.trim()).find((x) => x.includes('|'));
      if (!line) {
        throw new Error('admin_db_error');
      }
      const [id, expiresAt, status, targetRole] = line.split('|');

      await writeAdminAudit(principal, 'invite_create', requestId, {
        invite_id: id,
        target_role: targetRole,
        expires_at: expiresAt,
        code_hint: codeHint
      }, tenantId);

      json(res, 201, {
        id,
        code,
        code_hint: codeHint,
        status,
        target_role: targetRole,
        expires_at: expiresAt
      });
      return;
    }

    if (req.method === 'GET' && /^\/tenants\/[0-9a-f-]{36}\/invites$/i.test(url.pathname)) {
      const principal = await authorize(req, 'read_only', requestId);
      if (!principal) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }
      if (!isAllowedByRole('read_only', principal.role, req.method)) {
        json(res, 403, { error: 'forbidden' });
        return;
      }

      const tenantId = parseTenantIdFromPath(url.pathname);
      if (!tenantId) {
        json(res, 404, { error: 'not_found' });
        return;
      }

      const out = await runSql(`
        SELECT id::text || '|' || status || '|' || target_role || '|' || code_hint || '|' || expires_at::text
        FROM invite_codes
        WHERE tenant_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT 100;
      `, [tenantId]);

      const invites = out.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const [id, status, targetRole, codeHint, expiresAt] = line.split('|');
        return {
          id,
          status,
          target_role: targetRole,
          code_hint: codeHint,
          expires_at: expiresAt
        };
      });

      json(res, 200, { items: invites });
      return;
    }

    if (secretsEnabled && req.method === 'POST' && /^\/tenants\/[0-9a-f-]{36}\/secrets$/i.test(url.pathname)) {
      const principal = await authorize(req, 'ops', requestId);
      if (!principal) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }
      if (!isAllowedByRole('ops', principal.role, req.method)) {
        json(res, 403, { error: 'forbidden' });
        return;
      }

      const tenantId = parseTenantIdFromPath(url.pathname);
      if (!tenantId) {
        json(res, 404, { error: 'not_found' });
        return;
      }
      if (!adminMekB64) {
        json(res, 503, { error: 'service_unavailable' });
        return;
      }

      const parsed = validateSecretRotate(JSON.parse((await readBody(req)).toString('utf8')) as unknown);
      if (!parsed.ok) {
        json(res, 400, { error: 'bad_request' });
        return;
      }

      const existingVersionOut = await runSql(`
        SELECT COALESCE(MAX(version), 0)::text
        FROM secret_versions
        WHERE tenant_id = $1::uuid
          AND secret_type = $2;
      `, [tenantId, parsed.secretType]);
      const maxVersion = Number(existingVersionOut.split('\n').map((x) => x.trim()).find((x) => /^\d+$/.test(x)) ?? '0');
      const nextVersion = maxVersion + 1;

      const encrypted = encryptPayload(JSON.stringify(parsed.payload), adminMekB64);
      const encryptedDekHex = encrypted.encryptedDek.toString('hex');
      const encryptedValueHex = encrypted.encryptedValue.toString('hex');
      const dekNonceHex = encrypted.dekNonce.toString('hex');
      const valueNonceHex = encrypted.valueNonce.toString('hex');

      await runSql(`
        UPDATE secret_versions
        SET status = 'rotated', rotated_at = now()
        WHERE tenant_id = $1::uuid
          AND secret_type = $2
          AND status = 'active';
      `, [tenantId, parsed.secretType]);

      const out = await runSql(`
        INSERT INTO secret_versions (tenant_id, secret_type, version, encrypted_dek, encrypted_value, dek_nonce, value_nonce, status)
        VALUES (
          $1::uuid,
          $2,
          $3,
          decode($4, 'hex'),
          decode($5, 'hex'),
          decode($6, 'hex'),
          decode($7, 'hex'),
          'active'
        )
        RETURNING id::text, version::text, status, created_at::text;
      `, [tenantId, parsed.secretType, nextVersion, encryptedDekHex, encryptedValueHex, dekNonceHex, valueNonceHex]);

      const line = out.split('\n').map((x) => x.trim()).find((x) => x.includes('|'));
      if (!line) throw new Error('admin_db_error');
      const [id, version, status, createdAt] = line.split('|');

      await writeAdminAudit(principal, 'secret_rotate', requestId, {
        secret_id: id,
        secret_type: parsed.secretType,
        version,
        status
      }, tenantId);

      json(res, 201, { id, secret_type: parsed.secretType, version: Number(version), status, created_at: createdAt });
      return;
    }

    if (secretsEnabled && req.method === 'POST' && /^\/tenants\/[0-9a-f-]{36}\/secrets\/[0-9a-f-]{36}\/revoke$/i.test(url.pathname)) {
      const principal = await authorize(req, 'ops', requestId);
      if (!principal) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }
      if (!isAllowedByRole('ops', principal.role, req.method)) {
        json(res, 403, { error: 'forbidden' });
        return;
      }

      const tenantId = parseTenantIdFromPath(url.pathname);
      const secretMatch = url.pathname.match(/\/secrets\/([0-9a-f-]{36})\/revoke$/i);
      const secretId = secretMatch?.[1] ?? null;
      if (!tenantId || !secretId) {
        json(res, 404, { error: 'not_found' });
        return;
      }

      const out = await runSql(`
        UPDATE secret_versions
        SET status = 'revoked', revoked_at = now()
        WHERE tenant_id = $1::uuid
          AND id = $2::uuid
          AND status <> 'revoked'
        RETURNING id::text, secret_type, version::text, status, revoked_at::text;
      `, [tenantId, secretId]);

      const line = out.split('\n').map((x) => x.trim()).find((x) => x.includes('|'));
      if (!line) {
        json(res, 404, { error: 'not_found' });
        return;
      }
      const [id, secretType, version, status, revokedAt] = line.split('|');

      await writeAdminAudit(principal, 'secret_revoke', requestId, {
        secret_id: id,
        secret_type: secretType,
        version: Number(version),
        status
      }, tenantId);

      json(res, 200, { id, secret_type: secretType, version: Number(version), status, revoked_at: revokedAt });
      return;
    }

    if (secretsEnabled && req.method === 'GET' && /^\/tenants\/[0-9a-f-]{36}\/secrets$/i.test(url.pathname)) {
      const principal = await authorize(req, 'read_only', requestId);
      if (!principal) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }
      if (!isAllowedByRole('read_only', principal.role, req.method)) {
        json(res, 403, { error: 'forbidden' });
        return;
      }

      const tenantId = parseTenantIdFromPath(url.pathname);
      if (!tenantId) {
        json(res, 404, { error: 'not_found' });
        return;
      }

      const out = await runSql(`
        SELECT id::text || '|' || secret_type || '|' || version::text || '|' || status || '|' || created_at::text || '|' || COALESCE(revoked_at::text, '')
        FROM secret_versions
        WHERE tenant_id = $1::uuid
        ORDER BY version DESC;
      `, [tenantId]);

      const items = out.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const [id, secretType, version, status, createdAt, revokedAt] = line.split('|');
        return {
          id,
          secret_type: secretType,
          version: Number(version),
          status,
          created_at: createdAt,
          revoked_at: revokedAt || null
        };
      });

      json(res, 200, { items });
      return;
    }
  } catch (error) {
    metrics.requestFailuresTotal += 1;
    logger.warn('admin_request_failed', {
      request_id: requestId,
      reason: error instanceof Error ? error.message : 'unknown_error'
    });
    if (error instanceof Error && error.message === 'admin_db_not_configured') {
      json(res, 503, { error: 'service_unavailable' });
      return;
    }
    if (error instanceof Error && error.message.includes('JSON')) {
      json(res, 400, { error: 'bad_request' });
      return;
    }
    json(res, 500, { error: 'internal_error' });
    return;
  }

  json(res, 404, { error: 'not_found' });
});

metricsServer.listen(metricsPort, metricsHost, () => {
  logger.info('admin metrics server started', { metrics_host: metricsHost, metrics_port: metricsPort });
});

server.listen(config.port, config.host, () => {
  logger.info('admin server started', {
    port: config.port,
    host: config.host,
    auth_enabled: authConfig.enabled,
    breakglass_enabled: authConfig.breakglass.enabled,
    tenant_endpoints_enabled: tenantEndpointsEnabled,
    secrets_endpoints_enabled: secretsEnabled,
    db_admin_configured: Boolean(pgPool)
  });
});
