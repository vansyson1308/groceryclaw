#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { ShopVoiceStack } from '../lib/shopvoice-stack.js';

const app = new App();
const ctx = (key: string, fallback: string): string => {
  const value: unknown = app.node.tryGetContext(key);
  return typeof value === 'string' && value.length > 0 ? value : fallback;
};

const stage = ctx('stage', 'demo');
new ShopVoiceStack(app, `ShopVoice-${stage}`, {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1' },
  description: 'ShopVoice (Alexa+ MCP) hackathon deployment: EC2 + docker compose + CloudFront + SSM + Bedrock/Polly',
  stage,
  repoUrl: ctx('repoUrl', 'https://github.com/vansyson1308/groceryclaw.git'),
  gitRef: ctx('gitRef', 'main'),
  originVerifySecret: ctx('originVerifySecret', 'set-by-deploy-script'),
  instanceType: ctx('instanceType', 't3.small'),
  bedrockModelId: ctx('bedrockModelId', 'us.amazon.nova-2-lite-v1:0'),
  pollyVoiceId: ctx('pollyVoiceId', 'Joanna'),
  demoAnchorDate: ctx('demoAnchorDate', '')
});
