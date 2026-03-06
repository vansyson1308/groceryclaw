import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { computeInviteCodeHashHex, normalizeInviteCode } from '../../../packages/common/dist/index.js';

const dbUrl = process.env.DATABASE_URL;
const skip = !dbUrl;

function runSql(sql) {
  const r = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-c', sql], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(r.stderr || 'psql failed');
  }
  return r.stdout.trim();
}

function signBody(body, secret) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function waitServer(proc, url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('server start timeout'));
    }, 6000);

    proc.stdout.on('data', async () => {
      try {
        const r = await fetch(url);
        if (r.status >= 200) {
          clearTimeout(timeout);
          resolve();
        }
      } catch {
        // keep waiting
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) {
        clearTimeout(timeout);
        reject(new Error(text));
      }
    });
  });
}

test('admin create invite -> gateway consume invite roundtrip works with canonical hash', {
  skip,
  timeout: 60_000
}, async () => {
  runSql(`
    BEGIN;
      DELETE FROM sync_results;
      DELETE FROM resolved_invoice_items;
      DELETE FROM unit_conversions;
      DELETE FROM product_cache;
      DELETE FROM mapping_dictionary;
      DELETE FROM canonical_invoice_items;
      DELETE FROM canonical_invoices;
      DELETE FROM admin_audit_logs;
      DELETE FROM audit_logs;
      DELETE FROM pending_notifications;
      DELETE FROM idempotency_keys;
      DELETE FROM jobs;
      DELETE FROM inbound_events;
      DELETE FROM secret_versions;
      DELETE FROM invite_codes;
      DELETE FROM tenant_users;
      DELETE FROM zalo_users;
      DELETE FROM tenants;

      INSERT INTO tenants (id, name, status, processing_mode)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tenant A', 'active', 'v2');
    COMMIT;
  `);

  const dir = mkdtempSync(path.join(tmpdir(), 'groceryclaw-invite-'));
  const queueFile = path.join(dir, 'queue.log');
  const pepperB64 = Buffer.from('roundtrip-pepper', 'utf8').toString('base64');
  const webhookSecret = 'roundtrip-webhook-secret';

  const admin = spawn('node', ['apps/admin/dist/server.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ADMIN_HOST: '127.0.0.1',
      ADMIN_PORT: '3431',
      POSTGRES_URL: dbUrl,
      ADMIN_BREAKGLASS_ENABLED: 'true',
      ADMIN_BREAKGLASS_API_KEY: 'breakglass-key',
      ADMIN_BREAKGLASS_SCOPE: 'ops',
      INVITE_PEPPER_B64: pepperB64,
      READYZ_STRICT: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const gateway = spawn('node', ['apps/gateway/dist/server.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      GATEWAY_HOST: '127.0.0.1',
      GATEWAY_PORT: '3430',
      POSTGRES_URL: dbUrl,
      INVITE_PEPPER_B64: pepperB64,
      GATEWAY_QUEUE_CMD: 'node tests/v2/integration/fake-queue.mjs',
      FAKE_QUEUE_FILE: queueFile,
      WEBHOOK_VERIFY_MODE: 'mode1',
      WEBHOOK_SIGNATURE_SECRET: webhookSecret,
      V2_ONBOARDING_ENABLED: 'true',
      V2_GATEWAY_WEBHOOK_ENABLED: 'true',
      READYZ_STRICT: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitServer(admin, 'http://127.0.0.1:3431/healthz');
    await waitServer(gateway, 'http://127.0.0.1:3430/healthz');

    const createInvite = await fetch('http://127.0.0.1:3431/tenants/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/invites', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-api-key': 'breakglass-key'
      },
      body: JSON.stringify({})
    });
    assert.equal(createInvite.status, 201);
    const inviteBody = await createInvite.json();
    const code = String(inviteBody.code ?? '');
    assert.ok(code.length >= 6);

    const normalized = normalizeInviteCode(code);
    const nodeHash = computeInviteCodeHashHex(normalized, pepperB64);
    const dbHash = runSql(`
      SELECT encode(digest(decode('${pepperB64}', 'base64') || convert_to('${normalized}', 'UTF8'), 'sha256'), 'hex');
    `).trim();
    assert.equal(nodeHash, dbHash);

    const bodyObj = {
      platform_user_id: 'zalo_roundtrip_user',
      zalo_msg_id: 'zalo-msg-roundtrip-1',
      message_type: 'text',
      text: `INVITE ${code}`,
      raw: {
        platform_user_id: 'zalo_roundtrip_user',
        zalo_msg_id: 'zalo-msg-roundtrip-1',
        message_type: 'text',
        text: `INVITE ${code}`
      }
    };
    const body = JSON.stringify(bodyObj);

    const webhook = await fetch('http://127.0.0.1:3430/webhooks/zalo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-zalo-signature': signBody(body, webhookSecret)
      },
      body
    });
    assert.equal(webhook.status, 200);

    const membershipCount = runSql(`
      SELECT count(*)::int
      FROM tenant_users tu
      JOIN zalo_users zu ON zu.id = tu.zalo_user_id
      WHERE zu.platform_user_id = 'zalo_roundtrip_user'
        AND tu.tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
        AND tu.status = 'active';
    `);
    assert.equal(membershipCount, '1');

    const plainStored = runSql(`
      SELECT count(*)::int
      FROM invite_codes
      WHERE code_hint = '${code.replace(/'/g, "''")}';
    `);
    assert.equal(plainStored, '0');

    const queueLines = readFileSync(queueFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(queueLines.some((job) => job.job_type === 'NOTIFY_USER' && job.template === 'invite_success'));
  } finally {
    admin.kill('SIGTERM');
    gateway.kill('SIGTERM');
  }
});
