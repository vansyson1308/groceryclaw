export interface SafeFetchConfig {
  readonly allowedDomains: readonly string[];
  readonly allowHttpDomains?: readonly string[];
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

export interface SafeFetchResult {
  readonly contentType: string;
  readonly body: Buffer;
}

function isIpHost(hostname: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
}

function isPrivateIPv4(hostname: string): boolean {
  if (!isIpHost(hostname)) return false;
  const parts = hostname.split('.').map((x) => Number(x));
  const a = parts[0] ?? -1;
  const b = parts[1] ?? -1;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function validateSafeAttachmentUrl(
  input: string,
  allowedDomains: readonly string[],
  allowHttpDomains: readonly string[] = []
): { ok: true; url: URL } | { ok: false } {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false };
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return { ok: false };
  if (isPrivateIPv4(host)) return { ok: false };

  const allowed = allowedDomains.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (!allowed) return { ok: false };

  const allowHttp = allowHttpDomains.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (parsed.protocol === 'https:') {
    if (parsed.port && parsed.port !== '443') return { ok: false };
  } else if (parsed.protocol === 'http:') {
    if (!allowHttp) return { ok: false };
  } else {
    return { ok: false };
  }

  return { ok: true, url: parsed };
}

export async function fetchUrlSafely(
  url: string,
  config: SafeFetchConfig,
  fetchImpl: typeof fetch = fetch
): Promise<SafeFetchResult> {
  const validated = validateSafeAttachmentUrl(url, config.allowedDomains, config.allowHttpDomains ?? []);
  if (!validated.ok) {
    throw new Error('unsafe_url');
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), config.timeoutMs);

  try {
    const response = await fetchImpl(validated.url.toString(), {
      method: 'GET',
      redirect: 'error',
      signal: ac.signal
    });

    if (!response.ok) throw new Error('fetch_failed');

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('xml') && !contentType.includes('text/plain') && contentType !== '') {
      throw new Error('invalid_content_type');
    }

    const text = await response.text();
    const body = Buffer.from(text, 'utf8');
    if (body.length > config.maxBytes) {
      throw new Error('payload_too_large');
    }

    return { contentType, body };
  } finally {
    clearTimeout(timer);
  }
}
