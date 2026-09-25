export interface McpServerConfig {
  readonly host: string;
  readonly port: number;
  readonly mcpPath: string;
  readonly databaseUrl: string;
  readonly dataBackend: 'postgres' | 'memory';
  readonly allowedOrigins: readonly string[];
  readonly allowLocalhostOrigins: boolean;
  readonly trustProxy: boolean;
  readonly rateLimitPerMinute: number;
  readonly authFailuresPerMinute: number;
  readonly confirmTtlSeconds: number;
  readonly sessionIdleSeconds: number;
  readonly maxSessions: number;
  readonly maxBodyBytes: number;
  readonly tokenCacheSeconds: number;
  readonly jsonResponses: boolean;
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

export function loadMcpServerConfig(env: Record<string, string | undefined>): McpServerConfig {
  const backend = env.MCP_DATA_BACKEND === 'memory' ? 'memory' : 'postgres';
  const databaseUrl = env.MCP_DB_URL ?? env.DB_APP_URL ?? env.DATABASE_URL ?? '';
  if (backend === 'postgres' && !databaseUrl) {
    throw new Error('MCP_DB_URL (or DB_APP_URL / DATABASE_URL) is required when MCP_DATA_BACKEND=postgres');
  }
  const production = env.NODE_ENV === 'production';
  return {
    host: env.MCP_HOST ?? '0.0.0.0',
    port: int(env.MCP_PORT, 8090, 1, 65535),
    mcpPath: '/mcp',
    databaseUrl,
    dataBackend: backend,
    allowedOrigins: (env.MCP_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    allowLocalhostOrigins: bool(env.MCP_ALLOW_LOCALHOST_ORIGINS, !production),
    trustProxy: bool(env.MCP_TRUST_PROXY, false),
    rateLimitPerMinute: int(env.MCP_RATE_LIMIT_PER_MINUTE, 120, 1, 100_000),
    authFailuresPerMinute: int(env.MCP_AUTH_FAILURES_PER_MINUTE, 20, 1, 10_000),
    confirmTtlSeconds: int(env.MCP_CONFIRM_TTL_SECONDS, 300, 10, 3600),
    sessionIdleSeconds: int(env.MCP_SESSION_IDLE_SECONDS, 1800, 30, 86_400),
    maxSessions: int(env.MCP_MAX_SESSIONS, 500, 1, 100_000),
    maxBodyBytes: int(env.MCP_MAX_BODY_BYTES, 262_144, 1024, 4_194_304),
    tokenCacheSeconds: int(env.MCP_TOKEN_CACHE_SECONDS, 30, 0, 3600),
    jsonResponses: bool(env.MCP_JSON_RESPONSES, true)
  };
}
