export type TelegramSendErrorKind = 'RETRIABLE' | 'TERMINAL';

export class TelegramSendError extends Error {
  constructor(
    readonly kind: TelegramSendErrorKind,
    readonly code: string,
    readonly retryAfterMs?: number
  ) {
    super(code);
  }
}

export interface TelegramSendOptions {
  correlation_id?: string;
  reply_to_message_id?: number;
}

export interface TelegramOutboundAdapter {
  sendText: (chatId: number, text: string, options?: TelegramSendOptions) => Promise<{ message_id: string }>;
  sendMessageWithMarkup: (chatId: number, text: string, replyMarkup: Record<string, unknown>, options?: TelegramSendOptions) => Promise<{ message_id: string }>;
  downloadFile: (fileId: string) => Promise<Buffer>;
}

export class HttpTelegramBotAdapter implements TelegramOutboundAdapter {
  private readonly baseUrl: string;
  private readonly fileBaseUrl: string;
  private readonly timeoutMs: number;

  constructor(botToken: string, timeoutMs: number) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
    this.fileBaseUrl = `https://api.telegram.org/file/bot${botToken}`;
    this.timeoutMs = timeoutMs;
  }

  async sendText(chatId: number, text: string, options?: TelegramSendOptions): Promise<{ message_id: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          ...(options?.reply_to_message_id ? { reply_to_message_id: options.reply_to_message_id } : {})
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          const retryAfterHeader = res.headers.get('retry-after');
          const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
          throw new TelegramSendError('RETRIABLE', `telegram_http_${res.status}`, retryAfterMs);
        }
        throw new TelegramSendError('TERMINAL', `telegram_http_${res.status}`);
      }

      const parsed = await res.json() as { ok: boolean; result?: { message_id?: number }; description?: string };
      if (!parsed.ok) {
        throw new TelegramSendError('TERMINAL', `telegram_api_error: ${parsed.description ?? 'unknown'}`);
      }

      return { message_id: String(parsed.result?.message_id ?? `tg-${Date.now()}`) };
    } catch (error) {
      if (error instanceof TelegramSendError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TelegramSendError('RETRIABLE', 'telegram_timeout');
      }
      throw new TelegramSendError('RETRIABLE', 'telegram_transport_error');
    } finally {
      clearTimeout(timer);
    }
  }

  async sendMessageWithMarkup(chatId: number, text: string, replyMarkup: Record<string, unknown>, options?: TelegramSendOptions): Promise<{ message_id: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          reply_markup: replyMarkup,
          ...(options?.reply_to_message_id ? { reply_to_message_id: options.reply_to_message_id } : {})
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          const retryAfterHeader = res.headers.get('retry-after');
          const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
          throw new TelegramSendError('RETRIABLE', `telegram_http_${res.status}`, retryAfterMs);
        }
        throw new TelegramSendError('TERMINAL', `telegram_http_${res.status}`);
      }

      const parsed = await res.json() as { ok: boolean; result?: { message_id?: number }; description?: string };
      if (!parsed.ok) {
        throw new TelegramSendError('TERMINAL', `telegram_api_error: ${parsed.description ?? 'unknown'}`);
      }

      return { message_id: String(parsed.result?.message_id ?? `tg-${Date.now()}`) };
    } catch (error) {
      if (error instanceof TelegramSendError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TelegramSendError('RETRIABLE', 'telegram_timeout');
      }
      throw new TelegramSendError('RETRIABLE', 'telegram_transport_error');
    } finally {
      clearTimeout(timer);
    }
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const fileRes = await fetch(`${this.baseUrl}/getFile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file_id: fileId }),
        signal: controller.signal
      });

      const fileJson = await fileRes.json() as { ok: boolean; result?: { file_path?: string } };
      if (!fileJson.ok || !fileJson.result?.file_path) {
        throw new TelegramSendError('TERMINAL', 'telegram_file_not_found');
      }

      const downloadRes = await fetch(`${this.fileBaseUrl}/${fileJson.result.file_path}`, {
        signal: controller.signal
      });

      if (!downloadRes.ok) {
        throw new TelegramSendError('RETRIABLE', `telegram_download_${downloadRes.status}`);
      }

      const arrayBuffer = await downloadRes.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
      }
      return Buffer.from(binary, 'binary');
    } catch (error) {
      if (error instanceof TelegramSendError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TelegramSendError('RETRIABLE', 'telegram_timeout');
      }
      throw new TelegramSendError('RETRIABLE', 'telegram_transport_error');
    } finally {
      clearTimeout(timer);
    }
  }
}

export class InMemoryStubTelegramAdapter implements TelegramOutboundAdapter {
  readonly sent: Array<{ chat_id: number; text: string; correlation_id?: string; reply_to_message_id?: number; reply_markup?: Record<string, unknown> }> = [];
  readonly downloads: Array<{ file_id: string }> = [];

  async sendText(chatId: number, text: string, options?: TelegramSendOptions): Promise<{ message_id: string }> {
    this.sent.push({
      chat_id: chatId,
      text,
      ...(options?.correlation_id ? { correlation_id: options.correlation_id } : {}),
      ...(options?.reply_to_message_id ? { reply_to_message_id: options.reply_to_message_id } : {})
    });
    return { message_id: `stub-${this.sent.length}` };
  }

  async sendMessageWithMarkup(chatId: number, text: string, replyMarkup: Record<string, unknown>, options?: TelegramSendOptions): Promise<{ message_id: string }> {
    this.sent.push({
      chat_id: chatId,
      text,
      reply_markup: replyMarkup,
      ...(options?.correlation_id ? { correlation_id: options.correlation_id } : {}),
      ...(options?.reply_to_message_id ? { reply_to_message_id: options.reply_to_message_id } : {})
    });
    return { message_id: `stub-${this.sent.length}` };
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    this.downloads.push({ file_id: fileId });
    return Buffer.from('stub-file-content', 'utf8');
  }
}
