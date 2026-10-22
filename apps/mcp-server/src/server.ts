import { createServer } from 'node:http';
import { createLogger, createPgPool } from '../../../packages/common/dist/index.js';
import type { LogLevel, PgPoolLike } from '../../../packages/common/dist/index.js';
import { loadMcpServerConfig } from './config.js';
import { createMcpHttpHandler } from './http.js';
import type { McpHttpDeps } from './http.js';
import { PgShopStore } from './pg-store.js';
import { MemoryShopStore } from './memory-store.js';
import type { MemoryDataset, MemoryTenantData } from './memory-store.js';
import type { ShopStore } from './store.js';
import { MemoryOAuthStore } from './oauth/store.js';
import type { Locale, OAuthStore } from './oauth/store.js';
import { PgOAuthStore } from './oauth/pg-store.js';

const logger = createLogger({ service: 'mcp-server', level: (process.env.LOG_LEVEL ?? 'info') as LogLevel });

interface DemoSeedModule {
  buildDemoDataset(opts: { anchorDate?: string; tokens: Record<string, string>; readOnlyTokens?: string[] }): MemoryDataset;
  buildSandboxCatalogue(): unknown;
  buildSandboxTenantData(locale: Locale, anchorDate?: string): MemoryTenantData;
  SANDBOX_PROFILES: Record<Locale, { shop_name: string }>;
  DEMO_TENANT_ID: string;
}

async function loadSeed(): Promise<DemoSeedModule> {
  const seedUrl = new URL('../../../scripts/v2/gen_demo_seed.mjs', import.meta.url);
  return (await import(seedUrl.href)) as DemoSeedModule;
}

/** RLS only protects tenants when the runtime role cannot bypass it. */
export async function assertUnprivilegedDbUser(pool: PgPoolLike, allowPrivileged: boolean): Promise<void> {
  if (allowPrivileged) {
    logger.warn('mcp_privileged_db_user_allowed', { message: 'MCP_ALLOW_PRIVILEGED_DB_USER=true: local development only' });
    return;
  }
  const { rows } = await pool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
  const row = rows[0] as { rolsuper?: boolean; rolbypassrls?: boolean } | undefined;
  if (!row || row.rolsuper === true || row.rolbypassrls === true) {
    throw new Error('Refusing to start: the MCP database user must not be a superuser or have BYPASSRLS (set MCP_ALLOW_PRIVILEGED_DB_USER=true only for local development)');
  }
}

async function createStores(): Promise<{ store: ShopStore; oauthStore: OAuthStore | null }> {
  const config = loadMcpServerConfig(process.env);
  const oauthEnabled = !!config.publicBaseUrl;
  if (config.dataBackend === 'memory') {
    const token = process.env.MCP_DEMO_TOKEN ?? '';
    if (token.length < 32) throw new Error('MCP_DEMO_TOKEN (>= 32 chars) is required when MCP_DATA_BACKEND=memory');
    const seed = await loadSeed();
    logger.warn('mcp_memory_backend', { message: 'Serving the in-memory demo dataset (no Postgres). OAuth accounts vanish on restart.' });
    const judgeToken = process.env.MCP_JUDGE_TOKEN ?? '';
    if (judgeToken && (judgeToken.length < 32 || judgeToken === token)) {
      throw new Error('MCP_JUDGE_TOKEN must be >= 32 chars and differ from MCP_DEMO_TOKEN');
    }
    const store = new MemoryShopStore(seed.buildDemoDataset({
      ...(process.env.DEMO_ANCHOR_DATE ? { anchorDate: process.env.DEMO_ANCHOR_DATE } : {}),
      tokens: { [token]: seed.DEMO_TENANT_ID, ...(judgeToken ? { [judgeToken]: seed.DEMO_TENANT_ID } : {}) },
      readOnlyTokens: judgeToken ? [judgeToken] : []
    }));
    const oauthStore = oauthEnabled
      ? new MemoryOAuthStore({
        provision: (tenantId, locale) => {
          store.addTenant(tenantId, seed.buildSandboxTenantData(locale, process.env.DEMO_ANCHOR_DATE || undefined));
          return seed.SANDBOX_PROFILES[locale].shop_name;
        },
        remove: (tenantId) => store.removeTenant(tenantId)
      })
      : null;
    return { store, oauthStore };
  }
  const pool = await createPgPool({
    connectionString: config.databaseUrl,
    applicationName: 'mcp-server',
    statementTimeoutMs: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? '5000')
  });
  await assertUnprivilegedDbUser(pool, config.allowPrivilegedDbUser);
  const oauthStore = oauthEnabled
    ? new PgOAuthStore(pool, { catalogue: (await loadSeed()).buildSandboxCatalogue(), invitePepperB64: config.invitePepperB64 })
    : null;
  return { store: new PgShopStore(pool), oauthStore };
}

async function main(): Promise<void> {
  const config = loadMcpServerConfig(process.env);
  const { store, oauthStore } = await createStores();
  const deps: McpHttpDeps = { store, config, logger, ...(oauthStore ? { oauth: { store: oauthStore } } : {}) };
  const handler = createMcpHttpHandler(deps);
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  const sweep = setInterval(() => {
    void handler.sweepIdleSessions();
  }, 60_000);
  sweep.unref();
  const housekeeping = setInterval(() => {
    handler.oauthCleanup()
      .then((removed) => { if (removed > 0) logger.info('oauth_cleanup', { removed_clients: removed }); })
      .catch((error: unknown) => logger.warn('oauth_cleanup_failed', { error: error instanceof Error ? error.message : 'unknown' }));
  }, 6 * 3600_000);
  housekeeping.unref();

  server.listen(config.port, config.host, () => {
    logger.info('mcp_server_listening', {
      host: config.host,
      port: config.port,
      path: config.mcpPath,
      backend: config.dataBackend,
      allowed_origins: config.allowedOrigins.length,
      oauth: oauthStore ? config.publicBaseUrl : 'disabled'
    });
  });

  const shutdown = async (signal: string) => {
    logger.info('mcp_server_shutdown', { signal });
    server.close();
    await handler.close();
    await store.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error('mcp_server_start_failed', { error: error instanceof Error ? error.message : 'unknown' });
  process.exit(1);
});
