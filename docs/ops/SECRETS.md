# Secrets Management

## Where secrets live
1. **n8n Credentials (preferred)**
   - Postgres credential
   - KiotViet API credential fields
   - Any webhook auth secrets
2. **Runtime environment variables** (`.env` in deployment, NOT git)
   - `ZALO_OA_SECRET`, `KIOTVIET_CLIENT_SECRET`, `OPENAI_API_KEY`, etc.

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
