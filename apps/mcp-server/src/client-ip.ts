import type { IncomingMessage } from 'node:http';

type IpSource = Pick<IncomingMessage, 'headers'> & { socket: { remoteAddress?: string | undefined } };

/**
 * Client address for rate limiting behind `trustProxy` trusted proxies. Each
 * proxy appends the address it received the request from to X-Forwarded-For,
 * so only the last N entries are trustworthy and the viewer is the Nth entry
 * from the right (CloudFront: 1, Render: 2). Earlier entries are whatever the
 * viewer sent and are never used. `true` means 1 hop, `false`/0 the socket.
 */
export function clientIpFrom(req: IpSource, trustProxy: boolean | number): string {
  const hops = trustProxy === true ? 1 : trustProxy === false ? 0 : trustProxy;
  if (hops > 0) {
    const raw = req.headers['x-forwarded-for'];
    const value = Array.isArray(raw) ? raw.join(',') : raw;
    const entries = (value ?? '').split(',').map((part) => part.trim()).filter(Boolean);
    if (entries.length > 0) return entries[Math.max(0, entries.length - hops)] as string;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** MCP_TRUST_PROXY: "true" = 1 hop, "false"/empty = 0, or a hop count (max 10). */
export function parseTrustProxy(value: string | undefined): number {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '' || v === 'false' || v === '0') return 0;
  if (v === 'true') return 1;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 0;
}
