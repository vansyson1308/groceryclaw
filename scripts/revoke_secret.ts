#!/usr/bin/env node

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
  const tenantId = getArg('--tenant-id') ?? '';
  const secretId = getArg('--secret-id') ?? '';
  const apply = hasFlag('--apply');

  if (!tenantId || !secretId) {
    throw new Error('missing --tenant-id and/or --secret-id');
  }

  if (!apply) {
    console.log(JSON.stringify({ dry_run: true, action: 'revoke_secret', baseUrl, tenant_id: tenantId, secret_id: secretId }, null, 2));
    return;
  }

  if (!token) {
    throw new Error('missing admin token (use --token or ADMIN_BEARER_TOKEN)');
  }

  const res = await fetch(`${baseUrl}/tenants/${tenantId}/secrets/${secretId}/revoke`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await res.json().catch(() => ({}));
  console.log(JSON.stringify({ dry_run: false, action: 'revoke_secret', status: res.status, body }, null, 2));

  if (res.status >= 400) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
