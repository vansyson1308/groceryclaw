import {
  TelegramBotClient,
  validateTelegramUpdate,
  parseExcelInvoice,
  createLogger,
} from '@groceryclaw/common/dist/index.js';

import type { TelegramBotEvent, CanonicalInvoice } from '@groceryclaw/common/dist/index.js';

const log = createLogger({ service: 'telegram-poller', level: 'info' });

function formatInvoiceSummary(invoice: CanonicalInvoice): string {
  const lines: string[] = [];
  lines.push(`📋 Hoa don: ${invoice.invoice_number}`);
  lines.push(`📅 Ngay: ${invoice.invoice_date}`);
  lines.push(`💰 Tong: ${invoice.total.toLocaleString('vi-VN')} ${invoice.currency}`);
  lines.push(`📦 So san pham: ${invoice.items.length}`);
  lines.push('');
  lines.push('--- Chi tiet ---');

  for (const item of invoice.items.slice(0, 20)) {
    const sku = item.sku ? ` [${item.sku}]` : '';
    const uom = item.uom ? ` (${item.uom})` : '';
    lines.push(
      `${item.line_no}. ${item.product_name}${sku}${uom}: ${item.quantity} x ${item.unit_price.toLocaleString('vi-VN')} = ${item.line_total.toLocaleString('vi-VN')}`
    );
  }

  if (invoice.items.length > 20) {
    lines.push(`... va ${invoice.items.length - 20} san pham khac`);
  }

  return lines.join('\n');
}

function isExcelFile(fileName: string | undefined): boolean {
  if (!fileName) return false;
  const lower = fileName.toLowerCase();
  return lower.endsWith('.xlsx') || lower.endsWith('.xls');
}

async function handleEvent(bot: TelegramBotClient, event: TelegramBotEvent): Promise<void> {
  const { chat_id, message_type, user_display_name } = event;

  if (message_type === 'document' && event.document && isExcelFile(event.document.file_name)) {
    log.info('Received Excel file', {
      user_id: String(event.user_id),
      file_name: event.document.file_name,
      file_size: event.document.file_size,
    });

    try {
      await bot.sendMessage(chat_id, '⏳ Dang xu ly file Excel...');

      const fileInfo = await bot.getFile(event.document.file_id);
      if (!fileInfo.file_path) {
        await bot.sendMessage(chat_id, '❌ Khong the tai file. Vui long thu lai.');
        return;
      }

      const buffer = await bot.downloadFile(fileInfo.file_path);
      const invoice = await parseExcelInvoice(buffer);
      const summary = formatInvoiceSummary(invoice);

      await bot.sendMessage(chat_id, `✅ Da doc thanh cong!\n\n${summary}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      log.error('Excel parse failed', { error: message, user_id: String(event.user_id) });

      const userMessage = message.startsWith('excel_')
        ? `❌ Loi doc file: ${message.replace('excel_', '').replace(/_/g, ' ')}`
        : '❌ Khong the doc file Excel. Vui long kiem tra lai dinh dang.';

      await bot.sendMessage(chat_id, userMessage);
    }
    return;
  }

  if (message_type === 'text' && event.text) {
    const text = event.text.trim();

    if (text === '/start') {
      await bot.sendMessage(
        chat_id,
        `Xin chao ${user_display_name}! 👋\n\n` +
          'Toi la GroceryClaw Bot. Gui file Excel (.xlsx) chua hoa don nhap hang de toi xu ly.\n\n' +
          'Cac lenh:\n' +
          '/start - Bat dau\n' +
          '/help - Huong dan'
      );
      return;
    }

    if (text === '/help') {
      await bot.sendMessage(
        chat_id,
        '📖 Huong dan su dung:\n\n' +
          '1. Gui file Excel (.xlsx) chua hoa don nhap hang\n' +
          '2. File can co cac cot: Ten SP, So luong, Don gia, Thanh tien\n' +
          '3. Bot se doc va tra ket qua chi tiet\n\n' +
          'Dinh dang file:\n' +
          '- Dong dau tien la tieu de cot\n' +
          '- Ho tro tieng Viet va tieng Anh\n' +
          '- Toi da 1000 dong, 10MB'
      );
      return;
    }

    await bot.sendMessage(chat_id, 'Gui file Excel (.xlsx) de bat dau xu ly hoa don. Goi /help de xem huong dan.');
    return;
  }

  await bot.sendMessage(chat_id, 'Vui long gui file Excel (.xlsx) hoac goi /help de xem huong dan.');
}

export async function startPolling(botToken: string): Promise<void> {
  const bot = new TelegramBotClient({ botToken });

  const me = await bot.getMe();
  log.info(`Bot started: @${me.username ?? me.first_name} (ID: ${me.id})`);

  await bot.deleteWebhook();

  let offset: number | undefined;
  let running = true;

  const proc = (globalThis as unknown as { process: { on(event: string, cb: () => void): void } }).process;
  const shutdown = () => {
    log.info('Shutting down poller...');
    running = false;
  };
  proc.on('SIGINT', shutdown);
  proc.on('SIGTERM', shutdown);

  log.info('Polling for updates...');

  while (running) {
    try {
      const updates = await bot.getUpdates(offset);

      for (const raw of updates) {
        const result = validateTelegramUpdate(raw);
        if (!result.ok) {
          log.warn('Invalid update, skipping', { reason: result.reason });
          const updateId = (raw as Record<string, unknown>).update_id;
          if (typeof updateId === 'number') offset = updateId + 1;
          continue;
        }

        const event = result.value;
        offset = event.update_id + 1;

        try {
          await handleEvent(bot, event);
        } catch (err) {
          log.error('Error handling event', {
            error: err instanceof Error ? err.message : 'unknown',
            update_id: String(event.update_id),
          });
        }
      }
    } catch (err) {
      log.error('Polling error', { error: err instanceof Error ? err.message : 'unknown' });
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
if (token.length === 0) {
  console.error('TELEGRAM_BOT_TOKEN env var is required');
  throw new Error('TELEGRAM_BOT_TOKEN is required');
}

startPolling(token);
