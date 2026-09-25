import { createServer } from 'node:http';
import { createLogger, createPgPool } from '../../../packages/common/dist/index.js';
import type { LogLevel } from '../../../packages/common/dist/index.js';
import { loadMcpServerConfig } from './config.js';
import { createMcpHttpHandler } from './http.js';
import { PgShopStore } from './pg-store.js';
import { MemoryShopStore } from './memory-store.js';
import type { MemoryDataset } from './memory-store.js';
import type { ShopStore } from './store.js';

const logger = createLogger({ service: 'mcp-server', level: (process.env.LOG_LEVEL ?? 'info') as LogLevel });

interface DemoSeedModule {
  buildDemoDataset(opts: { anchorDate?: string; tokens: Record<string, string> }): MemoryDataset;
  DEMO_TENANT_ID: string;
}

async function createStore(): Promise<ShopStore> {
  const config = loadMcpServerConfig(process.env);
  if (config.dataBackend === 'memory') {
    const token = process.env.MCP_DEMO_TOKEN ?? '';
    if (token.length < 32) throw new Error('MCP_DEMO_TOKEN (>= 32 chars) is required when MCP_DATA_BACKEND=memory');
    const seedUrl = new URL('../../../scripts/v2/gen_demo_seed.mjs', import.meta.url);
    const seed = (await import(seedUrl.href)) as DemoSeedModule;
    logger.warn('mcp_memory_backend', { message: 'Serving the in-memory demo dataset (no Postgres).' });
    return new MemoryShopStore(seed.buildDemoDataset({
      ...(process.env.DEMO_ANCHOR_DATE ? { anchorDate: process.env.DEMO_ANCHOR_DATE } : {}),
      tokens: { [token]: seed.DEMO_TENANT_ID }
    }));
  }
  const pool = await createPgPool({
    connectionString: config.databaseUrl,
    applicationName: 'mcp-server',
    statementTimeoutMs: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? '5000')
  });
  return new PgShopStore(pool);
}

async function main(): Promise<void> {
  const config = loadMcpServerConfig(process.env);
  const store = await createStore();
  const handler = createMcpHttpHandler({ store, config, logger });
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  const sweep = setInterval(() => {
    void handler.sweepIdleSessions();
  }, 60_000);
  sweep.unref();

  server.listen(config.port, config.host, () => {
    logger.info('mcp_server_listening', {
      host: config.host,
      port: config.port,
      path: config.mcpPath,
      backend: config.dataBackend,
      allowed_origins: config.allowedOrigins.length
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
