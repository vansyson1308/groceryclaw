# ShopVoice on the Claude directory: blockers

| # | Blocker | Impact | Workaround | Owner action |
|---|---|---|---|---|
| DB1 | The AWS credentials in the session environment are rejected. On 2026-09-27, `aws sts get-caller-identity` returned `InvalidClientTokenId` (awscli 1.46.1) | Phase 3 (deploy), the deployed Inspector OAuth evidence, the reviewer account on the public URL, and the plugin's final `.mcp.json` URL | Everything else runs locally: the OAuth server, tests, pages, plugin and kit. `PUBLIC_BASE_URL` is a single env var, so moving from local to CloudFront to a custom domain means changing one value | Create IAM user `shopvoice-deploy` (not root) and put a **working** access key pair in the session environment as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, plus `AWS_REGION` |
| DB2 | Checkpoint A answers are pending: domain, support email, the `shopvoice-plugin` repo, and whether **Submit new** is visible | Public pages and the kit need the support email; the plugin push needs the repo | Defaults until the owner answers: the CloudFront domain, and a `SUPPORT_EMAIL` placeholder in env | Answer the checkpoint questions |
