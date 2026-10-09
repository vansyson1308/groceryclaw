import type { IncomingMessage } from 'node:http';

type IpSource = Pick<IncomingMessage, 'headers'> & { socket: { remoteAddress?: string | undefined } };

/**
 * Viewer address for per-IP rate limits behind `hops` trusted proxies. Each
 * proxy appends the address it received the request from to X-Forwarded-For,
 * so only the last `hops` entries are trustworthy and the viewer is the
 * `hops`-th entry from the right (Render: 2). Earlier entries are whatever the
 * viewer sent and are never used. With hops = 0 the socket address is used.
 */
export function clientIpFrom(req: IpSource, hops: number): string {
  if (hops > 0) {
    const raw = req.headers['x-forwarded-for'];
    const value = Array.isArray(raw) ? raw.join(',') : raw;
    const entries = (value ?? '').split(',').map((part) => part.trim()).filter(Boolean);
    if (entries.length > 0) return entries[Math.max(0, entries.length - hops)] as string;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** SIM_TRUST_PROXY: "true" = 1 hop, "false"/empty = 0, or a hop count. */
export function parseTrustProxy(value: string | undefined): number {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '' || v === 'false' || v === '0') return 0;
  if (v === 'true') return 1;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 0;
}
