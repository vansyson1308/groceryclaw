# ShopVoice: AWS services used

Every AWS service the project uses, what it does, and where it is used in code. This file also feeds the Devpost AWS Builder fields.

| Service | What for | Where in the code |
|---|---|---|
| **Amazon Bedrock** (Converse API with tool use, model `us.amazon.nova-2-lite-v1:0` by default, via the `BEDROCK_MODEL_ID` env var) | The agent brain of the voice simulator. It receives the MCP server's tool list as Bedrock `toolSpec`s, decides which ShopVoice tools to call, and turns tool results into a short spoken reply. | `apps/alexa-sim/src/brain.ts` (`BedrockBrain`, `ConverseCommand`), loop in `apps/alexa-sim/src/agent.ts` |
| **Amazon Nova 2 Lite** (on Bedrock, US cross-region inference profile) | The default model: fast and cheap, with tool use. | `apps/alexa-sim/src/server.ts` (`loadSimConfig`), `infra/aws/bin/shopvoice.ts` |
| **Amazon Polly** (neural TTS, voice `Joanna` by default) | Speaks every assistant reply in the simulator. Also voices the demo-video narration. | `apps/alexa-sim/src/speech.ts` (`PollySpeech`), `demo/video/narrate.mjs` |
| **Amazon EC2** (t3.small, Amazon Linux 2023, IMDSv2, encrypted gp3 EBS) | Hosts Postgres 16, the MCP server and the simulator with docker compose. RDS was ruled out because the repo's RLS bootstrap needs a true superuser; see DECISIONS.md D13. | `infra/aws/lib/shopvoice-stack.ts`, `infra/aws/lib/user-data.ts`, `infra/aws/compose.aws.yml` |
| **Amazon CloudFront** (two distributions, HTTPS only) | Public HTTPS endpoints for the MCP server (`/mcp`, Streamable HTTP) and the simulator. A custom cache policy forwards `Authorization` and `Mcp-Session-Id` with nothing cached. A secret `X-Origin-Verify` origin header stops anyone reaching the instance around CloudFront. | `infra/aws/lib/shopvoice-stack.ts`; header check in `apps/mcp-server/src/http.ts` (`originVerified`) and `apps/alexa-sim/src/server.ts` |
| **AWS Systems Manager Parameter Store** (SecureString) | Stores the MCP bearer token, simulator access code, Postgres password and origin-verify secret. The instance reads them at boot; nothing secret is in git. | `scripts/aws/deploy.sh` (`ensure_param`), `infra/aws/lib/user-data.ts` |
| **AWS Systems Manager Session Manager** | Shell access to the instance without SSH or open port 22. | `infra/aws/lib/shopvoice-stack.ts` (`AmazonSSMManagedInstanceCore`) |
| **AWS IAM** | Least-privilege instance role: read `/shopvoice/<stage>/*` parameters, `bedrock:InvokeModel` on Nova models and profiles only, `polly:SynthesizeSpeech`, and write to its own log group. No static AWS keys on the host. | `infra/aws/lib/shopvoice-stack.ts` |
| **Amazon CloudWatch Logs** | Container logs from all services through the docker `awslogs` driver (JSON logs, tokens redacted), kept for two weeks. | `infra/aws/compose.aws.yml`, `infra/aws/lib/shopvoice-stack.ts` |
| **Amazon VPC** | A single public subnet with no NAT gateway, to keep cost down. The security group only opens ports 8090 and 8091, and both are gated by the origin header. | `infra/aws/lib/shopvoice-stack.ts` |
| **AWS CloudFormation / AWS CDK v2** (`aws-cdk-lib` 2.270.0, TypeScript) | Infrastructure as code. `scripts/aws/deploy.sh` and `teardown.sh` are the one-command deploy and destroy. | `infra/aws/`, `scripts/aws/` |
| **Amazon Transcribe** | Not used in the MVP. Speech input uses the browser Web Speech API (`apps/alexa-sim/static/app.js`); Transcribe streaming is listed as a stretch item. | none |
| **Alexa+ (MCP integration)** | The target client. ShopVoice is a standard MCP server (Streamable HTTP, protocol 2025-11-25), so Alexa+ can connect to it directly given developer Preview access. The simulator stands in for Alexa+ otherwise. | `apps/mcp-server/` |

## Cost estimate (us-east-1, on-demand, at the time of writing)

| Item | Approx. monthly |
|---|---|
| EC2 t3.small (24x7) | ~$15 |
| EBS gp3 30 GB | ~$2.40 |
| CloudFront (demo traffic) | < $1 |
| Bedrock Nova 2 Lite (demo usage) | < $2 |
| Polly neural (demo usage, first-year free tier) | < $2 |
| SSM Parameter Store standard, CloudWatch Logs | < $1 |
| **Total** | **roughly $20/month**, well inside the $150 credits. Run `scripts/aws/teardown.sh` after judging. |

These are estimates, not measured bills; check Cost Explorer after deploying.
