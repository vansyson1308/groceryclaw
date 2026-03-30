import { createHmac } from 'node:crypto';

export interface TelegramUser {
  readonly id: number;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
}

export interface AuthResult {
  readonly ok: true;
  readonly user: TelegramUser;
}

export interface AuthError {
  readonly ok: false;
  readonly error: string;
}

/**
 * Validate Telegram Mini App initData using HMAC-SHA256.
 * See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 7200
): AuthResult | AuthError {
  if (!initData || !botToken) {
    return { ok: false, error: 'missing_init_data' };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    return { ok: false, error: 'missing_hash' };
  }

  // Build data-check-string: sort params alphabetically, exclude hash
  params.delete('hash');
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  // HMAC validation: secret = HMAC_SHA256("WebAppData", botToken)
  const secretKeyHex = createHmac('sha256', 'WebAppData').update(botToken).digest('hex');
  const secretKey = Buffer.from(secretKeyHex, 'hex') as unknown as string;
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) {
    return { ok: false, error: 'invalid_hash' };
  }

  // Check auth_date expiry
  const authDate = Number(params.get('auth_date') ?? '0');
  if (authDate > 0 && maxAgeSeconds > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > maxAgeSeconds) {
      return { ok: false, error: 'expired' };
    }
  }

  // Parse user
  const userStr = params.get('user');
  if (!userStr) {
    return { ok: false, error: 'missing_user' };
  }

  try {
    const user = JSON.parse(userStr) as TelegramUser;
    if (!user.id || typeof user.id !== 'number') {
      return { ok: false, error: 'invalid_user' };
    }
    return { ok: true, user };
  } catch {
    return { ok: false, error: 'invalid_user_json' };
  }
}
