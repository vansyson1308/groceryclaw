# ShopVoice on the Claude directory: blockers

| # | Blocker | Impact | Workaround | Owner action |
|---|---|---|---|---|
| DB1 | The AWS credentials in the session environment are rejected. On 2026-09-27, `aws sts get-caller-identity` returned `InvalidClientTokenId` (awscli 1.46.1) | Phase 3 (deploy), the deployed Inspector OAuth evidence, the reviewer account on the public URL, and the plugin's final `.mcp.json` URL | Everything else runs locally: the OAuth server, tests, pages, plugin and kit. `PUBLIC_BASE_URL` is a single env var, so moving from local to CloudFront to a custom domain means changing one value | Create IAM user `shopvoice-deploy` (not root) and put a **working** access key pair in the session environment as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, plus `AWS_REGION` |
| DB2 | ~~Checkpoint A answers~~ **Resolved 2026-09-27**: use the CloudFront domain for now; support email sonnv.hd34@gmail.com; `vansyson1308/shopvoice-plugin` exists (owner); **Submit new** is visible in the portal | – | – | – |
