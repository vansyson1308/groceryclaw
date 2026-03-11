import type { RuntimeEnvironment } from './types.js';
import type { WebhookAuthConfig, WebhookVerifyMode } from './webhook-auth.js';

export interface BaseConfig {
  readonly nodeEnv: RuntimeEnvironment;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly port: number;
  readonly host: string;
}

export interface GatewayConfig extends BaseConfig {
  readonly webhookAuth: WebhookAuthConfig;
}

export interface DatabaseConfig {
  readonly dbAppUrl: string;
  readonly dbAdminUrl: string;
  readonly dbStatementTimeoutMs: number;
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parsePort(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${field} must be a valid TCP port, received: ${value}`);
  }

  return parsed;
}

function parseEnv(value: string | undefined): RuntimeEnvironment {
  const env = value ?? 'development';
  if (env === 'development' || env === 'test' || env === 'production') {
    return env;
  }

  throw new Error(`NODE_ENV must be one of development|test|production, received: ${env}`);
}

function parseLogLevel(value: string | undefined): BaseConfig['logLevel'] {
  const level = value ?? 'info';
  if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
    return level;
  }

  throw new Error(`LOG_LEVEL must be one of debug|info|warn|error, received: ${level}`);
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value === 'true';
}

function parsePositiveInt(value: string | undefined, field: string, fallback: number): number {
  const resolved = value ?? String(fallback);
  const parsed = Number(resolved);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer, received: ${resolved}`);
  }
  return parsed;
}

function parseVerifyMode(value: string | undefined): WebhookVerifyMode {
  const mode = value ?? 'mode1';
  if (mode === 'mode1' || mode === 'mode2') {
    return mode;
  }

  throw new Error(`WEBHOOK_VERIFY_MODE must be one of mode1|mode2, received: ${mode}`);
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
}

function parseDbUrl(value: string, field: 'DB_APP_URL' | 'DB_ADMIN_URL'): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`${field} must use postgres:// or postgresql:// protocol`);
  }

  return value;
}

export function loadDatabaseConfig(envInput?: Record<string, string | undefined>): DatabaseConfig {
  const env = envInput ?? process.env;
  const dbAppUrl = parseDbUrl(required('DB_APP_URL', env.DB_APP_URL), 'DB_APP_URL');
  const dbAdminUrl = parseDbUrl(required('DB_ADMIN_URL', env.DB_ADMIN_URL), 'DB_ADMIN_URL');

  return {
    dbAppUrl,
    dbAdminUrl,
    dbStatementTimeoutMs: parsePositiveInt(env.DB_STATEMENT_TIMEOUT_MS, 'DB_STATEMENT_TIMEOUT_MS', 5000)
  };
}

export function loadBaseConfig(opts: {
  readonly serviceName: 'gateway' | 'admin' | 'worker';
  readonly env?: Record<string, string | undefined>;
  readonly defaultPort: number;
  readonly defaultHost: string;
}): BaseConfig {
  const env = opts.env ?? process.env;

  const portVar = `${opts.serviceName.toUpperCase()}_PORT`;
  const hostVar = `${opts.serviceName.toUpperCase()}_HOST`;

  const port = parsePort(env[portVar] ?? String(opts.defaultPort), portVar);
  const host = env[hostVar] ?? opts.defaultHost;
  required(hostVar, host);

  return {
    nodeEnv: parseEnv(env.NODE_ENV),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    port,
    host
  };
}

export function loadGatewayConfig(envInput?: Record<string, string | undefined>): GatewayConfig {
  const env = envInput ?? process.env;
  const base = loadBaseConfig({
    serviceName: 'gateway',
    defaultHost: '0.0.0.0',
    defaultPort: 3000,
    env
  });

  const verifyMode = parseVerifyMode(env.WEBHOOK_VERIFY_MODE);
  const enforceTimestamp = parseBoolean(env.WEBHOOK_ENFORCE_TIMESTAMP, false);

  if (enforceTimestamp && verifyMode !== 'mode1') {
    throw new Error('WEBHOOK_ENFORCE_TIMESTAMP can only be true when WEBHOOK_VERIFY_MODE=mode1');
  }

  return {
    ...base,
    webhookAuth: {
      nodeEnv: base.nodeEnv,
      verifyMode,
      mode2AllowInProduction: parseBoolean(env.WEBHOOK_MODE2_ALLOW_IN_PRODUCTION, false),
      signatureSecret: env.WEBHOOK_SIGNATURE_SECRET ?? '',
      signatureHeaders: parseCsv(env.WEBHOOK_SIGNATURE_HEADERS).length > 0
        ? parseCsv(env.WEBHOOK_SIGNATURE_HEADERS)
        : ['x-zalo-signature', 'x-signature', 'x-hub-signature-256'],
      signatureAlgorithm: env.WEBHOOK_SIGNATURE_ALGORITHM === 'sha512' ? 'sha512' : 'sha256',
      mode2TokenHeader: (env.WEBHOOK_MODE2_TOKEN_HEADER ?? 'x-webhook-token').toLowerCase(),
      mode2Token: env.WEBHOOK_MODE2_TOKEN ?? '',
      mode2IpAllowlist: parseCsv(env.WEBHOOK_MODE2_IP_ALLOWLIST),
      mode2GlobalRateLimitPerMinute: parsePositiveInt(env.WEBHOOK_MODE2_GLOBAL_RATE_PER_MINUTE, 'WEBHOOK_MODE2_GLOBAL_RATE_PER_MINUTE', 300),
      mode2PerIpRateLimitPerMinute: parsePositiveInt(env.WEBHOOK_MODE2_PER_IP_RATE_PER_MINUTE, 'WEBHOOK_MODE2_PER_IP_RATE_PER_MINUTE', 60),
      mode2PerPlatformUserRateLimitPerMinute: parsePositiveInt(env.WEBHOOK_MODE2_PER_PLATFORM_USER_RATE_PER_MINUTE, 'WEBHOOK_MODE2_PER_PLATFORM_USER_RATE_PER_MINUTE', 30),
      mode2AttachmentAllowlist: parseCsv(env.WEBHOOK_MODE2_ATTACHMENT_ALLOWLIST).length > 0
        ? parseCsv(env.WEBHOOK_MODE2_ATTACHMENT_ALLOWLIST)
        : ['zalo.me', 'zadn.vn'],
      enforceTimestamp,
      timestampHeader: (env.WEBHOOK_TIMESTAMP_HEADER ?? 'x-zalo-timestamp').toLowerCase(),
      timestampMaxDriftSeconds: parsePositiveInt(env.WEBHOOK_TIMESTAMP_MAX_DRIFT_SECONDS, 'WEBHOOK_TIMESTAMP_MAX_DRIFT_SECONDS', 300)
    }
  };
}
