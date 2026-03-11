import { createHmac, timingSafeEqual } from 'node:crypto';

export type WebhookVerifyMode = 'mode1' | 'mode2';

export interface WebhookAuthConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly verifyMode: WebhookVerifyMode;
  readonly mode2AllowInProduction: boolean;
  readonly signatureSecret: string;
  readonly signatureHeaders: readonly string[];
  readonly signatureAlgorithm: 'sha256' | 'sha512';
  readonly mode2TokenHeader: string;
  readonly mode2Token: string;
  readonly mode2IpAllowlist: readonly string[];
  readonly mode2GlobalRateLimitPerMinute: number;
  readonly mode2PerIpRateLimitPerMinute: number;
  readonly mode2PerPlatformUserRateLimitPerMinute: number;
  readonly mode2AttachmentAllowlist: readonly string[];
  readonly enforceTimestamp: boolean;
  readonly timestampHeader: string;
  readonly timestampMaxDriftSeconds: number;
}

export interface WebhookAuthRequest {
  readonly headers: Record<string, string | undefined>;
  readonly sourceIp?: string;
}

export interface WebhookAuthResult {
  readonly ok: boolean;
  readonly statusCode: 200 | 401 | 403 | 429;
  readonly reason: 'verified' | 'unauthorized' | 'forbidden' | 'rate_limited';
}

interface Bucket {
  count: number;
  resetAt: number;
}

const globalBuckets = new Map<string, Bucket>();
const ipBuckets = new Map<string, Bucket>();
const platformUserBuckets = new Map<string, Bucket>();

function normalizeHeaderMap(headers: Record<string, string | undefined>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized[key.toLowerCase()] = value;
    }
  }
  return normalized;
}

function safeEqualUtf8(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function safeEqualHex(expectedHex: string, providedHex: string): boolean {
  const exp = Buffer.from(expectedHex, 'hex');
  const got = Buffer.from(providedHex, 'hex');
  if (exp.length !== got.length) {
    return false;
  }
  return timingSafeEqual(exp, got);
}

function parseSignature(headerValue: string): { kind: 'hex' | 'base64'; value: string } | null {
  const trimmed = headerValue.trim();
  const noPrefix = trimmed.startsWith('sha256=') ? trimmed.slice('sha256='.length) : trimmed;

  if (/^[0-9a-fA-F]+$/.test(noPrefix) && noPrefix.length % 2 === 0) {
    return { kind: 'hex', value: noPrefix.toLowerCase() };
  }

  if (/^[A-Za-z0-9+/]+=*$/.test(noPrefix)) {
    return { kind: 'base64', value: noPrefix };
  }

  return null;
}

function consumeBucket(store: Map<string, Bucket>, key: string, maxPerMinute: number, nowMs: number): boolean {
  const existing = store.get(key);
  if (!existing || nowMs >= existing.resetAt) {
    store.set(key, { count: 1, resetAt: nowMs + 60_000 });
    return true;
  }
  existing.count += 1;
  return existing.count <= maxPerMinute;
}

function isDisallowedPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '::1') return true;
  if (/^127\./.test(lower) || /^10\./.test(lower) || /^192\.168\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(lower)) return true;
  if (/^169\.254\./.test(lower)) return true;
  return false;
}

function attachmentUrlsAreAllowed(rawBody: Buffer, allowlist: readonly string[]): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return false;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }

  const root = payload as { attachments?: unknown };
  const attachments = Array.isArray(root.attachments) ? root.attachments : [];

  for (const item of attachments) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const urlValue = (item as { url?: unknown }).url;
    if (typeof urlValue !== 'string' || urlValue.length === 0) {
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(urlValue);
    } catch {
      return false;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    if (isDisallowedPrivateHost(parsed.hostname)) {
      return false;
    }

    const host = parsed.hostname.toLowerCase();
    const allowed = allowlist.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
    if (!allowed) {
      return false;
    }
  }

  return true;
}

function parsePlatformUserId(rawBody: Buffer): string | null {
  try {
    const parsed = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    const candidate = parsed.platform_user_id ?? parsed.user_id ?? parsed.from_uid;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
  } catch {
    return null;
  }
}

export function verifyWebhookRequest(config: WebhookAuthConfig, request: WebhookAuthRequest, rawBody: Buffer): WebhookAuthResult {
  const headers = normalizeHeaderMap(request.headers);

  if (config.verifyMode === 'mode1') {
    const signatureHeader = config.signatureHeaders
      .map((name) => headers[name.toLowerCase()])
      .find((value): value is string => typeof value === 'string' && value.length > 0);

    if (!signatureHeader || !config.signatureSecret) {
      return { ok: false, statusCode: 401, reason: 'unauthorized' };
    }

    const parsed = parseSignature(signatureHeader);
    if (!parsed) {
      return { ok: false, statusCode: 401, reason: 'unauthorized' };
    }

    const hmac = createHmac(config.signatureAlgorithm, config.signatureSecret).update(rawBody);
    const expectedHex = hmac.digest('hex');

    const matches = parsed.kind === 'hex'
      ? safeEqualHex(expectedHex, parsed.value)
      : safeEqualUtf8(Buffer.from(expectedHex, 'hex').toString('base64'), parsed.value);

    if (!matches) {
      return { ok: false, statusCode: 401, reason: 'unauthorized' };
    }

    if (config.enforceTimestamp) {
      const timestampRaw = headers[config.timestampHeader.toLowerCase()];
      const timestamp = Number(timestampRaw);
      if (!timestampRaw || !Number.isFinite(timestamp)) {
        return { ok: false, statusCode: 401, reason: 'unauthorized' };
      }
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (Math.abs(nowSeconds - timestamp) > config.timestampMaxDriftSeconds) {
        return { ok: false, statusCode: 401, reason: 'unauthorized' };
      }
    }

    return { ok: true, statusCode: 200, reason: 'verified' };
  }

  if (config.nodeEnv === 'production' && !config.mode2AllowInProduction) {
    return { ok: false, statusCode: 403, reason: 'forbidden' };
  }

  if (!config.mode2Token) {
    return { ok: false, statusCode: 403, reason: 'forbidden' };
  }

  const providedToken = headers[config.mode2TokenHeader.toLowerCase()] ?? '';
  if (!safeEqualUtf8(config.mode2Token, providedToken)) {
    return { ok: false, statusCode: 403, reason: 'forbidden' };
  }

  const sourceIp = request.sourceIp ?? '';
  if (config.mode2IpAllowlist.length > 0 && !config.mode2IpAllowlist.includes(sourceIp)) {
    return { ok: false, statusCode: 403, reason: 'forbidden' };
  }

  if (!attachmentUrlsAreAllowed(rawBody, config.mode2AttachmentAllowlist)) {
    return { ok: false, statusCode: 403, reason: 'forbidden' };
  }

  const platformUserId = parsePlatformUserId(rawBody) ?? 'unknown';
  const nowMs = Date.now();
  if (!consumeBucket(globalBuckets, 'global', config.mode2GlobalRateLimitPerMinute, nowMs)) {
    return { ok: false, statusCode: 429, reason: 'rate_limited' };
  }
  if (!consumeBucket(ipBuckets, sourceIp || 'unknown', config.mode2PerIpRateLimitPerMinute, nowMs)) {
    return { ok: false, statusCode: 429, reason: 'rate_limited' };
  }
  if (!consumeBucket(platformUserBuckets, platformUserId, config.mode2PerPlatformUserRateLimitPerMinute, nowMs)) {
    return { ok: false, statusCode: 429, reason: 'rate_limited' };
  }

  return { ok: true, statusCode: 200, reason: 'verified' };
}
