# ShopVoice — Blockers

Only items that truly need the owner (anh Sơn) or an external party. Each has a workaround so work continues.

| # | Blocker | Needs | Workaround in place | Status |
|---|---|---|---|---|
| B1 | `pre-hackathon-baseline` tag cannot be pushed from the agent session (git proxy only allows the session branch). | Owner runs: `git fetch origin && git tag -a pre-hackathon-baseline a9f3cdb2a385b68bc2c7bb82c61a8e57fbee5c57 -m "Baseline before hackathon" && git push origin pre-hackathon-baseline` | Baseline SHA `a9f3cdb` recorded in DECISIONS.md D2 and BUILT_DURING_HACKATHON.md; diffs are generated against the SHA. | open |
| B2 | No working AWS credentials in the agent environment (the environment's AWS keys are placeholders; STS, Bedrock and Polly all return `InvalidClientTokenId`). | Owner: IAM credentials (Bedrock InvokeModel on an Amazon Nova model in us-east-1, Polly SynthesizeSpeech, and deploy rights for CDK: CloudFormation, ECR, App Runner/ECS, RDS/EC2, IAM role creation), plus the $150 credits. | `BedrockClient` / `SpeechClient` interfaces with deterministic fakes; all tests are green on the fakes; CDK app is synthesised but not deployed. | open |
| B3 | Pre-existing on `main`: `npm run db:v2:test:rls` and `db:v2:test:bootstrap` still reference `zalo_users`, which migration 012 renamed. | Owner decision: fix in a separate PR (out of hackathon scope). | New ShopVoice RLS tests (`tests/v2/db/shopvoice-rls.test.mjs`) cover the new tables. | open, not blocking |
| B4 | Alexa+ Preview developer access unknown. | Owner: confirm whether the account has Alexa+ MCP Preview access. | Simulated Alexa+ web app (`apps/alexa-sim`), which the rules allow. | open |
| B5 | MIT license and public repo need owner consent. | Owner: confirm MIT and public visibility. | LICENSE file drafted but only added once confirmed (see STATUS.md). | open |
