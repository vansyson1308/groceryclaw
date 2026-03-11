/**
 * Build a pure helper that returns the active Zalo OA access token
 * after validating expiry.
 *
 * @param {Object} deps
 * @param {() => Promise<{access_token: string, expires_at: string|Date}|null>} deps.fetchActiveToken
 * @param {() => Date} [deps.now]
 */
function createGetZaloAccessToken({ fetchActiveToken, now = () => new Date() }) {
  if (typeof fetchActiveToken !== 'function') {
    throw new TypeError('fetchActiveToken must be a function');
  }

  return async function getZaloAccessToken() {
    const record = await fetchActiveToken();

    if (!record || !record.access_token || !record.expires_at) {
      throw new Error('E011: Zalo access token expired or missing. Check Phase 0.5 workflow.');
    }

    const expiresAt = new Date(record.expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now()) {
      throw new Error('E011: Zalo access token expired or missing. Check Phase 0.5 workflow.');
    }

    return record.access_token;
  };
}

module.exports = {
  createGetZaloAccessToken
};
