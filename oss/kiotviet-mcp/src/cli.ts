#!/usr/bin/env node
// kiotviet-mcp CLI.
//   kiotviet-mcp                 stdio transport (Claude Desktop, IDEs, local agents)
//   kiotviet-mcp --http 8787     Streamable HTTP on 127.0.0.1:8787/mcp (bearer KIOTVIET_MCP_TOKEN required)
//   kiotviet-mcp --demo          built-in demo shop, no KiotViet credentials needed (or KIOTVIET_MCP_DEMO=1)
//   kiotviet-mcp --read-only     never registers the purchase-order tools
// Env: KIOTVIET_CLIENT_ID, KIOTVIET_CLIENT_SECRET, KIOTVIET_RETAILER, KIOTVIET_BRANCH_ID, SHOP_NAME, SHOP_TIMEZONE
import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { KiotVietClient } from './kiotviet-client.js';
import { DemoSource, KiotVietSource } from './source.js';
import type { ShopSource } from './source.js';
import { createKiotVietMcpServer } from './server.js';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

function buildSource(): ShopSource {
  if (flag('--demo') || process.env.KIOTVIET_MCP_DEMO === '1') return new DemoSource();
  const { KIOTVIET_CLIENT_ID: clientId, KIOTVIET_CLIENT_SECRET: clientSecret, KIOTVIET_RETAILER: retailer } = process.env;
  if (!clientId || !clientSecret || !retailer) {
    console.error('Set KIOTVIET_CLIENT_ID, KIOTVIET_CLIENT_SECRET and KIOTVIET_RETAILER (or use --demo).');
    process.exit(1);
  }
  const branchId = process.env.KIOTVIET_BRANCH_ID ? Number(process.env.KIOTVIET_BRANCH_ID) : undefined;
  const client = new KiotVietClient({ clientId, clientSecret, retailer, ...(branchId ? { branchId } : {}) });
  return new KiotVietSource(client, process.env.SHOP_NAME ?? retailer, process.env.SHOP_TIMEZONE ?? 'Asia/Ho_Chi_Minh', 'VND', 60, flag('--read-only'));
}

async function main(): Promise<void> {
  const source = buildSource();
  const port = value('--http');
  if (!port) {
    await createKiotVietMcpServer(source).connect(new StdioServerTransport());
    return;
  }

  const token = process.env.KIOTVIET_MCP_TOKEN ?? '';
  if (token.length < 24) {
    console.error('Set KIOTVIET_MCP_TOKEN (>= 24 chars) to serve over HTTP.');
    process.exit(1);
  }
  const expected = createHash('sha256').update(token).digest();
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    // DNS-rebinding protection: only loopback browser origins (or none).
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.writeHead(403).end();
      return;
    }
    const given = createHash('sha256').update(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '').digest();
    if (!timingSafeEqual(given, expected)) {
      res.writeHead(401, { 'www-authenticate': 'Bearer realm="kiotviet-mcp"' }).end();
      return;
    }
    const sid = req.headers['mcp-session-id'];
    const existing = typeof sid === 'string' ? sessions.get(sid) : undefined;
    if (existing) {
      await existing.handleRequest(req, res);
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (!isInitializeRequest(body)) {
      res.writeHead(400).end();
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => { sessions.set(id, transport); }
    });
    transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
    await createKiotVietMcpServer(source).connect(transport as unknown as Transport);
    await transport.handleRequest(req, res, body);
  }).listen(Number(port), '127.0.0.1', () => {
    console.error(`kiotviet-mcp listening on http://127.0.0.1:${port}/mcp`);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
