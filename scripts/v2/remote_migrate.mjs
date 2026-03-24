/**
 * Remote migration script — runs migrations directly via pg client
 * without needing psql CLI or Docker.
 *
 * Usage: DATABASE_URL=postgresql://... node scripts/v2/remote_migrate.mjs
 */
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const { Client } = pg;
const MIGRATIONS_DIR = 'db/v2/migrations';
const DB_URL = process.env.DATABASE_URL || process.env.DB_APP_URL;

if (!DB_URL) {
  console.error('ERROR: DATABASE_URL or DB_APP_URL env var required');
  process.exit(1);
}

function splitMigration(content, fileName) {
  const upPos = content.indexOf('-- migrate:up');
  const downPos = content.indexOf('-- migrate:down');
  if (upPos === -1 || downPos === -1 || downPos <= upPos) {
    throw new Error(`Migration ${fileName} must contain -- migrate:up and -- migrate:down`);
  }
  return {
    up: content.slice(upPos + '-- migrate:up'.length, downPos).trim(),
    down: content.slice(downPos + '-- migrate:down'.length).trim()
  };
}

async function main() {
  // Internal K8s URLs (.svc.cluster.local) don't use SSL;
  // external connections may need it — auto-detect based on hostname.
  const isInternal = DB_URL.includes('.svc.cluster.local') || DB_URL.includes('localhost') || DB_URL.includes('127.0.0.1');
  const sslConfig = isInternal ? false : { rejectUnauthorized: false };
  const client = new Client({ connectionString: DB_URL, ssl: sslConfig });
  await client.connect();
  console.log('Connected to database.');

  // Create migrations table if not exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS v2_schema_migrations (
      filename    TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Get already applied migrations
  const { rows: applied } = await client.query(
    'SELECT filename FROM v2_schema_migrations ORDER BY filename'
  );
  const appliedSet = new Set(applied.map(r => r.filename));

  // Get migration files
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`  SKIP  ${file} (already applied)`);
      continue;
    }

    const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const { up } = splitMigration(content, file);
    const checksum = createHash('sha256').update(up).digest('hex').slice(0, 16);

    console.log(`  RUN   ${file} ...`);
    try {
      await client.query(up);
      await client.query(
        'INSERT INTO v2_schema_migrations (filename, checksum) VALUES ($1, $2)',
        [file, checksum]
      );
      console.log(`  OK    ${file}`);
      count++;
    } catch (err) {
      console.error(`  FAIL  ${file}: ${err.message}`);
      await client.end();
      process.exit(1);
    }
  }

  console.log(`\nDone. ${count} migration(s) applied, ${appliedSet.size} already up-to-date.`);
  await client.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
