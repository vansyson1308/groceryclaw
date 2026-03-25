#!/usr/bin/env node
/**
 * Create a tenant and invite code directly in the database.
 * Run via: node scripts/v2/create_invite.mjs
 *
 * Requires: DB_APP_URL or DATABASE_URL env var, INVITE_PEPPER_B64 env var
 */
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
const { Client } = pg;

const dbUrl = process.env.DB_APP_URL || process.env.DATABASE_URL || '';
if (!dbUrl) { console.error('ERROR: Set DB_APP_URL or DATABASE_URL'); process.exit(1); }

const pepperB64 = process.env.INVITE_PEPPER_B64 || '';
if (!pepperB64) { console.error('ERROR: Set INVITE_PEPPER_B64'); process.exit(1); }

// Generate a random 10-char invite code
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode() {
  const bytes = randomBytes(10);
  return Array.from(bytes).map(b => ALPHABET[b % ALPHABET.length]).join('');
}

function hashCode(normalizedCode) {
  const pepper = Buffer.from(pepperB64, 'base64');
  return createHash('sha256')
    .update(Buffer.concat([pepper, Buffer.from(normalizedCode, 'utf8')]))
    .digest('hex');
}

const client = new Client({ connectionString: dbUrl });
await client.connect();

try {
  // Step 1: Ensure tenant exists
  const TENANT_ID = '11111111-1111-1111-1111-111111111111';
  const TENANT_NAME = 'Tạp Hóa GroceryClaw';

  await client.query(`
    INSERT INTO tenants (id, name, status, processing_mode)
    VALUES ($1, $2, 'active', 'v2')
    ON CONFLICT (id) DO NOTHING
  `, [TENANT_ID, TENANT_NAME]);
  console.log(`✓ Tenant: ${TENANT_NAME} (${TENANT_ID})`);

  // Step 2: Generate invite code
  const code = generateCode();
  const codeHash = hashCode(code);
  const codeHint = code.slice(0, 2) + '****' + code.slice(-2);
  const ttlHours = 720; // 30 days

  const result = await client.query(`
    INSERT INTO invite_codes (tenant_id, code_hash, code_hint, target_role, status, expires_at)
    VALUES ($1, decode($2, 'hex'), $3, 'staff', 'active', now() + interval '${ttlHours} hours')
    RETURNING id, expires_at
  `, [TENANT_ID, codeHash, codeHint]);

  const row = result.rows[0];
  console.log(`✓ Invite code created!`);
  console.log(`  Code:     ${code}`);
  console.log(`  Hint:     ${codeHint}`);
  console.log(`  Role:     staff`);
  console.log(`  Expires:  ${row.expires_at}`);
  console.log(`  ID:       ${row.id}`);
  console.log('');
  console.log(`➜ Gửi mã "${code}" vào Zalo OA để link tài khoản!`);
} finally {
  await client.end();
}
