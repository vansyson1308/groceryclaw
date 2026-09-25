#!/usr/bin/env bash
# Post-deploy verification: e2e voice flow through the public simulator URL and
# p95 tool latency against the public MCP URL. Writes evidence JSON files.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REGION="${AWS_REGION:-us-east-1}"
STAGE="${STAGE:-demo}"
OUT="$ROOT/infra/aws/cdk-outputs.json"
MCP_URL="$(node -e "console.log(require('$OUT')['ShopVoice-${STAGE}'].McpUrl)")"
SIM_URL="$(node -e "console.log(require('$OUT')['ShopVoice-${STAGE}'].SimulatorUrl)")"
param() { aws ssm get-parameter --region "$REGION" --with-decryption --name "/shopvoice/${STAGE}/$1" --query Parameter.Value --output text; }
mkdir -p "$ROOT/docs/hackathon/evidence"
cd "$ROOT"
node scripts/demo/e2e_voice_flow.mjs --sim-url "${SIM_URL%/}" --access-code "$(param sim-access-code)" --json-out docs/hackathon/evidence/e2e-deployed.json
node scripts/demo/latency_probe.mjs --mcp-url "$MCP_URL" --token "$(param mcp-demo-token)" --rounds 21 --pace-ms 550 --json-out docs/hackathon/evidence/latency-deployed.json
