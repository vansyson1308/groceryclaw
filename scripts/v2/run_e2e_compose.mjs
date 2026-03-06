import { spawnSync } from 'node:child_process';
import { randomUUID, createHmac } from 'node:crypto';

const project = `gc-e2e-${randomUUID().slice(0, 8)}`;
const envFile = 'infra/compose/v2/e2e.env';
const files = ['-f', 'infra/compose/v2/docker-compose.yml', '-f', 'infra/compose/v2/docker-compose.e2e.yml'];
const composeBase = ['compose', '--project-name', project, '--env-file', envFile, ...files];

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...opts });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    throw new Error(output || `${cmd} ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function dockerCompose(args, opts = {}) {
  return run('docker', [...composeBase, ...args], opts);
}

async function waitFor(name, check, timeoutMs, intervalMs = 1000) {
  const start = Date.now();
  while ((Date.now() - start) < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timeout waiting for ${name}`);
}

function sql(query) {
  return dockerCompose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'groceryclaw_v2_e2e', '-Atc', query]);
}

function serviceFetch(service, request) {
  const payload = Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
  return dockerCompose([
    'exec', '-T', '-e', `E2E_FETCH_REQ_B64=${payload}`, service, 'node', '-e',
    "const req=JSON.parse(Buffer.from(process.env.E2E_FETCH_REQ_B64||'', 'base64').toString('utf8'));fetch(req.url,{method:req.method||'GET',headers:req.headers||{},body:req.body??undefined}).then(async r=>{const t=await r.text();process.stdout.write(JSON.stringify({status:r.status,body:t}));}).catch(e=>{console.error(e);process.exit(1);});"
  ]);
}

function parseFetchResult(raw) {
  return JSON.parse(raw || '{}');
}

function webhookHeaders(secret, body) {
  return {
    'content-type': 'application/json',
    'x-zalo-signature': createHmac('sha256', secret).update(body).digest('hex')
  };
}

async function main() {
  const webhookSecret = 'e2e-webhook-secret';
  const inviteUser = 'zalo_user_invite_001';
  const linkedUser = 'zalo_user_linked_001';
  const tenantName = `E2E-${randomUUID().slice(0, 8)}`;
  const tenantCode = `E2E${Math.floor(Math.random() * 100000)}`;
  let tenantId = '';

  try {
    dockerCompose(['up', '-d', '--build', 'postgres', 'redis', 'gateway', 'admin', 'worker', 'xml-stub', 'kiotviet-stub', 'zalo-stub']);

    run('npm', ['run', 'db:v2:migrate'], {
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/groceryclaw_v2_e2e'
      }
    });

    await waitFor('gateway readyz', async () => {
      try {
        const out = parseFetchResult(serviceFetch('gateway', { url: 'http://127.0.0.1:8080/readyz' }));
        return out.status === 200;
      } catch {
        return false;
      }
    }, 120_000);

    await waitFor('worker readyz', async () => {
      try {
        const out = parseFetchResult(serviceFetch('worker', { url: 'http://127.0.0.1:3002/readyz' }));
        return out.status === 200;
      } catch {
        return false;
      }
    }, 120_000);

    await waitFor('admin healthz', async () => {
      try {
        const out = parseFetchResult(serviceFetch('admin', { url: 'http://127.0.0.1:3001/healthz' }));
        return out.status === 200;
      } catch {
        return false;
      }
    }, 120_000);

    const adminHeaders = { 'content-type': 'application/json', 'x-admin-api-key': 'e2e-breakglass-key' };
    const createTenantResp = parseFetchResult(serviceFetch('admin', {
      url: 'http://127.0.0.1:3001/tenants',
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: tenantName, code: tenantCode, metadata: { source: 'e2e' } })
    }));
    if (createTenantResp.status !== 201) throw new Error(`tenant create failed: ${createTenantResp.status} ${createTenantResp.body}`);
    tenantId = JSON.parse(createTenantResp.body).id;

    const inviteResp = parseFetchResult(serviceFetch('admin', {
      url: `http://127.0.0.1:3001/tenants/${tenantId}/invites`,
      method: 'POST',
      headers: adminHeaders,
      body: '{}'
    }));
    if (inviteResp.status !== 201) throw new Error(`invite create failed: ${inviteResp.status} ${inviteResp.body}`);
    const inviteCode = JSON.parse(inviteResp.body).code;

    const invitePayload = JSON.stringify({
      platform_user_id: inviteUser,
      zalo_msg_id: 'msg-invite-roundtrip-001',
      message_type: 'text',
      attachments: [],
      text: `INVITE ${inviteCode}`
    });
    const inviteWebhookResp = parseFetchResult(serviceFetch('gateway', {
      url: 'http://127.0.0.1:8080/webhooks/zalo',
      method: 'POST',
      headers: webhookHeaders(webhookSecret, invitePayload),
      body: invitePayload
    }));
    if (inviteWebhookResp.status !== 200) throw new Error(`invite webhook failed: ${inviteWebhookResp.status} ${inviteWebhookResp.body}`);

    await waitFor('invite membership created', async () => {
      try {
        const count = Number(sql(`SELECT count(*) FROM tenant_users tu JOIN zalo_users zu ON zu.id=tu.zalo_user_id WHERE tu.tenant_id='${tenantId}'::uuid AND zu.platform_user_id='${inviteUser}';`) || '0');
        return count >= 1;
      } catch {
        return false;
      }
    }, 60_000);

    const patchTenantResp = parseFetchResult(serviceFetch('admin', {
      url: `http://127.0.0.1:3001/tenants/${tenantId}`,
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ processing_mode: 'v2', enabled: true })
    }));
    if (patchTenantResp.status !== 200) throw new Error(`tenant patch failed: ${patchTenantResp.status} ${patchTenantResp.body}`);

    sql(`INSERT INTO zalo_users (id, platform_user_id, display_name, last_interaction_at) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '${linkedUser}', 'Linked User', now() - interval '25 hour') ON CONFLICT (platform_user_id) DO UPDATE SET last_interaction_at = now() - interval '25 hour';`);
    sql(`INSERT INTO tenant_users (tenant_id, zalo_user_id, role, status) VALUES ('${tenantId}'::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'owner', 'active') ON CONFLICT (tenant_id, zalo_user_id) DO NOTHING;`);

    const notifyJob = {
      job_type: 'NOTIFY_USER',
      tenant_id: tenantId,
      inbound_event_id: null,
      platform_user_id: linkedUser,
      zalo_user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      zalo_msg_id: 'msg-notify-defer-001',
      correlation_id: 'corr-notify-defer-001',
      notification_type: 'GENERIC_INFO',
      template_vars: { note: 'defer-check' },
      enqueued_at_ms: Date.now()
    };
    dockerCompose(['exec', '-T', 'redis', 'redis-cli', '-a', 'redis_pass', 'RPUSH', 'bull:process-inbound:wait', JSON.stringify(notifyJob)]);

    await waitFor('pending notification deferred', async () => {
      try {
        const pending = Number(sql(`SELECT count(*) FROM pending_notifications pn JOIN zalo_users zu ON zu.id=pn.zalo_user_id WHERE pn.tenant_id='${tenantId}'::uuid AND zu.platform_user_id='${linkedUser}' AND pn.status='pending';`) || '0');
        return pending >= 1;
      } catch {
        return false;
      }
    }, 60_000);

    const invoicePayload = JSON.stringify({
      platform_user_id: linkedUser,
      zalo_msg_id: 'msg-invoice-001',
      message_type: 'file',
      attachments: [{ type: 'file', url: 'http://xml-stub:18082/invoice.xml', name: 'invoice.xml' }],
      text: 'invoice attached'
    });

    for (let i = 0; i < 2; i += 1) {
      const r = parseFetchResult(serviceFetch('gateway', {
        url: 'http://127.0.0.1:8080/webhooks/zalo',
        method: 'POST',
        headers: webhookHeaders(webhookSecret, invoicePayload),
        body: invoicePayload
      }));
      if (r.status !== 200) throw new Error(`invoice webhook attempt ${i + 1} failed: ${r.status} ${r.body}`);
    }

    await waitFor('canonical invoice + items + idempotency', async () => {
      try {
        const invoiceCount = Number(sql(`SELECT count(*) FROM canonical_invoices WHERE tenant_id='${tenantId}'::uuid;`) || '0');
        const itemCount = Number(sql(`SELECT count(*) FROM canonical_invoice_items WHERE tenant_id='${tenantId}'::uuid;`) || '0');
        const inboundCount = Number(sql(`SELECT count(*) FROM inbound_events WHERE tenant_id='${tenantId}'::uuid AND zalo_msg_id='msg-invoice-001';`) || '0');
        return invoiceCount === 1 && itemCount >= 1 && inboundCount === 1;
      } catch {
        return false;
      }
    }, 120_000);

    await waitFor('pending notification flushed', async () => {
      try {
        const pending = Number(sql(`SELECT count(*) FROM pending_notifications pn JOIN zalo_users zu ON zu.id=pn.zalo_user_id WHERE pn.tenant_id='${tenantId}'::uuid AND zu.platform_user_id='${linkedUser}' AND pn.status='pending';`) || '0');
        const sent = Number(sql(`SELECT count(*) FROM pending_notifications pn JOIN zalo_users zu ON zu.id=pn.zalo_user_id WHERE pn.tenant_id='${tenantId}'::uuid AND zu.platform_user_id='${linkedUser}' AND pn.status='flushed';`) || '0');
        return pending === 0 && sent >= 1;
      } catch {
        return false;
      }
    }, 120_000);

    const sentResult = parseFetchResult(serviceFetch('zalo-stub', { url: 'http://127.0.0.1:18081/_sent_count' }));
    const stubSendCount = sentResult.status === 200 ? Number(JSON.parse(sentResult.body).count ?? 0) : 0;
    if (!Number.isFinite(stubSendCount) || stubSendCount < 1) {
      throw new Error(`expected stub sends >= 1, got ${stubSendCount}`);
    }

    console.log(`E2E passed (tenant=${tenantId}): onboarding invite, v2 routing, idempotency, notifier defer/flush verified.`);
  } finally {
    try {
      dockerCompose(['down', '-v', '--remove-orphans']);
    } catch (error) {
      console.error('compose cleanup failed', error instanceof Error ? error.message : String(error));
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
