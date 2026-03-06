import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

const composeFile = 'infra/compose/v2/docker-compose.yml';
const envFile = 'infra/compose/v2/.env.real-db-test';
const useExistingDb = process.env.REAL_DB_TESTS_USE_EXISTING_DB === 'true';

function run(cmd, env = process.env) {
  const result = spawnSync('bash', ['-lc', cmd], { stdio: 'inherit', env });
  if (result.status !== 0) {
    throw new Error(`command failed: ${cmd}`);
  }
}

function compose(cmd, envPath = envFile) {
  run(`docker compose --env-file ${envPath} -f ${composeFile} ${cmd}`);
}

function makeEnv() {
  const content = [
    'NODE_ENV=test',
    'LOG_LEVEL=info',
    'POSTGRES_DB=groceryclaw_v2_real_test',
    'POSTGRES_SUPERUSER=postgres',
    'POSTGRES_SUPERUSER_PASSWORD=postgres',
    'APP_DB_USER=app_user',
    'APP_DB_PASSWORD=change_me',
    'REDIS_PASSWORD=change_me',
    'DB_APP_URL=postgresql://app_user:change_me@127.0.0.1:5432/groceryclaw_v2_real_test',
    'DB_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:5432/groceryclaw_v2_real_test',
    'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/groceryclaw_v2_real_test'
  ].join('\n');
  writeFileSync(envFile, `${content}\n`);
}

async function main() {
  if (useExistingDb) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required when REAL_DB_TESTS_USE_EXISTING_DB=true');
    }
    run('npm run db:v2:migrate');
    run('npm run test:v2:db:real');
    return;
  }

  makeEnv();

  try {
    compose('up -d postgres');
    run('npm run db:v2:migrate', {
      ...process.env,
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/groceryclaw_v2_real_test'
    });
    run('npm run test:v2:db:real', {
      ...process.env,
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/groceryclaw_v2_real_test'
    });
  } finally {
    try {
      compose('down -v --remove-orphans');
    } finally {
      try {
        unlinkSync(envFile);
      } catch {
        // no-op
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
