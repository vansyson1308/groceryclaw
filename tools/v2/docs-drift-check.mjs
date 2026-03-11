import { readFileSync } from 'node:fs';

const checks = [
  {
    file: 'ARCHITECTURE_V2.md',
    deny: ['Fastify 5', 'GET /health\u0020—', 'BullMQ 5 + Redis 7'],
    require: ['node:http', 'GET /healthz', 'GET /readyz', 'bullmq-lite']
  },
  {
    file: 'MASTER_DESIGN_PACK.md',
    deny: ['Fastify routing + schema validation', 'Enqueue BullMQ job', 'Fastify over Express'],
    require: ['Node `http` routing + schema validation', 'Enqueue Redis queue job', 'Redis list queue (`bullmq-lite`)']
  },
  {
    file: 'docs/saas_v2/DOCS_TO_CODE_MAP.md',
    deny: [],
    require: ['apps/gateway/src/server.ts', 'apps/admin/src/server.ts', 'apps/worker/src/health-server.ts']
  }
];

let failed = false;
for (const check of checks) {
  const text = readFileSync(check.file, 'utf8');
  for (const token of check.deny) {
    if (text.includes(token)) {
      console.error(`[docs-drift] forbidden token found in ${check.file}: ${token}`);
      failed = true;
    }
  }
  for (const token of check.require) {
    if (!text.includes(token)) {
      console.error(`[docs-drift] required token missing in ${check.file}: ${token}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log('Docs drift check passed.');
