import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTelegramUpdate } from '../../packages/common/dist/index.js';

function makeUpdate(overrides = {}) {
  return {
    update_id: 12345,
    message: {
      message_id: 100,
      from: { id: 999, is_bot: false, first_name: 'Nguyen', last_name: 'Van A' },
      chat: { id: 999, type: 'private' },
      date: 1700000000,
      text: '/start',
      ...overrides,
    },
  };
}

test('validateTelegramUpdate: valid text message', () => {
  const result = validateTelegramUpdate(makeUpdate());

  assert.ok(result.ok);
  assert.equal(result.value.update_id, 12345);
  assert.equal(result.value.message_id, 100);
  assert.equal(result.value.chat_id, 999);
  assert.equal(result.value.user_id, 999);
  assert.equal(result.value.user_display_name, 'Nguyen Van A');
  assert.equal(result.value.message_type, 'text');
  assert.equal(result.value.text, '/start');
  assert.equal(result.value.timestamp, 1700000000);
});

test('validateTelegramUpdate: valid document message', () => {
  const result = validateTelegramUpdate(
    makeUpdate({
      text: undefined,
      document: {
        file_id: 'abc123',
        file_unique_id: 'xyz789',
        file_name: 'invoice.xlsx',
        mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        file_size: 1024,
      },
    })
  );

  assert.ok(result.ok);
  assert.equal(result.value.message_type, 'document');
  assert.equal(result.value.document.file_id, 'abc123');
  assert.equal(result.value.document.file_name, 'invoice.xlsx');
  assert.equal(result.value.text, undefined);
});

test('validateTelegramUpdate: valid photo message', () => {
  const result = validateTelegramUpdate(
    makeUpdate({
      text: undefined,
      photo: [
        { file_id: 'photo1', file_unique_id: 'p1', width: 100, height: 100 },
        { file_id: 'photo2', file_unique_id: 'p2', width: 800, height: 600 },
      ],
      caption: 'Hoa don ngay 15/01',
    })
  );

  assert.ok(result.ok);
  assert.equal(result.value.message_type, 'photo');
  assert.equal(result.value.photo.length, 2);
  assert.equal(result.value.caption, 'Hoa don ngay 15/01');
});

test('validateTelegramUpdate: rejects null', () => {
  const result = validateTelegramUpdate(null);
  assert.ok(!result.ok);
});

test('validateTelegramUpdate: rejects missing update_id', () => {
  const result = validateTelegramUpdate({ message: makeUpdate().message });
  assert.ok(!result.ok);
  assert.equal(result.reason, 'invalid_update_id');
});

test('validateTelegramUpdate: rejects missing message', () => {
  const result = validateTelegramUpdate({ update_id: 1 });
  assert.ok(!result.ok);
  assert.equal(result.reason, 'no_message');
});

test('validateTelegramUpdate: rejects missing from', () => {
  const result = validateTelegramUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: 1, type: 'private' },
      date: 1700000000,
    },
  });
  assert.ok(!result.ok);
  assert.equal(result.reason, 'no_from');
});

test('validateTelegramUpdate: display name falls back to user_id', () => {
  const result = validateTelegramUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 42, is_bot: false, first_name: '' },
      chat: { id: 42, type: 'private' },
      date: 1700000000,
      text: 'hello',
    },
  });

  assert.ok(result.ok);
  assert.equal(result.value.user_display_name, 'user_42');
});

test('validateTelegramUpdate: unknown message type when no text/doc/photo', () => {
  const result = validateTelegramUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 5, is_bot: false, first_name: 'Test' },
      chat: { id: 5, type: 'private' },
      date: 1700000000,
    },
  });

  assert.ok(result.ok);
  assert.equal(result.value.message_type, 'unknown');
});

test('validateTelegramUpdate: rejects invalid document (missing file_id)', () => {
  const result = validateTelegramUpdate(
    makeUpdate({
      text: undefined,
      document: { file_unique_id: 'xyz' },
    })
  );
  assert.ok(!result.ok);
  assert.equal(result.reason, 'invalid_document');
});
