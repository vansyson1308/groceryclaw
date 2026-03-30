import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LogLevel, PgPoolLike, RedisConnection } from '../../../packages/common/dist/index.js';
import { createLogger, createPgPool, query, Queue, loadRedisConfig } from '../../../packages/common/dist/index.js';
import { validateInitData } from './auth.js';
import { getInvoice } from './routes/invoice.js';
import { processItemAction } from './routes/confirm.js';
import { searchProducts, findByBarcode } from './routes/search.js';

const logLevel = (process.env.LOG_LEVEL ?? 'info') as LogLevel;
const logger = createLogger({ service: 'miniapp', level: logLevel });

const host = process.env.MINIAPP_HOST ?? '0.0.0.0';
const port = Number(process.env.MINIAPP_PORT ?? '3003');
const botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
const postgresUrl = process.env.DB_APP_URL ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? '';
const queueName = process.env.BULLMQ_QUEUE_NAME ?? 'process-inbound';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const staticDir = join(__dirname, '..', 'static');

// Postgres pool
let pgPool: PgPoolLike | null = null;

// BullMQ queue for enqueuing KIOTVIET_SYNC jobs
let queue: Queue | null = null;

async function initServices(): Promise<void> {
  if (postgresUrl) {
    pgPool = await createPgPool({
      connectionString: postgresUrl,
      applicationName: 'miniapp',
    });
  }

  try {
    const redisConfig = loadRedisConfig({
      onWarning: (message: string) => logger.warn('miniapp_redis_warn', { message })
    });
    queue = new Queue(queueName, {
      connection: {
        host: redisConfig.host,
        port: redisConfig.port,
        db: redisConfig.db,
        ...(redisConfig.password ? { password: redisConfig.password } : {})
      } as RedisConnection
    });
    logger.info('miniapp_queue_ready', { queueName });
  } catch (err) {
    logger.warn('miniapp_queue_init_failed', { error: (err as Error).message });
  }
}

// MIME types for static files
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function respondJson(res: import('node:http').ServerResponse, statusCode: number, data: unknown) {
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'Content-Type, X-Telegram-Init-Data',
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let size = 0;
    req.on('data', (...args: unknown[]) => {
      const chunk = String(args[0] ?? '');
      size += chunk.length;
      if (size > 8192) { reject(new Error('body_too_large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(chunks.join('')) as Record<string, unknown>); }
      catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res: import('node:http').ServerResponse, urlPath: string): Promise<boolean> {
  const safePath = urlPath === '/' ? '/index.html' : urlPath;

  // Prevent directory traversal
  if (safePath.includes('..') || safePath.includes('\0')) {
    return false;
  }

  const filePath = join(staticDir, safePath);
  if (!filePath.startsWith(staticDir)) {
    return false;
  }

  try {
    const content = await readFile(filePath, 'utf8');
    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=300' });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

interface TenantScopedDeps {
  queryOne: (sql: string, params?: readonly unknown[]) => Promise<string>;
  queryMany: (sql: string, params?: readonly unknown[]) => Promise<string[]>;
  exec: (sql: string, params?: readonly unknown[]) => Promise<void>;
}

async function runTenantScopedQuery<T>(
  tenantId: string,
  work: (deps: TenantScopedDeps) => Promise<T>
): Promise<T> {
  if (!pgPool) throw new Error('no_database');

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);

    const deps: TenantScopedDeps = {
      queryOne: async (sql: string, params?: readonly unknown[]): Promise<string> => {
        const result = await client.query(sql, params as unknown[]);
        return result.rows[0] ? Object.values(result.rows[0] as Record<string, unknown>).join('') : '';
      },
      queryMany: async (sql: string, params?: readonly unknown[]): Promise<string[]> => {
        const result = await client.query(sql, params as unknown[]);
        return result.rows.map((r: Record<string, unknown>) => Object.values(r).join(''));
      },
      exec: async (sql: string, params?: readonly unknown[]): Promise<void> => {
        await client.query(sql, params as unknown[]);
      },
    };

    const result = await work(deps);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function resolveTenantId(telegramUserId: number): Promise<string | null> {
  if (!pgPool) return null;

  const result = await query(pgPool, `
    SELECT tenant_id::text
    FROM resolve_membership_by_platform_user_id($1)
    LIMIT 1;
  `, [String(telegramUserId)]);

  const row = result.rows[0];
  return row ? String(row.tenant_id) : null;
}

const server = createServer(async (req, res) => {
  const headers = req.headers ?? {};
  const url = new URL(req.url ?? '/', `http://${headers.host ?? 'localhost'}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
      'access-control-allow-headers': 'Content-Type, X-Telegram-Init-Data',
      'access-control-max-age': '86400',
    });
    res.end();
    return;
  }

  // Health check
  if (url.pathname === '/healthz' && req.method === 'GET') {
    respondJson(res, 200, { status: 'ok', service: 'miniapp' });
    return;
  }

  // API routes
  if (url.pathname.startsWith('/api/')) {
    // Auth: validate Telegram initData from header
    const initData = headers['x-telegram-init-data'] as string | undefined;
    if (!initData) {
      respondJson(res, 401, { error: 'missing_init_data' });
      return;
    }

    const authResult = validateInitData(initData, botToken);
    if (!authResult.ok) {
      respondJson(res, 401, { error: authResult.error });
      return;
    }

    const tenantId = await resolveTenantId(authResult.user.id);
    if (!tenantId) {
      respondJson(res, 403, { error: 'no_tenant' });
      return;
    }

    try {
      await handleApiRoute(req, res, url, tenantId, String(authResult.user.id));
    } catch (err) {
      logger.error('miniapp_api_error', { error: (err as Error).message, path: url.pathname });
      respondJson(res, 500, { error: 'internal_error' });
    }
    return;
  }

  // Static files
  if (req.method === 'GET') {
    const served = await serveStatic(res, url.pathname);
    if (served) return;
  }

  respondJson(res, 404, { error: 'not_found' });
});

async function handleApiRoute(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  url: URL,
  tenantId: string,
  userId: string
) {
  // GET /api/invoices/:id
  const invoiceMatch = url.pathname.match(/^\/api\/invoices\/([0-9a-f-]{36})$/);
  if (invoiceMatch && req.method === 'GET') {
    const invoiceId = invoiceMatch[1]!;
    const data = await runTenantScopedQuery(tenantId, (deps) => getInvoice(deps, invoiceId));
    if (!data) {
      respondJson(res, 404, { error: 'invoice_not_found' });
      return;
    }
    respondJson(res, 200, data);
    return;
  }

  // POST /api/invoices/:invoiceId/items/:itemId/action
  const actionMatch = url.pathname.match(/^\/api\/invoices\/([0-9a-f-]{36})\/items\/([0-9a-f-]{36})\/action$/);
  if (actionMatch && req.method === 'POST') {
    const invoiceId = actionMatch[1]!;
    const itemId = actionMatch[2]!;

    let body: Record<string, unknown>;
    try {
      body = await parseJsonBody(req);
    } catch {
      respondJson(res, 400, { error: 'invalid_json' });
      return;
    }

    const action = String(body.action ?? '');
    const sku = body.sku ? String(body.sku) : undefined;

    const result = await runTenantScopedQuery(tenantId, (deps) =>
      processItemAction(deps, tenantId, invoiceId, itemId, action, sku, userId)
    );

    if (!result.ok) {
      respondJson(res, result.status ?? 400, { error: result.error });
      return;
    }

    // Enqueue KIOTVIET_SYNC outside the DB transaction
    let syncTriggered = false;
    if (result.sync_triggered && queue) {
      try {
        await queue.add('KIOTVIET_SYNC', {
          job_type: 'KIOTVIET_SYNC',
          tenant_id: tenantId,
          canonical_invoice_id: invoiceId,
        });
        syncTriggered = true;
      } catch (err) {
        logger.warn('miniapp_sync_enqueue_failed', { error: (err as Error).message, invoiceId });
      }
    }

    respondJson(res, 200, {
      ok: true,
      remaining: result.remaining,
      sync_triggered: syncTriggered
    });
    return;
  }

  // PUT /api/invoices/:invoiceId/items/:itemId/sell-price
  const priceMatch = url.pathname.match(/^\/api\/invoices\/([0-9a-f-]{36})\/items\/([0-9a-f-]{36})\/sell-price$/);
  if (priceMatch && req.method === 'PUT') {
    const itemId = priceMatch[2]!;

    let body: Record<string, unknown>;
    try {
      body = await parseJsonBody(req);
    } catch {
      respondJson(res, 400, { error: 'invalid_json' });
      return;
    }

    const sellPrice = Number(body.sell_price);
    if (isNaN(sellPrice) || sellPrice < 0 || sellPrice > 999_999_999) {
      respondJson(res, 400, { error: 'invalid_price' });
      return;
    }

    const updated = await runTenantScopedQuery(tenantId, async (deps) => {
      const row = await deps.queryOne(`
        UPDATE resolved_invoice_items
        SET sell_price = $1
        WHERE canonical_item_id = $2::uuid
          AND tenant_id = $3::uuid
          AND status = 'resolved'
        RETURNING sell_price::text;
      `, [sellPrice, itemId, tenantId]);
      return row.trim();
    });

    if (!updated) {
      respondJson(res, 404, { error: 'item_not_found' });
      return;
    }

    respondJson(res, 200, { ok: true, sell_price: Number(updated) });
    return;
  }

  // GET /api/products/search?q=...&limit=...
  if (url.pathname === '/api/products/search' && req.method === 'GET') {
    const q = url.searchParams.get('q') ?? '';
    const limit = Number(url.searchParams.get('limit') ?? '10');

    if (q.trim().length < 2) {
      respondJson(res, 400, { error: 'query_too_short' });
      return;
    }

    const results = await runTenantScopedQuery(tenantId, (deps) =>
      searchProducts(deps, q, limit)
    );

    respondJson(res, 200, { results });
    return;
  }

  // POST /api/invoices/:invoiceId/submit
  const submitMatch = url.pathname.match(/^\/api\/invoices\/([0-9a-f-]{36})\/submit$/);
  if (submitMatch && req.method === 'POST') {
    const invoiceId = submitMatch[1]!;

    const counts = await runTenantScopedQuery(tenantId, async (deps) => {
      const row = await deps.queryOne(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending_confirmation')::text || ',' ||
          COUNT(*) FILTER (WHERE status = 'unresolved')::text || ',' ||
          COUNT(*) FILTER (WHERE status = 'resolved')::text || ',' ||
          COUNT(*) FILTER (WHERE status = 'skipped')::text
        FROM resolved_invoice_items
        WHERE canonical_invoice_id = $1::uuid
          AND tenant_id = $2::uuid;
      `, [invoiceId, tenantId]);
      return row.trim();
    });

    const [pendingStr, unresolvedStr, resolvedStr, skippedStr] = counts.split(',');
    const pending = Number(pendingStr);
    const unresolved = Number(unresolvedStr);
    const resolved = Number(resolvedStr);
    const skipped = Number(skippedStr);

    if (pending > 0 || unresolved > 0) {
      respondJson(res, 400, { error: pending > 0 ? 'has_pending_items' : 'has_unresolved_items' });
      return;
    }

    if (resolved === 0) {
      respondJson(res, 400, { error: 'no_resolved_items' });
      return;
    }

    let syncEnqueued = false;
    if (queue) {
      try {
        await queue.add('KIOTVIET_SYNC', {
          job_type: 'KIOTVIET_SYNC',
          tenant_id: tenantId,
          canonical_invoice_id: invoiceId,
        });
        syncEnqueued = true;
      } catch (err) {
        logger.warn('miniapp_submit_enqueue_failed', { error: (err as Error).message, invoiceId });
      }
    }

    respondJson(res, 200, { ok: true, resolved, skipped, sync_enqueued: syncEnqueued });
    return;
  }

  // GET /api/products/barcode/:code
  const barcodeMatch = url.pathname.match(/^\/api\/products\/barcode\/([^\s/]+)$/);
  if (barcodeMatch && req.method === 'GET') {
    const barcode = decodeURIComponent(barcodeMatch[1]!);

    const product = await runTenantScopedQuery(tenantId, (deps) =>
      findByBarcode(deps, barcode)
    );

    if (!product) {
      respondJson(res, 404, { error: 'product_not_found' });
      return;
    }

    respondJson(res, 200, product);
    return;
  }

  respondJson(res, 404, { error: 'not_found' });
}

// Initialize services then start server
initServices()
  .then(() => {
    server.listen(port, host, () => {
      logger.info('miniapp_started', { host, port });
    });
  })
  .catch((err) => {
    logger.error('miniapp_init_failed', { error: (err as Error).message });
  });
