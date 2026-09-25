/**
 * Streamable HTTP server on plain `node:http` (no Express/Hono) showing the
 * two checks every remote MCP server needs before handing a request to the
 * transport:
 *
 *  1. Origin validation (DNS-rebinding protection, required by the spec for
 *     Streamable HTTP). Requests without an Origin header (server-to-server
 *     clients) are allowed; browser origins must be on an allow-list.
 *  2. Bearer authentication, with each session bound to the principal that
 *     created it, so another caller's token cannot reuse the session id.
 *
 * Run:  MCP_TOKENS="alice:token-a,bob:token-b" npx tsx src/examples/server/nodeHttpAuthStreamableHttp.ts
 * Test: npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http \
 *         --header "Authorization: Bearer token-a" --method tools/call --tool-name whoami
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '../../server/mcp.js';
import { StreamableHTTPServerTransport } from '../../server/streamableHttp.js';
import { isInitializeRequest } from '../../types.js';

const PORT = Number(process.env.PORT ?? 3000);
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS ?? 'http://localhost:6274').split(',').map((o) => o.trim()));

// principal -> sha256(token). Compare digests in constant time; never log tokens.
const digest = (value: string) => createHash('sha256').update(value).digest();
const TOKENS = new Map(
  (process.env.MCP_TOKENS ?? 'demo:change-me-please')
    .split(',')
    .map((pair) => pair.split(':') as [string, string])
    .map(([principal, token]) => [principal, digest(token)] as const)
);

function authenticate(req: IncomingMessage): string | null {
  const token = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1];
  if (!token) return null;
  const given = digest(token);
  for (const [principal, expected] of TOKENS) if (timingSafeEqual(given, expected)) return principal;
  return null;
}

function reject(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function buildServer(principal: string): McpServer {
  const server = new McpServer({ name: 'node-http-auth-example', version: '1.0.0' });
  server.registerTool('whoami', {
    description: 'Returns the authenticated principal bound to this session.',
    outputSchema: { principal: z.string() }
  }, async () => ({
    content: [{ type: 'text', text: `You are ${principal}.` }],
    structuredContent: { principal }
  }));
  return server;
}

const sessions = new Map<string, { transport: StreamableHTTPServerTransport; principal: string }>();

createServer(async (req, res) => {
  if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/mcp') return reject(res, 404, 'Not found');

  // 1) Origin validation before anything else.
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reject(res, 403, 'Forbidden origin');

  // 2) Authentication.
  const principal = authenticate(req);
  if (!principal) return reject(res, 401, 'Unauthorized', { 'www-authenticate': 'Bearer realm="mcp"' });

  const sessionId = req.headers['mcp-session-id'];
  if (typeof sessionId === 'string') {
    const session = sessions.get(sessionId);
    // Same answer for "unknown" and "someone else's" session: no oracle.
    if (!session || session.principal !== principal) return reject(res, 404, 'Session not found');
    return session.transport.handleRequest(req, res);
  }

  if (req.method !== 'POST') return reject(res, 400, 'Mcp-Session-Id header is required');
  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    return reject(res, 400, 'Parse error');
  }
  if (!isInitializeRequest(body)) return reject(res, 400, 'No valid session ID provided');

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { transport, principal });
    }
  });
  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };
  await buildServer(principal).connect(transport);
  await transport.handleRequest(req, res, body);
}).listen(PORT, () => {
  console.log(`MCP Streamable HTTP server on http://localhost:${PORT}/mcp`);
});
