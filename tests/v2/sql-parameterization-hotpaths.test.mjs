import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const checks = [
  {
    file: 'apps/gateway/src/server.ts',
    banned: [
      'SET last_interaction_at = now()\n    WHERE platform_user_id = ${sqlQuote(',
      'COALESCE((SELECT id FROM zalo_users WHERE platform_user_id = ${sqlQuote('
    ],
    required: ['WHERE platform_user_id = $1', 'ON CONFLICT (tenant_id, zalo_msg_id) DO NOTHING']
  },
  {
    file: 'apps/admin/src/server.ts',
    banned: ['SET ${setClauses.join', 'decode(${sqlQuote(codeHashHex)}', 'id = ${sqlQuote(secretId)}::uuid'],
    required: ['processing_mode = COALESCE($1::text, processing_mode)', 'decode($2, \'hex\')']
  }
];

test('hot path SQL uses parameterized placeholders for gateway/admin critical mutations', () => {
  for (const check of checks) {
    const text = readFileSync(check.file, 'utf8');
    for (const banned of check.banned) {
      assert.equal(text.includes(banned), false, `${check.file} contains banned pattern: ${banned}`);
    }
    for (const required of check.required) {
      assert.equal(text.includes(required), true, `${check.file} missing required pattern: ${required}`);
    }
  }
});
