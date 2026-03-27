import test from 'node:test';
import assert from 'node:assert/strict';

test('InMemoryStubTelegramAdapter: sendText records messages', async () => {
  const { InMemoryStubTelegramAdapter } = await import('../../apps/worker/dist/telegram-adapter.js');
  const adapter = new InMemoryStubTelegramAdapter();

  const result = await adapter.sendText(12345, 'Hello from test');
  assert.equal(result.message_id, 'stub-1');
  assert.equal(adapter.sent.length, 1);
  assert.equal(adapter.sent[0].chat_id, 12345);
  assert.equal(adapter.sent[0].text, 'Hello from test');
});

test('InMemoryStubTelegramAdapter: sendText with correlation_id', async () => {
  const { InMemoryStubTelegramAdapter } = await import('../../apps/worker/dist/telegram-adapter.js');
  const adapter = new InMemoryStubTelegramAdapter();

  await adapter.sendText(999, 'test', { correlation_id: 'corr-123' });
  assert.equal(adapter.sent[0].correlation_id, 'corr-123');
});

test('InMemoryStubTelegramAdapter: downloadFile returns stub buffer', async () => {
  const { InMemoryStubTelegramAdapter } = await import('../../apps/worker/dist/telegram-adapter.js');
  const adapter = new InMemoryStubTelegramAdapter();

  const buffer = await adapter.downloadFile('file-abc');
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(adapter.downloads.length, 1);
  assert.equal(adapter.downloads[0].file_id, 'file-abc');
});

test('TelegramSendError: has kind and code', async () => {
  const { TelegramSendError } = await import('../../apps/worker/dist/telegram-adapter.js');

  const err = new TelegramSendError('RETRIABLE', 'telegram_timeout', 5000);
  assert.equal(err.kind, 'RETRIABLE');
  assert.equal(err.code, 'telegram_timeout');
  assert.equal(err.retryAfterMs, 5000);
  assert.ok(err instanceof Error);
});

test('InMemoryStubTelegramAdapter: multiple sends increment message_id', async () => {
  const { InMemoryStubTelegramAdapter } = await import('../../apps/worker/dist/telegram-adapter.js');
  const adapter = new InMemoryStubTelegramAdapter();

  const r1 = await adapter.sendText(1, 'a');
  const r2 = await adapter.sendText(2, 'b');
  const r3 = await adapter.sendText(3, 'c');

  assert.equal(r1.message_id, 'stub-1');
  assert.equal(r2.message_id, 'stub-2');
  assert.equal(r3.message_id, 'stub-3');
  assert.equal(adapter.sent.length, 3);
});
