#!/usr/bin/env bash
# Destroy the ShopVoice AWS stack (stops all charges except SSM parameters, which are free).
# Usage: scripts/aws/teardown.sh [--purge-secrets]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REGION="${AWS_REGION:-us-east-1}"
STAGE="${STAGE:-demo}"

cd "$ROOT/infra/aws"
[[ -d node_modules ]] || npm ci --no-audit --no-fund
npx tsc
export CDK_DEFAULT_REGION="$REGION" CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
npx cdk destroy "ShopVoice-${STAGE}" --force -c stage="$STAGE"

if [[ "${1:-}" == "--purge-secrets" ]]; then
  for p in postgres-password mcp-demo-token sim-access-code origin-verify-secret; do
    aws ssm delete-parameter --region "$REGION" --name "/shopvoice/${STAGE}/${p}" 2>/dev/null && echo "deleted /shopvoice/${STAGE}/${p}" || true
  done
fi
echo "ShopVoice-${STAGE} destroyed."
