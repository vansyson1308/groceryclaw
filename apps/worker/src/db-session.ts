export interface DbSessionExecutor {
  runSql: (sql: string) => Promise<void>;
}

export async function runTenantScopedTransaction<T>(opts: {
  readonly db: DbSessionExecutor;
  readonly tenantId: string;
  readonly jobType: string;
  readonly work: () => Promise<T>;
}): Promise<T> {
  await opts.db.runSql('BEGIN;');
  try {
    await opts.db.runSql(`SET LOCAL app.current_tenant = '${opts.tenantId.replace(/'/g, "''")}';`);
    await opts.db.runSql(`SET LOCAL application_name = 'worker:${opts.jobType.replace(/'/g, "''")}';`);
    const result = await opts.work();
    await opts.db.runSql('COMMIT;');
    return result;
  } catch (error) {
    await opts.db.runSql('ROLLBACK;');
    throw error;
  }
}
