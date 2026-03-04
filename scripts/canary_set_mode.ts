#!/usr/bin/env node

type Mode = 'legacy' | 'v2';

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const baseUrl = getArg('--base-url') ?? process.env.ADMIN_BASE_URL ?? 'http://127.0.0.1:3001';
  const token = getArg('--token') ?? process.env.ADMIN_BEARER_TOKEN ?? '';
  const mode = (getArg('--mode') ?? 'legacy') as Mode;
  const tenantCsv = getArg('--tenants') ?? '';
  const apply = hasFlag('--apply');

  if (!tenantCsv.trim()) {
    throw new Error('missing --tenants <id1,id2,...>');
  }
  if (!['legacy', 'v2'].includes(mode)) {
    throw new Error('invalid --mode, expected legacy|v2');
  }

  const tenantIds = tenantCsv.split(',').map((x) => x.trim()).filter(Boolean);
  const plan = { baseUrl, mode, tenant_count: tenantIds.length, tenants: tenantIds, apply };

  if (!apply) {
    console.log(JSON.stringify({ dry_run: true, action: 'set_processing_mode', ...plan }, null, 2));
    return;
  }

  if (!token) {
    throw new Error('missing admin token (use --token or ADMIN_BEARER_TOKEN)');
  }

  const results: Array<Record<string, unknown>> = [];
  for (const tenantId of tenantIds) {
    const res = await fetch(`${baseUrl}/tenants/${tenantId}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ processing_mode: mode })
    });

    const body = await res.json().catch(() => ({}));
    results.push({ tenant_id: tenantId, status: res.status, body });
  }

  console.log(JSON.stringify({ dry_run: false, action: 'set_processing_mode', mode, results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
