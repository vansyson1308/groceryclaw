import { createPublicKey, createVerify, timingSafeEqual } from 'node:crypto';

export type AdminRole = 'admin' | 'ops' | 'read_only';

export interface OidcConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri: string;
  readonly rolesClaim: string;
}

export interface BreakglassConfig {
  readonly enabled: boolean;
  readonly apiKey: string;
  readonly scope: AdminRole;
}

export interface AdminAuthConfig {
  readonly enabled: boolean;
  readonly oidc: OidcConfig;
  readonly breakglass: BreakglassConfig;
}

export interface AuthenticatedPrincipal {
  readonly authMode: 'oidc' | 'break_glass';
  readonly subject: string;
  readonly role: AdminRole;
}

type Jwk = {
  readonly kid?: string;
  readonly kty: string;
  readonly n?: string;
  readonly e?: string;
  readonly alg?: string;
};

let jwksCache: { fetchedAt: number; keys: Jwk[] } | null = null;

function b64urlDecode(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : normalized + '='.repeat(4 - padding);
  return Buffer.from(padded, 'base64');
}

function parseJson<T>(buf: Buffer): T {
  return JSON.parse(buf.toString('utf8')) as T;
}

function splitToken(token: string): { protectedHeader: Record<string, unknown>; payload: Record<string, unknown>; signingInput: string; signature: Buffer } {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('auth_invalid_token');
  }

  const headerB64 = parts[0] ?? '';
  const payloadB64 = parts[1] ?? '';
  const signatureB64 = parts[2] ?? '';
  return {
    protectedHeader: parseJson<Record<string, unknown>>(b64urlDecode(headerB64)),
    payload: parseJson<Record<string, unknown>>(b64urlDecode(payloadB64)),
    signingInput: `${headerB64}.${payloadB64}`,
    signature: b64urlDecode(signatureB64)
  };
}

function toAdminRole(value: string): AdminRole | null {
  if (value === 'admin' || value === 'ops' || value === 'read_only') {
    return value;
  }
  return null;
}

function resolveRole(payload: Record<string, unknown>, claimPath: string): AdminRole | null {
  const segments = claimPath.split('.').filter(Boolean);
  let cursor: unknown = payload;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor) || !(segment in cursor)) {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  if (Array.isArray(cursor)) {
    for (const value of cursor) {
      if (typeof value === 'string') {
        const role = toAdminRole(value);
        if (role) return role;
      }
    }
    return null;
  }

  if (typeof cursor === 'string') {
    return toAdminRole(cursor);
  }

  return null;
}

function hasValidTimingSafeKey(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

async function fetchJwks(uri: string): Promise<Jwk[]> {
  const now = Date.now();
  if (jwksCache && (now - jwksCache.fetchedAt) < 5 * 60_000) {
    return jwksCache.keys;
  }

  const res = await fetch(uri, { method: 'GET' });
  if (!res.ok) {
    throw new Error('auth_jwks_fetch_failed');
  }
  const body = await res.json() as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = { fetchedAt: now, keys };
  return keys;
}

function verifyJwtSignature(signingInput: string, signature: Buffer, key: Jwk): boolean {
  const verifier = createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();
  const publicKey = createPublicKey({ key, format: 'jwk' });
  return verifier.verify(publicKey, signature);
}

function assertStandardClaims(payload: Record<string, unknown>, cfg: OidcConfig): void {
  const iss = typeof payload.iss === 'string' ? payload.iss : null;
  const aud = payload.aud;
  const exp = typeof payload.exp === 'number' ? payload.exp : null;
  const nbf = typeof payload.nbf === 'number' ? payload.nbf : null;
  const nowSeconds = Math.floor(Date.now() / 1000);

  const audOk = typeof aud === 'string'
    ? aud === cfg.audience
    : Array.isArray(aud) && aud.includes(cfg.audience);

  if (iss !== cfg.issuer || !audOk || !exp || exp <= nowSeconds || (nbf !== null && nbf > nowSeconds)) {
    throw new Error('auth_claims_invalid');
  }
}

export function loadAdminAuthConfig(env: Record<string, string | undefined>): AdminAuthConfig {
  const enabled = (env.ADMIN_ENABLED ?? 'true') === 'true';
  const issuer = env.ADMIN_OIDC_ISSUER ?? '';
  const audience = env.ADMIN_OIDC_AUDIENCE ?? '';
  const jwksUri = env.ADMIN_OIDC_JWKS_URI ?? '';

  if (enabled && (!issuer || !audience || !jwksUri)) {
    throw new Error('admin_auth_config_invalid');
  }

  const breakglassEnabled = (env.ADMIN_BREAKGLASS_ENABLED ?? 'false') === 'true';
  const breakglassScope = toAdminRole(env.ADMIN_BREAKGLASS_SCOPE ?? 'read_only') ?? 'read_only';

  if (breakglassEnabled && !(env.ADMIN_BREAKGLASS_API_KEY ?? '').trim()) {
    throw new Error('admin_breakglass_config_invalid');
  }

  return {
    enabled,
    oidc: {
      issuer,
      audience,
      jwksUri,
      rolesClaim: env.ADMIN_OIDC_ROLES_CLAIM ?? 'roles'
    },
    breakglass: {
      enabled: breakglassEnabled,
      apiKey: env.ADMIN_BREAKGLASS_API_KEY ?? '',
      scope: breakglassScope
    }
  };
}

export async function authenticateRequest(
  config: AdminAuthConfig,
  headers: Record<string, string | undefined>
): Promise<AuthenticatedPrincipal | null> {
  if (!config.enabled) {
    return { authMode: 'break_glass', subject: 'admin_disabled', role: 'admin' };
  }

  const breakglassHeader = headers['x-admin-api-key'];
  if (config.breakglass.enabled && breakglassHeader && hasValidTimingSafeKey(config.breakglass.apiKey, breakglassHeader)) {
    return {
      authMode: 'break_glass',
      subject: 'break_glass',
      role: config.breakglass.scope
    };
  }

  const authorization = headers.authorization ?? '';
  const prefix = 'Bearer ';
  if (!authorization.startsWith(prefix)) {
    return null;
  }

  const token = authorization.slice(prefix.length).trim();
  const { protectedHeader, payload, signingInput, signature } = splitToken(token);

  if (protectedHeader.alg !== 'RS256') {
    return null;
  }

  const kid = typeof protectedHeader.kid === 'string' ? protectedHeader.kid : '';
  const keys = await fetchJwks(config.oidc.jwksUri);
  const key = keys.find((candidate) => candidate.kid === kid && candidate.kty === 'RSA');
  if (!key) {
    return null;
  }

  if (!verifyJwtSignature(signingInput, signature, key)) {
    return null;
  }

  assertStandardClaims(payload, config.oidc);

  const subject = typeof payload.sub === 'string' ? payload.sub : null;
  const role = resolveRole(payload, config.oidc.rolesClaim);
  if (!subject || !role) {
    return null;
  }

  return {
    authMode: 'oidc',
    subject,
    role
  };
}
