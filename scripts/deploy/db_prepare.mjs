#!/usr/bin/env node
// Render pre-deploy command for the MCP server (idempotent):
//   1. wait for Postgres;  2. apply pending migrations (superuser);
//   3. ensure the runtime login role (RLS-bound, no BYPASSRLS);
//   4. seed the demo shop if it has no profile yet;  5. register the demo tokens.
// Prints step names and counts only, never a password or token.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { adminConnectionString, connectWithRetry, todayIn } from './pg_admin.mjs';
import { registerDemoTokens } from './demo_tokens.mjs';
import { reseedDemo } from './reseed_demo.mjs';
import { DEMO_TENANT_ID } from '../v2/gen_demo_seed.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function runMigrations(connectionString) {
  const result = spawnSync(process.execPath, ['scripts/v2/remote_migrate.mjs'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: connectionString, DB_APP_URL: '' },
    encoding: 'utf8'
  });
  const applied = (result.stdout.match(/^ {2}OK /gm) ?? []).length;
  if (result.status !== 0) {
    const failed = (result.stdout + result.stderr).split('\n').find((l) => l.includes('FAIL')) ?? 'see logs';
    throw new Error(`migrations failed: ${failed.trim()}`);
  }
  return applied;
}

/** CREATE/ALTER the runtime role; name and password go through format('%I'/'%L'), never JS interpolation. */
export async function ensureRuntimeRole(client, role, password) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role ?? '')) throw new Error('MCP_DB_USER must be a lowercase Postgres identifier');
  if (!password || password.length < 16) throw new Error('MCP_DB_PASSWORD must be at least 16 characters');
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('deploy.role', $1, true), set_config('deploy.password', $2, true)", [role, password]);
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_setting('deploy.role')) THEN
        EXECUTE format('CREATE ROLE %I LOGIN', current_setting('deploy.role'));
      END IF;
      EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB',
                     current_setting('deploy.role'), current_setting('deploy.password'));
      EXECUTE format('GRANT groceryclaw_app_user TO %I', current_setting('deploy.role'));
    END $$`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function prepareDatabase({ env = process.env, log = console.log } = {}) {
  const connectionString = adminConnectionString(env);
  const client = await connectWithRetry(connectionString);
  try {
    log('db_prepare: database reachable');
    log(`db_prepare: migrations applied: ${runMigrations(connectionString)}`);
    await ensureRuntimeRole(client, env.MCP_DB_USER, env.MCP_DB_PASSWORD);
    log('db_prepare: runtime role ready (NOSUPERUSER NOBYPASSRLS)');
    const { rows } = await client.query('SELECT 1 FROM shop_profiles WHERE tenant_id = $1', [DEMO_TENANT_ID]);
    if (rows.length === 0) {
      const today = todayIn(env.DEMO_SHOP_TIMEZONE || 'Asia/Ho_Chi_Minh');
      await reseedDemo(client, { today, env });
      log(`db_prepare: demo shop seeded for ${today}`);
    } else {
      log('db_prepare: demo shop present');
    }
    const tokens = await registerDemoTokens(client, env);
    log(`db_prepare: demo tokens registered: ${tokens.map((t) => `${t.label} (${t.scopes})`).join(', ') || 'none'}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  prepareDatabase().catch((error) => {
    console.error(`db_prepare failed: ${error.message}`);
    process.exit(1);
  });
}
