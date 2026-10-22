# ShopVoice: AWS services, honestly

Updated 2026-10-22. **No AWS service runs in the live demo.** The owner's AWS account was locked in October and the appeal failed; Amazon then stopped issuing credit codes (BLOCKERS B7). We did not open a second account.

The live path is:

> voice → simulator (Claude via the Anthropic API) → MCP Streamable HTTP → ShopVoice MCP server → Postgres with RLS, all on Render

## AWS Builder mini challenge: Kiro Crew

The rules say "Kiro Crew qualifies on its own as a development tool used during the hackathon — a submission does not need to also call a runtime AWS service".

| Tool | What for | Evidence |
|---|---|---|
| **Kiro Crew** (spec-driven development, Windows, free tier) | The `.kiro/` steering files and the `hosted-demo` spec (requirements, design and tasks, in EARS). The owner ran tasks 4 (simulator `/healthz` covering the MCP server) and 5 (the judges' "Try these 5 phrases" panel) in Kiro Crew. | `.kiro/steering/*`, `.kiro/specs/hosted-demo/*`, commits with the trailer `Built-with: Kiro` on `kiro/hosted-demo`, `docs/hackathon/KIRO_RUNBOOK.md` |

> **Status:** filled in after the Oct 23 10:00 go/no-go. If there is no Kiro PR by then, this section is removed and the AWS Builder mini challenge is **not** claimed.

## Implemented, not deployed: AWS account unavailable

This code is in the repo and has unit tests against fakes. It has **never run against a live AWS account**, so it is not part of the demo, and nothing in the submission claims it ran.

| Service | What the code does | Where |
|---|---|---|
| Amazon Bedrock (Converse with tool use, Amazon Nova 2 Lite by default) | An alternative simulator brain (`SIM_BRAIN=bedrock`) | `apps/alexa-sim/src/brain.ts` (`BedrockBrain`) |
| Amazon Polly (neural TTS) | Alternative speech output (`SIM_TTS=polly`) | `apps/alexa-sim/src/speech.ts` (`PollySpeech`) |
| Amazon EC2, Amazon CloudFront, AWS Systems Manager Parameter Store, AWS IAM, Amazon CloudWatch Logs, AWS CDK | A one-host deploy: compose on EC2 behind two CloudFront distributions with an origin-verify header | `infra/aws/`, `scripts/aws/`; `cdk synth` output in `evidence/cdk-synth-summary.md` |

## What replaced each AWS piece

| Planned (AWS) | Live now | Why |
|---|---|---|
| Bedrock agent brain | Claude Sonnet 5.5 via the Anthropic API, with the offline rules brain as a per-turn fallback | Account locked |
| Polly voices | Browser speech synthesis in the simulator; Piper (offline, public-domain/CC0 voices) for the video | Account locked |
| EC2 + CloudFront | Render Blueprint: two web services, a private Postgres 16 service and a cron job, about $22/month | Account locked; Render needs no credits |
