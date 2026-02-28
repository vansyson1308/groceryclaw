const test = require('node:test');
const assert = require('node:assert/strict');

const { createGetZaloAccessToken } = require('./zaloToken');

test('returns access token when record is valid', async () => {
  const getToken = createGetZaloAccessToken({
    fetchActiveToken: async () => ({
      access_token: 'token_abc',
      expires_at: '2099-01-01T00:00:00.000Z'
    }),
    now: () => new Date('2026-01-01T00:00:00.000Z')
  });

  const token = await getToken();
  assert.equal(token, 'token_abc');
});

test('throws E011 when missing record', async () => {
  const getToken = createGetZaloAccessToken({
    fetchActiveToken: async () => null,
    now: () => new Date('2026-01-01T00:00:00.000Z')
  });

  await assert.rejects(() => getToken(), /E011/);
});

test('throws E011 when expired', async () => {
  const getToken = createGetZaloAccessToken({
    fetchActiveToken: async () => ({
      access_token: 'token_old',
      expires_at: '2025-01-01T00:00:00.000Z'
    }),
    now: () => new Date('2026-01-01T00:00:00.000Z')
  });

  await assert.rejects(() => getToken(), /E011/);
});
