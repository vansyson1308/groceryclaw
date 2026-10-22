// Superuser connection settings for the deploy scripts (db_prepare, reseed).
// Render passes split variables; DATABASE_URL also works for local runs.
import pg from 'pg';

export function adminConnectionString(env = process.env) {
  if (env.DEPLOY_ADMIN_DATABASE_URL) return env.DEPLOY_ADMIN_DATABASE_URL;
  const host = env.PGHOST;
  const password = env.POSTGRES_PASSWORD;
  if (host && password) {
    const user = env.POSTGRES_USER || 'postgres';
    const port = env.PGPORT || '5432';
    const db = env.POSTGRES_DB || 'shopvoice';
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(db)}`;
  }
  if (env.DATABASE_URL) return env.DATABASE_URL;
  throw new Error('Set PGHOST + POSTGRES_PASSWORD (+ POSTGRES_USER, POSTGRES_DB, PGPORT) or DATABASE_URL for the superuser connection');
}

/** Connects, retrying until `timeoutMs`: on first boot the private Postgres service may still be starting. */
export async function connectWithRetry(connectionString, { timeoutMs = 60_000, intervalMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      if (Date.now() >= deadline) throw new Error(`database not reachable after ${Math.round(timeoutMs / 1000)} s: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

/** YYYY-MM-DD for "now" in an IANA time zone. */
export function todayIn(timeZone = 'Asia/Ho_Chi_Minh', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
