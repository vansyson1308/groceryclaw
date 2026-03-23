export type ZaloSendErrorKind = 'RETRIABLE' | 'TERMINAL';

export class ZaloSendError extends Error {
  constructor(
    readonly kind: ZaloSendErrorKind,
    readonly code: string,
    readonly retryAfterMs?: number
  ) {
    super(code);
  }
}

export interface ZaloOutboundAdapter {
  sendText: (platformUserId: string, text: string, options?: { correlation_id?: string }) => Promise<{ message_id: string }>;
}

export class HttpStubZaloAdapter implements ZaloOutboundAdapter {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly timeoutMs: number) {}

  async sendText(platformUserId: string, text: string, options?: { correlation_id?: string }): Promise<{ message_id: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/zalo/send`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`
        },
        body: JSON.stringify({ platform_user_id: platformUserId, text, correlation_id: options?.correlation_id ?? null }),
        signal: controller.signal
      });

      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          const retryAfterHeader = res.headers.get('retry-after');
          const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
          throw new ZaloSendError('RETRIABLE', `zalo_http_${res.status}`, retryAfterMs);
        }
        throw new ZaloSendError('TERMINAL', `zalo_http_${res.status}`);
      }

      const parsed = await res.json() as { message_id?: string };
      if (!parsed.message_id) {
        throw new ZaloSendError('RETRIABLE', 'zalo_invalid_response');
      }
      return { message_id: parsed.message_id };
    } catch (error) {
      if (error instanceof ZaloSendError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ZaloSendError('RETRIABLE', 'zalo_timeout');
      }
      throw new ZaloSendError('RETRIABLE', 'zalo_transport_error');
    } finally {
      clearTimeout(timer);
    }
  }
}

export class HttpZaloOAAdapter implements ZaloOutboundAdapter {
  constructor(private readonly accessToken: string, private readonly timeoutMs: number) {}

  async sendText(platformUserId: string, text: string, options?: { correlation_id?: string }): Promise<{ message_id: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch('https://openapi.zalo.me/v3.0/oa/message/cs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'access_token': this.accessToken
        },
        body: JSON.stringify({
          recipient: { user_id: platformUserId },
          message: { text }
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          const retryAfterHeader = res.headers.get('retry-after');
          const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
          throw new ZaloSendError('RETRIABLE', `zalo_http_${res.status}`, retryAfterMs);
        }
        throw new ZaloSendError('TERMINAL', `zalo_http_${res.status}`);
      }

      const parsed = await res.json() as { error?: number; message?: string; data?: { message_id?: string } };
      if (parsed.error && parsed.error !== 0) {
        const code = `zalo_api_error:${parsed.error}:${parsed.message ?? 'unknown'}`;
        if (parsed.error === -216 || parsed.error === -230) {
          throw new ZaloSendError('RETRIABLE', code);
        }
        throw new ZaloSendError('TERMINAL', code);
      }

      const messageId = parsed.data?.message_id ?? `zalo-${Date.now()}`;
      return { message_id: messageId };
    } catch (error) {
      if (error instanceof ZaloSendError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ZaloSendError('RETRIABLE', 'zalo_timeout');
      }
      throw new ZaloSendError('RETRIABLE', 'zalo_transport_error');
    } finally {
      clearTimeout(timer);
    }
  }
}

export class InMemoryStubZaloAdapter implements ZaloOutboundAdapter {
  readonly sent: Array<{ platform_user_id: string; text: string; correlation_id?: string }> = [];

  async sendText(platformUserId: string, text: string, options?: { correlation_id?: string }): Promise<{ message_id: string }> {
    this.sent.push({ platform_user_id: platformUserId, text, ...(options?.correlation_id ? { correlation_id: options.correlation_id } : {}) });
    return { message_id: `stub-${this.sent.length}` };
  }
}
