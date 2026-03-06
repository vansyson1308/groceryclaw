import test from 'node:test';
import assert from 'node:assert/strict';
import { runTenantScopedTransaction } from '../../packages/common/dist/index.js';

test('runTenantScopedTransaction uses one client with BEGIN -> SET LOCAL -> COMMIT order', async () => {
  const calls = [];
  const client = {
    async query(text, params = []) {
      calls.push({ text, params, client: 'shared' });
      if (text.includes('SELECT 42')) {
        return { rows: [{ c0: '42' }] };
      }
      return { rows: [] };
    },
    release() {
      calls.push({ text: 'RELEASE', params: [], client: 'shared' });
    }
  };

  const pool = {
    async connect() {
      calls.push({ text: 'CONNECT', params: [], client: 'shared' });
      return client;
    },
    async query() {
      return { rows: [] };
    },
    async end() {}
  };

  await runTenantScopedTransaction({
    pool,
    tenantId: '11111111-1111-1111-1111-111111111111',
    applicationName: 'worker:PROCESS_INBOUND_EVENT',
    work: async (txClient) => {
      await txClient.query('SELECT 42');
    }
  });

  assert.deepEqual(calls.map((c) => c.text), [
    'CONNECT',
    'BEGIN',
    "SELECT set_config('app.current_tenant', $1, true)",
    "SELECT set_config('application_name', $1, true)",
    'SELECT 42',
    'COMMIT',
    'RELEASE'
  ]);
});

test('runTenantScopedTransaction rolls back and releases client on error', async () => {
  const calls = [];
  const client = {
    async query(text, params = []) {
      calls.push({ text, params });
      if (text === 'SELECT explode') {
        throw new Error('boom');
      }
      return { rows: [] };
    },
    release() {
      calls.push({ text: 'RELEASE', params: [] });
    }
  };

  const pool = {
    async connect() {
      calls.push({ text: 'CONNECT', params: [] });
      return client;
    },
    async query() {
      return { rows: [] };
    },
    async end() {}
  };

  await assert.rejects(
    () => runTenantScopedTransaction({
      pool,
      tenantId: '11111111-1111-1111-1111-111111111111',
      applicationName: 'worker:PROCESS_INBOUND_EVENT',
      work: async (txClient) => {
        await txClient.query('SELECT explode');
      }
    }),
    /boom/
  );

  assert.deepEqual(calls.map((c) => c.text), [
    'CONNECT',
    'BEGIN',
    "SELECT set_config('app.current_tenant', $1, true)",
    "SELECT set_config('application_name', $1, true)",
    'SELECT explode',
    'ROLLBACK',
    'RELEASE'
  ]);
});
