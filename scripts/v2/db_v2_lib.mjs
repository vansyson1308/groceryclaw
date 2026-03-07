import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const MIGRATIONS_DIR = 'db/v2/migrations';

function hasCommand(cmd) {
  const result = spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' });
  return result.status === 0;
}

function shell(sql) {
  if (process.env.DB_V2_PSQL_CMD) {
    return process.env.DB_V2_PSQL_CMD;
  }

  if (hasCommand('psql')) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required when using psql directly.');
    }
    return `psql "${process.env.DATABASE_URL}" -v ON_ERROR_STOP=1 -q -t -A -f -`;
  }

  if (hasCommand('docker')) {
    return [
      'docker compose',
      '--env-file infra/compose/v2/.env',
      '-f infra/compose/v2/docker-compose.yml',
      'exec -T postgres',
      "psql -U postgres -d groceryclaw_v2 -v ON_ERROR_STOP=1 -q -t -A -f -"
    ].join(' ');
  }

  throw new Error('No SQL execution method found. Install psql or docker, or set DB_V2_PSQL_CMD.');
}

export function splitMigration(content, fileName) {
  const markerUp = '-- migrate:up';
  const markerDown = '-- migrate:down';

  const upPos = content.indexOf(markerUp);
  const downPos = content.indexOf(markerDown);
  if (upPos === -1 || downPos === -1 || downPos <= upPos) {
    throw new Error(`Migration ${fileName} must contain -- migrate:up and -- migrate:down sections.`);
  }

  return {
    up: content.slice(upPos + markerUp.length, downPos).trim(),
    down: content.slice(downPos + markerDown.length).trim()
  };
}

export function migrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Missing migrations directory: ${MIGRATIONS_DIR}`);
  }

  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

export function migrationChecksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function runSql(sql) {
  const cmd = shell(sql);
  const result = spawnSync('bash', ['-lc', cmd], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'SQL execution failed');
  }

  return result.stdout.trim();
}

export function ensureMigrationsTable() {
  runSql(`
    CREATE TABLE IF NOT EXISTS schema_migrations_v2 (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export function readMigration(name) {
  const filePath = join(MIGRATIONS_DIR, name);
  const content = readFileSync(filePath, 'utf8');
  return {
    name,
    filePath,
    content,
    checksum: migrationChecksum(content),
    ...splitMigration(content, name)
  };
}

export function appliedMigrations() {
  const out = runSql(`
    SELECT name || ',' || checksum
    FROM schema_migrations_v2
    ORDER BY id ASC;
  `);

  if (!out) {
    return [];
  }

  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, checksum] = line.split(',');
      return { name, checksum };
    });
}
