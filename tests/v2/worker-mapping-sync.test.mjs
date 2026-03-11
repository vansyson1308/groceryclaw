import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { encryptPayload } from '../../packages/common/dist/index.js';
import { processMapResolve } from '../../apps/worker/dist/mapping-resolve.js';
import { HttpKiotvietAdapter } from '../../apps/worker/dist/kiotviet-adapter.js';
import { processKiotvietSync } from '../../apps/worker/dist/kiotviet-sync.js';

function startKvStub(modeRef) {
  let calls = 0;
  let lastAuth = '';
  const server = createServer((req, res) => {
    if (req.url !== '/imports/draft' || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    lastAuth = String(req.headers.authorization ?? '');
    calls += 1;
    const mode = modeRef.mode;
    if (mode === 'success') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ external_reference_id: 'kv-1' }));
      return;
    }
    if (mode === 'rate-then-success') {
      if (calls === 1) {
        res.writeHead(429).end();
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ external_reference_id: 'kv-2' }));
      }
      return;
    }
    if (mode === 'timeout') {
      return;
    }
    res.writeHead(500).end();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        calls: () => calls,
        lastAuth: () => lastAuth,
        baseUrl: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
      });
    });
  });
}

test('mapping unresolved does not call kiotviet and enqueues notify placeholder', async () => {
  const queue = [];
  const sql = [];

  await processMapResolve({
    queryOne: async () => '',
    queryMany: async () => [JSON.stringify({ id: 'i1', sku: null, product_name: 'Unknown', quantity: 1, uom: 'ea' })],
    exec: async (s) => { sql.push(s); },
    enqueue: async (p) => { queue.push(p); },
    mappingEnabled: true
  }, {
    job_type: 'MAP_RESOLVE',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: '22222222-2222-2222-2222-222222222222',
    platform_user_id: 'u1',
    zalo_msg_id: 'm1',
    correlation_id: 'c1',
    canonical_invoice_id: '33333333-3333-3333-3333-333333333333'
  });

  assert.ok(sql.some((s) => s.includes("'unresolved'")));
  assert.ok(queue.some((q) => q.template === 'mapping_needs_input'));
});

test('kiotviet sync happy path stores result and idempotency', async () => {
  const modeRef = { mode: 'success' };
  const stub = await startKvStub(modeRef);
  const sql = [];
  const adapter = new HttpKiotvietAdapter(stub.baseUrl, 'token', 1000);

  const deps = {
    queryOne: async (s) => {
      if (s.includes('FROM idempotency_keys')) return '';
      return '';
    },
    queryMany: async () => ['SKU1|2'],
    exec: async (s) => { sql.push(s); },
    adapter,
    syncEnabled: true,
    maxRetries: 2,
    backoffBaseMs: 1
  };

  const job = {
    job_type: 'KIOTVIET_SYNC',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: '22222222-2222-2222-2222-222222222222',
    platform_user_id: 'u1',
    zalo_msg_id: 'm1',
    correlation_id: 'c1',
    canonical_invoice_id: '33333333-3333-3333-3333-333333333333'
  };

  await processKiotvietSync(deps, job);
  assert.equal(stub.calls(), 1);
  assert.ok(sql.some((s) => s.includes('INSERT INTO idempotency_keys')));
  assert.ok(sql.some((s) => s.includes("'success'")));

  // replay: existing idempotency key should skip external call
  const depsReplay = {
    ...deps,
    queryOne: async (s) => (s.includes('FROM idempotency_keys') ? '{"already":true}' : '')
  };
  await processKiotvietSync(depsReplay, job);
  assert.equal(stub.calls(), 1);

  stub.server.close();
});

test('kiotviet sync retries 429 then succeeds', async () => {
  const modeRef = { mode: 'rate-then-success' };
  const stub = await startKvStub(modeRef);
  const sql = [];
  const adapter = new HttpKiotvietAdapter(stub.baseUrl, 'token', 1000);

  await processKiotvietSync({
    queryOne: async () => '',
    queryMany: async () => ['SKU1|1'],
    exec: async (s) => { sql.push(s); },
    adapter,
    syncEnabled: true,
    maxRetries: 3,
    backoffBaseMs: 1
  }, {
    job_type: 'KIOTVIET_SYNC',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: '22222222-2222-2222-2222-222222222222',
    platform_user_id: 'u1',
    zalo_msg_id: 'm1',
    correlation_id: 'c1',
    canonical_invoice_id: '33333333-3333-3333-3333-333333333333'
  });

  assert.equal(stub.calls(), 2);
  assert.ok(sql.some((s) => s.includes("'success'")));
  stub.server.close();
});

test('kiotviet sync decrypts active tenant secret in-memory and uses token header', async () => {
  const modeRef = { mode: 'success' };
  const stub = await startKvStub(modeRef);
  const mekB64 = Buffer.alloc(32, 9).toString('base64');
  const encrypted = encryptPayload(JSON.stringify({ token: 'secret-from-db' }), mekB64);
  const secretLine = `${encrypted.encryptedDek.toString('hex')}|${encrypted.encryptedValue.toString('hex')}|${encrypted.dekNonce.toString('hex')}|${encrypted.valueNonce.toString('hex')}`;

  await processKiotvietSync({
    queryOne: async (sql) => {
      if (sql.includes('FROM idempotency_keys')) return '';
      if (sql.includes('FROM secret_versions')) return secretLine;
      return '';
    },
    queryMany: async () => ['SKU1|1'],
    exec: async () => {},
    adapter: new HttpKiotvietAdapter(stub.baseUrl, 'fallback-token', 1000),
    syncEnabled: true,
    maxRetries: 1,
    backoffBaseMs: 1,
    mekB64
  }, {
    job_type: 'KIOTVIET_SYNC',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: '22222222-2222-2222-2222-222222222222',
    platform_user_id: 'u1',
    zalo_msg_id: 'm1',
    correlation_id: 'c1',
    canonical_invoice_id: '33333333-3333-3333-3333-333333333333'
  });

  assert.equal(stub.calls(), 1);
  assert.equal(stub.lastAuth(), 'Bearer secret-from-db');
  stub.server.close();
});

test('kiotviet sync fails safe when secret is revoked/missing', async () => {
  const modeRef = { mode: 'success' };
  const stub = await startKvStub(modeRef);
  const sql = [];

  await processKiotvietSync({
    queryOne: async (query) => {
      if (query.includes('FROM idempotency_keys')) return '';
      if (query.includes('FROM secret_versions')) return '';
      return '';
    },
    queryMany: async () => ['SKU1|1'],
    exec: async (statement) => { sql.push(statement); },
    adapter: new HttpKiotvietAdapter(stub.baseUrl, 'fallback-token', 1000),
    syncEnabled: true,
    maxRetries: 1,
    backoffBaseMs: 1,
    mekB64: Buffer.alloc(32, 9).toString('base64')
  }, {
    job_type: 'KIOTVIET_SYNC',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    inbound_event_id: '22222222-2222-2222-2222-222222222222',
    platform_user_id: 'u1',
    zalo_msg_id: 'm1',
    correlation_id: 'c1',
    canonical_invoice_id: '33333333-3333-3333-3333-333333333333'
  });

  assert.equal(stub.calls(), 0);
  assert.ok(sql.some((line) => line.includes('missing_active_secret')));
  stub.server.close();
});
