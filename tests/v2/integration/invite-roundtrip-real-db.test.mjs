import test from 'node:test';
import assert from 'node:assert/strict';
import { freePort, startService } from '../service-harness.mjs';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  computeInviteCodeHashHex,
  normalizeInviteCode,
  createPgPool,
  query,
  closePool
} from '../../../packages/common/dist/index.js';

const dbUrl = process.env.DATABASE_URL;
const skip = !dbUrl;

let adminPool;

async function setupDb() {
  adminPool = await createPgPool({
    connectionString: dbUrl.replace('app_user', 'postgres').replace('app_password', 'postgres'),
    applicationName: 'invite-test-admin',
    statementTimeoutMs: 5000
  });

  await query(adminPool, 'BEGIN');
  try {
    await query(adminPool, 'DELETE FROM sync_results');
    await query(adminPool, 'DELETE FROM resolved_invoice_items');
    await query(adminPool, 'DELETE FROM unit_conversions');
    await query(adminPool, 'DELETE FROM product_cache');
    await query(adminPool, 'DELETE FROM mapping_dictionary');
    await query(adminPool, 'DELETE FROM canonical_invoice_items');
    await query(adminPool, 'DELETE FROM canonical_invoices');
    await query(adminPool, 'DELETE FROM admin_audit_logs');
    await query(adminPool, 'DELETE FROM audit_logs');
    await query(adminPool, 'DELETE FROM pending_notifications');
    await query(adminPool, 'DELETE FROM idempotency_keys');
    await query(adminPool, 'DELETE FROM jobs');
    await query(adminPool, 'DELETE FROM inbound_events');
    await query(adminPool, 'DELETE FROM secret_versions');
    await query(adminPool, 'DELETE FROM invite_codes');
    await query(adminPool, 'DELETE FROM tenant_users');
    await query(adminPool, 'DELETE FROM platform_users');
    await query(adminPool, 'DELETE FROM tenants');

    await query(
      adminPool,
      `INSERT INTO tenants (id, name, status, processing_mode)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           status = EXCLUDED.status,
           processing_mode = EXCLUDED.processing_mode`,
      ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tenant A', 'active', 'v2']
    );

    await query(adminPool, 'COMMIT');
  } catch (error) {
    await query(adminPool, 'ROLLBACK').catch(() => {});
    throw error;
  }
}

async function runSqlAdmin(sql, params = []) {
  const result = await query(adminPool, sql, params);
  return result.rows;
}

test('admin create invite -> gateway consume invite roundtrip works with canonical hash', {
  skip,
  timeout: 60_000
}, async (t) => {
  await setupDb();
  t.after(async () => {
    if (adminPool) {
      await closePool(adminPool);
      adminPool = undefined;
    }
  });

  const dir = mkdtempSync(path.join(tmpdir(), 'groceryclaw-invite-'));
  const queueFile = path.join(dir, 'queue.log');
  const pepperB64 = Buffer.from('roundtrip-pepper', 'utf8').toString('base64');
  const webhookSecret = 'roundtrip-webhook-secret';
  const adminPort = await freePort();
  const gatewayPort = await freePort();

  await startService(t, {
    script: 'apps/admin/dist/server.js',
    env: {
      NODE_ENV: 'test',
      ADMIN_HOST: '127.0.0.1',
      ADMIN_PORT: String(adminPort),
      ADMIN_METRICS_PORT: String(await freePort()),
      DB_ADMIN_URL: dbUrl,
      ADMIN_OIDC_ISSUER: 'https://test.example.com',
      ADMIN_OIDC_AUDIENCE: 'test',
      ADMIN_OIDC_JWKS_URI: 'https://test.example.com/.well-known/jwks.json',
      ADMIN_BREAKGLASS_ENABLED: 'true',
      ADMIN_BREAKGLASS_API_KEY: 'breakglass-key',
      ADMIN_BREAKGLASS_SCOPE: 'ops',
      INVITE_PEPPER_B64: pepperB64,
      READYZ_STRICT: 'false'
    },
    readyUrl: `http://127.0.0.1:${adminPort}/healthz`
  });

  await startService(t, {
    script: 'apps/gateway/dist/server.js',
    env: {
      NODE_ENV: 'test',
      GATEWAY_HOST: '127.0.0.1',
      GATEWAY_PORT: String(gatewayPort),
      GATEWAY_METRICS_HOST: '127.0.0.1',
      GATEWAY_METRICS_PORT: String(await freePort()),
      DB_APP_URL: dbUrl,
      INVITE_PEPPER_B64: pepperB64,
      GATEWAY_QUEUE_CMD: 'node tests/v2/integration/fake-queue.mjs',
      FAKE_QUEUE_FILE: queueFile,
      TELEGRAM_MODE: 'webhook',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_WEBHOOK_SECRET: webhookSecret,
      V2_ONBOARDING_ENABLED: 'true',
      READYZ_STRICT: 'false'
    },
    readyUrl: `http://127.0.0.1:${gatewayPort}/healthz`
  });

  const createInvite = await fetch(
    `http://127.0.0.1:${adminPort}/tenants/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/invites`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-api-key': 'breakglass-key'
      },
      body: JSON.stringify({})
    }
  );

  assert.equal(createInvite.status, 201);

  const inviteBody = await createInvite.json();
  const code = String(inviteBody.code ?? '');
  assert.ok(code.length >= 6);

  const normalized = normalizeInviteCode(code);
  const nodeHash = computeInviteCodeHashHex(normalized, pepperB64);

  const hashResult = await runSqlAdmin(
    `SELECT encode(
       digest(decode($1, 'base64') || convert_to($2, 'UTF8'), 'sha256'),
       'hex'
     ) AS hash`,
    [pepperB64, normalized]
  );
  const dbHash = String(hashResult[0]?.hash ?? '').trim();
  assert.equal(nodeHash, dbHash);

  const telegramUserId = 777000111;
  const update = {
    update_id: 880001,
    message: {
      message_id: 42,
      date: Math.floor(Date.now() / 1000),
      chat: { id: telegramUserId, type: 'private' },
      from: { id: telegramUserId, is_bot: false, first_name: 'Roundtrip' },
      text: `INVITE ${code}`
    }
  };

  const webhook = await fetch(`http://127.0.0.1:${gatewayPort}/webhooks/telegram`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': webhookSecret
    },
    body: JSON.stringify(update)
  });
  assert.equal(webhook.status, 200);

  const membershipResult = await runSqlAdmin(
    `SELECT count(*)::int AS count
     FROM tenant_users tu
     JOIN platform_users pu ON pu.id = tu.user_id
     WHERE pu.platform_user_id = $1
       AND pu.platform = 'telegram'
       AND pu.telegram_chat_id = $1::bigint
       AND tu.tenant_id = $2::uuid
       AND tu.status = 'active'`,
    [String(telegramUserId), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']
  );
  const membershipCount = String(membershipResult[0]?.count ?? '0');
  assert.equal(membershipCount, '1');

  const plainStoredResult = await runSqlAdmin(
    `SELECT count(*)::int AS count
     FROM invite_codes
     WHERE code_hint = $1`,
    [code]
  );
  const plainStored = String(plainStoredResult[0]?.count ?? '0');
  assert.equal(plainStored, '0');

  const queueLines = readFileSync(queueFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.ok(
    queueLines.some((job) => job.job_type === 'NOTIFY_USER' && job.notification_type === 'WELCOME_LINKED')
  );
});
