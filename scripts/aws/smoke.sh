#!/usr/bin/env bash
# Post-deploy verification: OAuth discovery/401/pages (and, when the reviewer
# password is in SSM, the full OAuth flow with every tool), the e2e voice flow
# through the public simulator URL, and p95 tool latency. Writes evidence JSON.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REGION="${AWS_REGION:-us-east-1}"
STAGE="${STAGE:-demo}"
OUT="$ROOT/infra/aws/cdk-outputs.json"
MCP_URL="$(node -e "console.log(require('$OUT')['ShopVoice-${STAGE}'].McpUrl)")"
SIM_URL="$(node -e "console.log(require('$OUT')['ShopVoice-${STAGE}'].SimulatorUrl)")"
param() { aws ssm get-parameter --region "$REGION" --with-decryption --name "/shopvoice/${STAGE}/$1" --query Parameter.Value --output text; }
mkdir -p "$ROOT/docs/hackathon/evidence" "$ROOT/docs/directory/evidence"
cd "$ROOT"
BASE="${MCP_URL%/mcp}"
REVIEWER_EMAIL="${REVIEWER_EMAIL:-sonnv.hd34+shopvoice-reviewer@gmail.com}"
if PW="$(param reviewer-password 2>/dev/null)"; then
  PWFILE="$(mktemp)"; chmod 600 "$PWFILE"; printf '%s' "$PW" > "$PWFILE"; unset PW
  node scripts/directory/oauth_smoke.mjs --base-url "$BASE" --email "$REVIEWER_EMAIL" --password-file "$PWFILE" --json-out docs/directory/evidence/oauth-smoke-deployed.json || STATUS=1
  rm -f "$PWFILE"
else
  node scripts/directory/oauth_smoke.mjs --base-url "$BASE" --json-out docs/directory/evidence/oauth-smoke-deployed.json || STATUS=1
fi
node scripts/demo/e2e_voice_flow.mjs --sim-url "${SIM_URL%/}" --access-code "$(param sim-access-code)" --json-out docs/hackathon/evidence/e2e-deployed.json
node scripts/demo/latency_probe.mjs --mcp-url "$MCP_URL" --token "$(param mcp-demo-token)" --rounds 21 --pace-ms 550 --json-out docs/hackathon/evidence/latency-deployed.json
exit "${STATUS:-0}"
