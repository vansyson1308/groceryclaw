# ShopVoice: deployment (Claude connector + Devpost)

**Status (2026-09-27): not deployed yet.** The AWS credentials in the working environment are rejected (`InvalidClientTokenId`; `BLOCKERS.md` DB1). Everything below has been synthesized (`cdk synth`) and rehearsed locally: the same server and the same Postgres migrations, run as the least-privilege runtime role. Evidence is in `evidence/oauth-smoke-local-postgres.json` and `evidence/inspector-oauth-local-*`. The deployed URLs go in the table at the end once `deploy.sh` has run.

## What gets deployed

One CDK stack, `ShopVoice-<stage>` (`infra/aws`), runs about $20 a month in `us-east-1`:

| Resource | Purpose |
|---|---|
| EC2 `t3.small`, Amazon Linux 2023, 30 GB gp3 (encrypted), IMDSv2 | Runs docker compose: Postgres 16, the MCP server with OAuth and pages, and the voice simulator |
| CloudFront distribution **MCP** | `https://<host>`: `/mcp`, `/.well-known/*`, `/oauth/*`, `/account`, `/docs`, `/privacy`, `/terms`, `/support`, `/icon*`. `/oauth/*` and `/account*` forward cookies and are never cached. `/.well-known/*` is served at the domain root. HTTP redirects to HTTPS |
| CloudFront distribution **Sim** | Voice simulator for the Devpost demo |
| SSM parameters `/shopvoice/<stage>/*` | Secrets as SecureString: postgres-password, mcp-demo-token, sim-access-code, origin-verify-secret, oauth-cookie-secret, invite-pepper-b64 and reviewer-password. `public-base-url` is written by the stack |
| S3 bucket (Backups) | Daily `pg_dump` at 01:15 Vietnam time, deleted after 7 days |
| CloudWatch | Logs kept 14 days. Alarms: EC2 system check (auto-recovers the instance), Route 53 health check on `/healthz`, and CloudFront 5xx rate above 5%. All go to an SNS topic emailed to `ALARM_EMAIL` |

The instance cannot know the CloudFront hostname when it boots, so it waits for the SSM parameter `public-base-url` and uses it as `PUBLIC_BASE_URL`. That value is the OAuth issuer, and `PUBLIC_BASE_URL/mcp` is the token audience. Switching to a custom domain changes this one value.

## One-time owner setup

Click-by-click version for Claude in Chrome, in Vietnamese, with a keyless AWS CloudShell fallback: `AWS_SETUP_CHROME.md`.

1. Create an IAM user `shopvoice-deploy` (never root) with programmatic access. Attach policies covering CloudFormation, EC2, CloudFront, S3, SSM, IAM (role/instance-profile creation), CloudWatch/Logs, SNS, Route 53 health checks, Lambda (the S3 auto-delete custom resource), and read access to STS. For a short-lived hackathon account, `AdministratorAccess` on this user is the simplest choice; delete the key afterwards.
2. Put the key in the environment where the deploy runs: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION=us-east-1`.
3. **Domain (optional, recommended before submitting to the directory):** see *Custom domain* below. Decide this **before** submitting. The directory listing, the plugin's `.mcp.json` and every user's OAuth tokens are bound to the URL.

## Deploy

```bash
SUPPORT_EMAIL=sonnv.hd34@gmail.com ALARM_EMAIL=sonnv.hd34@gmail.com \
  scripts/aws/deploy.sh            # 10-15 min; prints MCP URL, pages, simulator URL
# optional custom domain (certificate must be ISSUED first):
DOMAIN_NAME=shopvoice.example CERTIFICATE_ARN=arn:aws:acm:us-east-1:...:certificate/... \
SUPPORT_EMAIL=... scripts/aws/deploy.sh
```

Confirm the SNS subscription email ("AWS Notification - Subscription Confirmation") to receive alarms.

## Reviewer account (directory review)

```bash
BASE=$(node -e "console.log(require('./infra/aws/cdk-outputs.json')['ShopVoice-demo'].PublicBaseUrlOutput)")
node scripts/directory/create_reviewer.mjs --base-url "$BASE" \
  --email sonnv.hd34+shopvoice-reviewer@gmail.com --ssm-name /shopvoice/demo/reviewer-password
```

This signs up through the public form, so the account gets the fully populated demo shop that refreshes daily, and then signs in again to prove the password works. The password is written **only** to SSM and is never printed. The owner reads it when filling in the portal:
`aws ssm get-parameter --with-decryption --name /shopvoice/demo/reviewer-password --query Parameter.Value --output text`.

## Verify (writes evidence)

```bash
scripts/aws/smoke.sh     # OAuth discovery, 401, pages, full OAuth flow with every tool (reviewer), e2e voice, latency
PW=$(mktemp) && aws ssm get-parameter --with-decryption --name /shopvoice/demo/reviewer-password --query Parameter.Value --output text > "$PW"
node scripts/directory/inspector_oauth_evidence.mjs --server-url "$BASE/mcp" --email sonnv.hd34+shopvoice-reviewer@gmail.com --password-file "$PW" --label deployed
rm -f "$PW"
node scripts/demo/inspector_evidence.mjs --server-url "$BASE/mcp" --token "$(aws ssm get-parameter --with-decryption --name /shopvoice/demo/mcp-demo-token --query Parameter.Value --output text)" --label deployed   # Devpost (bearer)
curl -i "$BASE/mcp" -X POST -H 'content-type: application/json' -d '{}'   # expect 401 + WWW-Authenticate resource_metadata
```

## Custom domain

1. Buy a domain, for example `shopvoice.app`.
2. In **ACM, region us-east-1**, request a public certificate for `shopvoice.app`, or a subdomain such as `mcp.shopvoice.app`, with DNS validation. Add the validation record ACM shows:
   - Type `CNAME`
   - Name `_xxxxxxxx.shopvoice.app.`
   - Value `_yyyyyyyy.acm-validations.aws.`
3. Wait for the certificate to show **Issued**, then deploy with `DOMAIN_NAME` and `CERTIFICATE_ARN` as above.
4. Add the traffic record that `deploy.sh` prints:
   - Type `CNAME`
   - Name `mcp` (for a subdomain)
   - Value `<CloudFrontDomain output>`, for example `d1234abcd.cloudfront.net`
   - For the zone apex, use your DNS provider's ALIAS/ANAME, or Route 53's A-alias, to the same CloudFront name.
5. Check the new URL:
   - `curl -s https://<domain>/.well-known/oauth-protected-resource/mcp` shows `"resource":"https://<domain>/mcp"`;
   - `scripts/aws/smoke.sh` passes.

After a domain change, existing connections must reconnect: their tokens were issued for the old URL.

## Update / teardown

- Redeploy after new commits: `GIT_REF=<pushed sha> scripts/aws/deploy.sh`. The instance is replaced. Postgres data lives on the instance volume, so restore from the latest S3 dump if you need to keep accounts:
  - `aws s3 cp s3://<BackupBucket>/postgres/<file>.sql.gz - | gunzip | docker compose ... exec -T postgres psql -U postgres groceryclaw_v2`
- Stop all charges: `scripts/aws/teardown.sh`. Add `--purge-secrets` to also delete the SSM parameters.

## Deployed URLs

| What | URL |
|---|---|
| MCP server (connector URL) | _pending deploy_ |
| Docs | _pending deploy_ (`/docs`) |
| Privacy policy | _pending deploy_ (`/privacy`) |
| Terms | _pending deploy_ (`/terms`) |
| Support | _pending deploy_ (`/support`) |
| Voice simulator (Devpost) | _pending deploy_ |
