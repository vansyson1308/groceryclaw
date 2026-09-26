# Secrets Management

## Where secrets live
1. **n8n Credentials (preferred)**
   - Postgres credential
   - KiotViet API credential fields
   - Any webhook auth secrets
2. **Runtime environment variables** (`.env` in deployment, NOT git)
   - `ZALO_OA_SECRET`, `KIOTVIET_CLIENT_SECRET`, `OPENAI_API_KEY`, etc.
   - Telegram: `TELEGRAM_BOT_TOKEN` and, in webhook mode, `TELEGRAM_WEBHOOK_SECRET` (the gateway compares it in constant time with `X-Telegram-Bot-Api-Secret-Token`). `TELEGRAM_API_BASE_URL` is not a secret; it only overrides the Bot API root (the E2E gate points it at a local stub).

## Must NOT be committed
- Real API keys/tokens/secrets/passwords.
- Production `.env` files.
- Any raw token dump from logs.

## Rotation guidance
### Zalo
- Rotate OA secret in Zalo console.
- Update runtime secret store / env.
- Re-deploy n8n workers.
- Validate webhook signature checks immediately after rotation.

### KiotViet
- Rotate client secret in KiotViet portal.
- Update secret in credential store.
- Trigger token fetch workflow to verify.

### OpenAI/LLM
- Rotate API key in provider console.
- Update runtime secret and restart workers.

## Runtime hardening
- Restrict who can view n8n credentials.
- Enable n8n encrypted credential storage (`N8N_ENCRYPTION_KEY`).
- Use separate keys for dev/staging/prod.

## Incident playbook (suspected leak)
1. Revoke compromised secret immediately.
2. Rotate dependent credentials.
3. Search `ops_events` and workflow execution logs for misuse.
4. Review recent POs and pricing changes for abuse.
5. Document postmortem and add detection rule.


## CI/CD secrets
- Configure CI secrets in **GitHub Secrets** when needed.
- CI workflow in this repo does not require runtime secrets and must not echo secret values.

## ShopVoice MCP server secrets
- **MCP bearer tokens** (per tenant): minted with `node scripts/v2/create_mcp_token.mjs <tenant-uuid> [label]` or by `npm run db:v2:seed -- --demo`. The plaintext token is printed **once**; only its SHA-256 hash is stored (`mcp_access_tokens.token_hash`). Tokens are resolved by the SECURITY DEFINER function `resolve_mcp_access_token(hash)`.
- **Revocation:** `UPDATE mcp_access_tokens SET status='revoked', revoked_at=now() WHERE id = '<token id>';`. The server caches token lookups for `MCP_TOKEN_CACHE_SECONDS` (default 30s), so a revoked token stops working within that window.
- **`MCP_DEMO_TOKEN`**: optional fixed demo token (for reproducible demo recordings). Keep it in the local `.env` or the deployment secret store only, never in git.
- **Reorder confirmation tokens** are short-lived (`MCP_CONFIRM_TTL_SECONDS`, default 300s), stored hashed, and redacted from `voice_audit_log.args_redacted`.
- The MCP server never logs bearer tokens; the shared logger redacts `authorization` and `*token*` keys.

## ShopVoice simulator secrets
- **`SIM_MCP_TOKEN`**: the MCP bearer token the simulator uses to reach the MCP server (the demo tenant's token).
- **AWS credentials** for Bedrock and Polly: locally, use `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in `infra/compose/v2/.env` (git-ignored). On AWS, use the task role created by `infra/aws` (no static keys). The minimum IAM permissions are `bedrock:InvokeModel` on the configured model/inference profile and `polly:SynthesizeSpeech`.
- **`SIM_ACCESS_CODE`**: a passcode protecting `/api/*` on a public deployment, so strangers can't spend Bedrock/Polly credits. Share it with judges out of band.
- The Bedrock agent never sees reorder confirmation tokens: the simulator host holds them and injects them into `confirm_reorder` only after the owner says yes.

## AWS deployment secrets (infra/aws)
- Stored as SSM Parameter Store **SecureString** under `/shopvoice/<stage>/`: `mcp-demo-token`, `sim-access-code`, `origin-verify-secret`, `postgres-password`. `scripts/aws/deploy.sh` creates them with random values if they are missing. The EC2 instance role can read only that path, and the values are written to a root-only `.env` on the instance at boot.
- **`ORIGIN_VERIFY_SECRET`**: CloudFront adds it as the `X-Origin-Verify` origin header; the MCP server and simulator reject requests without it, so the EC2 origin can't be used to bypass CloudFront.
- Bedrock and Polly use the **instance role** (no static AWS keys on the instance).
- Rotation: `aws ssm put-parameter --overwrite ...`, then `scripts/aws/deploy.sh` (redeploys and re-reads parameters).
