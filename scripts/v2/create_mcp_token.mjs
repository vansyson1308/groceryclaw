#!/usr/bin/env node
// Mint a ShopVoice MCP bearer token for a tenant.
// Usage: DATABASE_URL=... node scripts/v2/create_mcp_token.mjs <tenant-uuid> [label] [--read-only]
// The token is printed once; only its SHA-256 hash is stored in mcp_access_tokens.
import { mintMcpToken } from './mcp_token_lib.mjs';

const args = process.argv.slice(2);
const readOnly = args.includes('--read-only');
const [tenantId, label = readOnly ? 'cli-read-only' : 'cli'] = args.filter((a) => a !== '--read-only');
if (!tenantId) {
  console.error('usage: node scripts/v2/create_mcp_token.mjs <tenant-uuid> [label] [--read-only]');
  process.exit(1);
}

const { token } = mintMcpToken({ tenantId, label, readOnly });
console.log(token);
