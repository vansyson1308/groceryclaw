import { Token } from 'aws-cdk-lib';

export interface UserDataOptions {
  readonly repoUrl: string;
  readonly gitRef: string;
  readonly ssmPath: string;
  readonly region: string;
  readonly logGroup: string;
  readonly bedrockModelId: string;
  readonly pollyVoiceId: string;
  readonly demoAnchorDate: string;
}

const SAFE = /^[A-Za-z0-9._:/@+\-]*$/;

function safe(name: string, value: string): string {
  // CDK tokens (e.g. the deploy region) resolve to plain identifiers in CloudFormation.
  if (Token.isUnresolved(value)) return value;
  if (!SAFE.test(value)) throw new Error(`${name} contains unsupported characters: ${value}`);
  return value;
}

/**
 * Boot script for Amazon Linux 2023: install Docker + compose, clone the repo
 * at the requested ref, render the runtime .env from SSM Parameter Store,
 * start the stack, migrate + seed, and schedule a nightly demo re-seed so
 * "today" always has data. Values are validated (no shell metacharacters).
 */
export function renderUserData(o: UserDataOptions): string {
  const repo = safe('repoUrl', o.repoUrl);
  const ref = safe('gitRef', o.gitRef);
  const path = safe('ssmPath', o.ssmPath);
  const region = safe('region', o.region);
  const logGroup = safe('logGroup', o.logGroup);
  const model = safe('bedrockModelId', o.bedrockModelId);
  const voice = safe('pollyVoiceId', o.pollyVoiceId);
  const anchor = safe('demoAnchorDate', o.demoAnchorDate);
  return `#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/shopvoice-bootstrap.log) 2>&1

dnf install -y docker git cronie jq
systemctl enable --now docker crond
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-x86_64 \\
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

APP=/opt/shopvoice
rm -rf "$APP"
git clone ${repo} "$APP"
git -C "$APP" checkout ${ref}

ENV_FILE="$APP/infra/aws/runtime.env"
umask 077
param() { aws ssm get-parameter --region ${region} --with-decryption --name "${path}$1" --query Parameter.Value --output text; }
{
  echo "AWS_REGION=${region}"
  echo "LOG_GROUP=${logGroup}"
  echo "BEDROCK_MODEL_ID=${model}"
  echo "POLLY_VOICE_ID=${voice}"
  echo "DEMO_ANCHOR_DATE=${anchor}"
  echo "POSTGRES_PASSWORD=$(param postgres-password)"
  echo "APP_DB_PASSWORD=$(param postgres-password)"
  echo "MCP_DEMO_TOKEN=$(param mcp-demo-token)"
  echo "SIM_ACCESS_CODE=$(param sim-access-code)"
  echo "ORIGIN_VERIFY_SECRET=$(param origin-verify-secret)"
} > "$ENV_FILE"

COMPOSE="docker compose --env-file $ENV_FILE -f $APP/infra/aws/compose.aws.yml"
$COMPOSE up -d --build postgres mcp-server alexa-sim
$COMPOSE --profile ops run --rm ops

cat > /etc/cron.d/shopvoice-reseed <<CRON
# 00:05 Asia/Ho_Chi_Minh = 17:05 UTC: re-seed the demo shop so "today" has data.
5 17 * * * root $COMPOSE --profile ops run --rm ops >> /var/log/shopvoice-reseed.log 2>&1
CRON
echo "ShopVoice bootstrap complete"
`;
}
