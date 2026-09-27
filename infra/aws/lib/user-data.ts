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
  readonly supportEmail: string;
  readonly backupBucket: string;
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
  const support = safe('supportEmail', o.supportEmail);
  const bucket = safe('backupBucket', o.backupBucket);
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
# public-base-url is written by the stack after the CloudFront distribution exists.
for _ in $(seq 1 120); do
  PUBLIC_BASE_URL="$(param public-base-url 2>/dev/null || true)"
  [ -n "$PUBLIC_BASE_URL" ] && break
  sleep 10
done
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
  echo "PUBLIC_BASE_URL=$PUBLIC_BASE_URL"
  echo "OAUTH_COOKIE_SECRET=$(param oauth-cookie-secret)"
  echo "INVITE_PEPPER_B64=$(param invite-pepper-b64)"
  echo "SUPPORT_EMAIL=${support}"
} > "$ENV_FILE"

COMPOSE="docker compose --env-file $ENV_FILE -f $APP/infra/aws/compose.aws.yml"
$COMPOSE up -d --build postgres mcp-server alexa-sim
$COMPOSE --profile ops run --rm ops

cat > /etc/cron.d/shopvoice-reseed <<CRON
# 00:05 Asia/Ho_Chi_Minh = 17:05 UTC: re-seed the demo shop so "today" has data.
5 17 * * * root $COMPOSE --profile ops run --rm ops >> /var/log/shopvoice-reseed.log 2>&1
CRON

cat > /etc/cron.d/shopvoice-backup <<CRON
# 01:15 Asia/Ho_Chi_Minh = 18:15 UTC: pg_dump to S3 (the bucket expires objects after 7 days).
15 18 * * * root $COMPOSE exec -T postgres pg_dump -U postgres -d groceryclaw_v2 | gzip | aws s3 cp - s3://${bucket}/postgres/groceryclaw_v2-\\$(date -u +\\%Y-\\%m-\\%d).sql.gz --region ${region} >> /var/log/shopvoice-backup.log 2>&1
CRON
echo "ShopVoice bootstrap complete"
`;
}
