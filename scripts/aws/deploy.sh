#!/usr/bin/env bash
# Deploy ShopVoice to AWS (CDK): EC2 + docker compose + CloudFront + SSM.
# Usage: scripts/aws/deploy.sh [--show-secrets]
# Env: AWS_REGION (default us-east-1), STAGE (default demo), GIT_REF (default: current pushed commit),
#      INSTANCE_TYPE (default t3.small), BEDROCK_MODEL_ID, POLLY_VOICE_ID, DEMO_ANCHOR_DATE.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REGION="${AWS_REGION:-us-east-1}"
STAGE="${STAGE:-demo}"
SSM_PATH="/shopvoice/${STAGE}"
SHOW_SECRETS=false
[[ "${1:-}" == "--show-secrets" ]] && SHOW_SECRETS=true

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1" >&2; exit 1; }; }
need aws; need node; need npm; need git; need openssl

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Deploying ShopVoice stage=${STAGE} to account ${ACCOUNT} region ${REGION}"

GIT_REF="${GIT_REF:-$(git -C "$ROOT" rev-parse HEAD)}"
if ! git -C "$ROOT" branch -r --contains "$GIT_REF" 2>/dev/null | grep -q .; then
  echo "warning: ${GIT_REF} is not on any remote branch; the instance clones from GitHub, so push it first." >&2
fi

ensure_param() {
  local name="$1" value
  if ! aws ssm get-parameter --region "$REGION" --name "${SSM_PATH}/${name}" >/dev/null 2>&1; then
    value="$2"
    aws ssm put-parameter --region "$REGION" --name "${SSM_PATH}/${name}" --type SecureString --value "$value" >/dev/null
    echo "created SSM parameter ${SSM_PATH}/${name}"
  fi
}
rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
ensure_param postgres-password "$(rand 32)"
ensure_param mcp-demo-token "sv_$(rand 43)"
ensure_param sim-access-code "$(rand 10)"
ensure_param origin-verify-secret "$(rand 40)"
get_param() { aws ssm get-parameter --region "$REGION" --with-decryption --name "${SSM_PATH}/$1" --query Parameter.Value --output text; }

cd "$ROOT/infra/aws"
npm ci --no-audit --no-fund
npx tsc
export CDK_DEFAULT_ACCOUNT="$ACCOUNT" CDK_DEFAULT_REGION="$REGION"
npx cdk bootstrap "aws://${ACCOUNT}/${REGION}" >/dev/null
npx cdk deploy "ShopVoice-${STAGE}" --require-approval never \
  -c stage="$STAGE" \
  -c gitRef="$GIT_REF" \
  -c originVerifySecret="$(get_param origin-verify-secret)" \
  -c instanceType="${INSTANCE_TYPE:-t3.small}" \
  -c bedrockModelId="${BEDROCK_MODEL_ID:-us.amazon.nova-2-lite-v1:0}" \
  -c pollyVoiceId="${POLLY_VOICE_ID:-Joanna}" \
  -c demoAnchorDate="${DEMO_ANCHOR_DATE:-}" \
  --outputs-file cdk-outputs.json

MCP_URL="$(node -e "const o=require('./cdk-outputs.json')['ShopVoice-${STAGE}'];console.log(o.McpUrl)")"
SIM_URL="$(node -e "const o=require('./cdk-outputs.json')['ShopVoice-${STAGE}'];console.log(o.SimulatorUrl)")"

echo "Waiting for the instance to finish bootstrapping (docker build + migrate + seed, ~5-10 min)..."
for _ in $(seq 1 90); do
  if curl -fsS "${SIM_URL}healthz" >/dev/null 2>&1 && curl -fsS "${MCP_URL%/mcp}/healthz" >/dev/null 2>&1; then
    READY=true; break
  fi
  sleep 10
done

echo
echo "MCP endpoint : ${MCP_URL}"
echo "Simulator    : ${SIM_URL}"
if [[ "${READY:-false}" != true ]]; then
  echo "Endpoints not healthy yet; check: aws ssm start-session --target <InstanceId>  (then: sudo tail -f /var/log/shopvoice-bootstrap.log)" >&2
fi
if $SHOW_SECRETS; then
  echo "MCP bearer   : $(get_param mcp-demo-token)"
  echo "Access code  : $(get_param sim-access-code)"
else
  echo "Secrets      : rerun with --show-secrets, or: aws ssm get-parameter --with-decryption --name ${SSM_PATH}/mcp-demo-token"
fi
