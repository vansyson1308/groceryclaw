import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { InMemoryTokenBucketRateLimiter } from '../../../packages/common/dist/index.js';
import type { Logger } from '../../../packages/common/dist/index.js';
import type { ShopStore } from './store.js';
import { createShopVoiceServer } from './mcp.js';
import type { McpServerConfig } from './config.js';

interface Session {
  readonly transport: StreamableHTTPServerTransport;
  readonly server: McpServer;
  readonly tenantId: string;
  lastSeenMs: number;
}

interface CachedToken {
  readonly tenantId: string | null;
  readonly expiresMs: number;
}

export interface McpHttpDeps {
  readonly store: ShopStore;
  readonly config: McpServerConfig;
  readonly logger: Logger;
  readonly now?: () => number;
}

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store'
};

export function hashBearerToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Origin validation (MCP Streamable HTTP security requirement against DNS
 * rebinding). Requests without an Origin header (server-to-server clients
 * such as Alexa+ or the Bedrock agent) are allowed; browser origins must be on
 * the allow-list, or be loopback when MCP_ALLOW_LOCALHOST_ORIGINS=true.
 */
export function isOriginAllowed(origin: string | undefined, allowList: readonly string[], allowLocalhost: boolean): boolean {
  if (!origin) return true;
  if (allowList.includes(origin)) return true;
  if (allowLocalhost) {
    try {
      const url = new URL(origin);
      return (url.protocol === 'http:' || url.protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    } catch {
      return false;
    }
  }
  return false;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = header(req, 'x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown';
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json', ...SECURITY_HEADERS, ...extra });
  res.end(JSON.stringify(body));
}

function jsonRpcError(res: ServerResponse, status: number, code: number, message: string, extra: Record<string, string> = {}): void {
  sendJson(res, status, { jsonrpc: '2.0', error: { code, message }, id: null }, extra);
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > maxBytes) throw new Error('body_too_large');
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) throw new Error('invalid_json');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('invalid_json');
  }
}

export interface McpHttpHandler {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  sessionCount(): number;
  sweepIdleSessions(): Promise<number>;
  close(): Promise<void>;
}

export function createMcpHttpHandler(deps: McpHttpDeps): McpHttpHandler {
  const { store, config, logger } = deps;
  const now = deps.now ?? Date.now;
  const sessions = new Map<string, Session>();
  const tokenCache = new Map<string, CachedToken>();
  const tenantLimiter = new InMemoryTokenBucketRateLimiter(config.rateLimitPerMinute, config.rateLimitPerMinute);
  const authFailLimiter = new InMemoryTokenBucketRateLimiter(config.authFailuresPerMinute, config.authFailuresPerMinute);

  async function resolveTenant(token: string): Promise<string | null> {
    const hash = hashBearerToken(token);
    const cached = tokenCache.get(hash);
    if (cached && cached.expiresMs > now()) return cached.tenantId;
    const resolved = await store.resolveTokenHash(hash);
    const tenantId = resolved?.tenantId ?? null;
    tokenCache.set(hash, { tenantId, expiresMs: now() + config.tokenCacheSeconds * 1000 });
    if (tokenCache.size > 10_000) tokenCache.clear();
    return tenantId;
  }

  function corsHeaders(origin: string | undefined): Record<string, string> {
    if (!origin) return {};
    return {
      'access-control-allow-origin': origin,
      vary: 'Origin',
      'access-control-allow-headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version, last-event-id',
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
      'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version'
    };
  }

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = header(req, 'origin');
    if (!isOriginAllowed(origin, config.allowedOrigins, config.allowLocalhostOrigins)) {
      logger.warn('mcp_origin_rejected', { origin });
      jsonRpcError(res, 403, -32000, 'Forbidden: origin not allowed');
      return;
    }
    const cors = corsHeaders(origin);
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const ip = clientIp(req, config.trustProxy);
    const auth = header(req, 'authorization') ?? '';
    const match = /^Bearer\s+([A-Za-z0-9._~+/=-]{16,256})$/i.exec(auth.trim());
    const tenantId = match?.[1] ? await resolveTenant(match[1]) : null;
    if (!tenantId) {
      if (!authFailLimiter.consume(ip).allowed) {
        jsonRpcError(res, 429, -32000, 'Too many requests', { 'retry-after': '60' });
        return;
      }
      jsonRpcError(res, 401, -32001, 'Unauthorized', {
        'www-authenticate': `Bearer realm="shopvoice", error="invalid_token"`
      });
      return;
    }

    if (!tenantLimiter.consume(tenantId).allowed) {
      logger.warn('mcp_rate_limited', { tenant_id: tenantId });
      jsonRpcError(res, 429, -32000, 'Too many requests', { 'retry-after': '10' });
      return;
    }

    const sessionId = header(req, 'mcp-session-id');
    if (sessionId) {
      const session = sessions.get(sessionId);
      // A session is bound to the tenant that created it; another tenant's
      // token gets the same answer as an unknown session.
      if (!session || session.tenantId !== tenantId) {
        jsonRpcError(res, 404, -32001, 'Session not found');
        return;
      }
      session.lastSeenMs = now();
      let body: unknown;
      if (req.method === 'POST') {
        try {
          body = await readJsonBody(req, config.maxBodyBytes);
        } catch (error) {
          const tooLarge = error instanceof Error && error.message === 'body_too_large';
          jsonRpcError(res, tooLarge ? 413 : 400, -32700, tooLarge ? 'Request body too large' : 'Parse error');
          return;
        }
      }
      await session.transport.handleRequest(req, res, body);
      return;
    }

    if (req.method !== 'POST') {
      jsonRpcError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req, config.maxBodyBytes);
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'body_too_large';
      jsonRpcError(res, tooLarge ? 413 : 400, -32700, tooLarge ? 'Request body too large' : 'Parse error');
      return;
    }
    if (!isInitializeRequest(body)) {
      jsonRpcError(res, 400, -32000, 'Bad Request: No valid session ID provided');
      return;
    }
    if (sessions.size >= config.maxSessions) {
      await sweepIdleSessions();
      if (sessions.size >= config.maxSessions) {
        jsonRpcError(res, 503, -32000, 'Server busy', { 'retry-after': '30' });
        return;
      }
    }

    const server = createShopVoiceServer({ store, tenantId, logger, confirmTtlSeconds: config.confirmTtlSeconds });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: config.jsonResponses,
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, server, tenantId, lastSeenMs: now() });
        logger.info('mcp_session_started', { tenant_id: tenantId, session_id: id });
      }
    });
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id && sessions.delete(id)) logger.info('mcp_session_closed', { session_id: id });
    };
    // The SDK's transport getters are not declared `| undefined`, which trips
    // exactOptionalPropertyTypes; the runtime contract is identical.
    await server.connect(transport as unknown as Transport);
    await transport.handleRequest(req, res, body);
  }

  async function sweepIdleSessions(): Promise<number> {
    const cutoff = now() - config.sessionIdleSeconds * 1000;
    let closed = 0;
    for (const [id, session] of sessions) {
      if (session.lastSeenMs < cutoff) {
        sessions.delete(id);
        await session.transport.close().catch(() => {});
        await session.server.close().catch(() => {});
        closed += 1;
      }
    }
    return closed;
  }

  return {
    async handle(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost');
      try {
        if (url.pathname === '/healthz' && req.method === 'GET') {
          sendJson(res, 200, { status: 'ok', service: 'mcp-server' });
          return;
        }
        if (url.pathname === '/readyz' && req.method === 'GET') {
          const ok = await store.ping();
          sendJson(res, ok ? 200 : 503, { status: ok ? 'ready' : 'not_ready', checks: { database: ok ? 'ok' : 'fail' } });
          return;
        }
        if (url.pathname === config.mcpPath) {
          await handleMcp(req, res);
          return;
        }
        sendJson(res, 404, { error: 'not_found' });
      } catch (error) {
        logger.error('mcp_http_error', { path: url.pathname, error: error instanceof Error ? error.message : 'unknown' });
        jsonRpcError(res, 500, -32603, 'Internal server error');
      }
    },
    sessionCount: () => sessions.size,
    sweepIdleSessions,
    async close() {
      for (const session of sessions.values()) {
        await session.transport.close().catch(() => {});
        await session.server.close().catch(() => {});
      }
      sessions.clear();
    }
  };
}
