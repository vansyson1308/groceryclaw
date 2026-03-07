import pg from 'pg';

export interface PgClientLike {
  query: (text: string, params?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  release: () => void;
}

export interface PgPoolLike {
  query: (text: string, params?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  connect: () => Promise<PgClientLike>;
  end: () => Promise<void>;
}

export interface CreatePgPoolOptions {
  readonly connectionString: string;
  readonly applicationName: string;
  readonly statementTimeoutMs?: number;
}

const CONNECTION_SEGMENT_PATTERN = /(postgres(?:ql)?:\/\/)([^\s@/]+)@/gi;

function redactText(value: string): string {
  return value.replace(CONNECTION_SEGMENT_PATTERN, '$1[REDACTED]@');
}

function assertPgPoolInitialized(pool: PgPoolLike | null | undefined): asserts pool is PgPoolLike {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new Error('db_pool_not_initialized');
  }
}

export function redactDbErrorMessage(message: string): string {
  return redactText(message);
}

export function sanitizeDbError(error: unknown): Error {
  const message = error instanceof Error ? error.message : 'unknown_db_error';
  return new Error(redactDbErrorMessage(message));
}

export async function createPgPool(options: CreatePgPoolOptions): Promise<PgPoolLike> {
  const statementTimeoutMs = options.statementTimeoutMs ?? 5000;
  const pgModule = await import('pg');
  // ESM/CommonJS interop: pg is a CommonJS module, need to handle both .Pool and .default?.Pool
  const Pool = pgModule.Pool || pgModule.default?.Pool;
  if (!Pool) {
    throw new Error('pg.Pool is not available - possible ESM/CommonJS interop issue');
  }
  const pool = new Pool({
    connectionString: options.connectionString,
    application_name: options.applicationName,
    statement_timeout: statementTimeoutMs,
    query_timeout: statementTimeoutMs
  });

  return pool as unknown as PgPoolLike;
}

export async function query(
  pool: Pick<PgPoolLike, 'query'>,
  text: string,
  params: readonly unknown[] = []
): Promise<{ rows: Record<string, unknown>[] }> {
  if (!pool) {
    throw new Error('Database pool is not initialized. Cannot execute query.');
  }
  if (!pool.query) {
    throw new Error('Database pool is invalid. Missing query method.');
  }
  try {
    return await pool.query(text, params);
  } catch (error) {
    throw sanitizeDbError(error);
  }
}

export async function closePool(pool: Pick<PgPoolLike, 'end'>): Promise<void> {
  await pool.end();
}

export async function dbPing(pool: Pick<PgPoolLike, 'query'>, timeoutMs = 500): Promise<boolean> {
  try {
    const timed = await Promise.race([
      query(pool, 'SELECT 1 AS ok'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('db_ping_timeout')), timeoutMs))
    ]);
    return (timed.rows[0]?.ok as number | undefined) === 1;
  } catch {
    return false;
  }
}

export async function runTenantScopedTransaction<T>(opts: {
  readonly pool: PgPoolLike;
  readonly tenantId: string;
  readonly applicationName?: string;
  readonly work: (client: Pick<PgClientLike, 'query'>) => Promise<T>;
}): Promise<T> {
  if (!opts.pool) {
    throw new Error('Database pool is not initialized. Cannot run tenant-scoped transaction.');
  }
  const client = await opts.pool.connect();
  try {
    await query(client, 'BEGIN');
    await query(client, "SELECT set_config('app.current_tenant', $1, true)", [opts.tenantId]);
    if (opts.applicationName) {
      await query(client, "SELECT set_config('application_name', $1, true)", [opts.applicationName]);
    }
    const result = await opts.work(client);
    await query(client, 'COMMIT');
    return result;
  } catch (error) {
    try {
      await query(client, 'ROLLBACK');
    } catch {
      // ignore rollback failure and keep original error
    }
    throw sanitizeDbError(error);
  } finally {
    client.release();
  }
}
