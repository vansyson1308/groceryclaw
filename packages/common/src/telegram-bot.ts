import { createLogger } from './logger.js';

const log = createLogger({ service: 'telegram-bot', level: 'info' });

export interface TelegramFile {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly file_size?: number;
  readonly file_path?: string;
}

export interface TelegramSendMessageResult {
  readonly message_id: number;
}

export interface TelegramBotClientConfig {
  readonly botToken: string;
  readonly apiBaseUrl?: string;
  readonly timeoutMs?: number;
}

export class TelegramBotClient {
  private readonly baseUrl: string;
  private readonly fileBaseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: TelegramBotClientConfig) {
    const apiBase = config.apiBaseUrl ?? 'https://api.telegram.org';
    this.baseUrl = `${apiBase}/bot${config.botToken}`;
    this.fileBaseUrl = `${apiBase}/file/bot${config.botToken}`;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  private async callApi<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/${method}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : null,
        signal: controller.signal,
      });

      const json = (await res.json()) as { ok: boolean; result?: T; description?: string };

      if (!json.ok) {
        const desc = json.description ?? 'unknown_error';
        log.error(`Telegram API error: ${method} -> ${res.status} ${desc}`);
        throw new Error(`telegram_api_error: ${desc}`);
      }

      return json.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async getUpdates(offset?: number, timeoutSeconds = 25): Promise<unknown[]> {
    return this.callApi<unknown[]>('getUpdates', {
      ...(offset !== undefined ? { offset } : {}),
      timeout: timeoutSeconds,
      allowed_updates: ['message'],
    });
  }

  async sendMessage(chatId: number, text: string, parseMode?: 'HTML' | 'MarkdownV2'): Promise<TelegramSendMessageResult> {
    return this.callApi<TelegramSendMessageResult>('sendMessage', {
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });
  }

  async getFile(fileId: string): Promise<TelegramFile> {
    return this.callApi<TelegramFile>('getFile', { file_id: fileId });
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const url = `${this.fileBaseUrl}/${filePath}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });

      if (!res.ok) {
        throw new Error(`telegram_download_error: ${res.status}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
      }
      return Buffer.from(binary, 'binary');
    } finally {
      clearTimeout(timer);
    }
  }

  async setWebhook(url: string, secretToken?: string): Promise<boolean> {
    return this.callApi<boolean>('setWebhook', {
      url,
      ...(secretToken ? { secret_token: secretToken } : {}),
      allowed_updates: ['message'],
    });
  }

  async deleteWebhook(): Promise<boolean> {
    return this.callApi<boolean>('deleteWebhook', {});
  }

  async getMe(): Promise<{ id: number; first_name: string; username?: string }> {
    return this.callApi('getMe');
  }
}
