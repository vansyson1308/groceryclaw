const crypto = require('node:crypto');

function buildZaloSigningString({ appId, timestamp, payload, secret }) {
  if (!appId || !timestamp || payload === undefined || !secret) {
    throw new Error('Missing required fields for Zalo signature signing string');
  }

  return `${appId}${timestamp}${payload}${secret}`;
}

function computeZaloSignature({ appId, timestamp, payload, secret }) {
  const data = buildZaloSigningString({ appId, timestamp, payload, secret });
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function verifyZaloSignature({ appId, timestamp, payload, secret, signature }) {
  if (!signature) return false;

  const expected = computeZaloSignature({ appId, timestamp, payload, secret });

  const signatureBuffer = Buffer.from(signature.toLowerCase(), 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (signatureBuffer.length !== expectedBuffer.length) return false;

  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

module.exports = {
  buildZaloSigningString,
  computeZaloSignature,
  verifyZaloSignature
};
