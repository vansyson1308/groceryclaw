import { CfnOutput, Duration, RemovalPolicy, Stack, Tags } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { renderUserData } from './user-data.js';

export interface ShopVoiceStackProps extends StackProps {
  /** Deployment stage, used in SSM paths and names (e.g. "demo"). */
  readonly stage: string;
  /** Public git URL the instance clones (the hackathon repo). */
  readonly repoUrl: string;
  /** Branch, tag or commit to deploy. */
  readonly gitRef: string;
  /** Value CloudFront sends as X-Origin-Verify; created by scripts/aws/deploy.sh and stored in SSM. */
  readonly originVerifySecret: string;
  readonly instanceType: string;
  readonly bedrockModelId: string;
  readonly pollyVoiceId: string;
  readonly demoAnchorDate: string;
}

/**
 * ShopVoice demo deployment, sized for the hackathon credit budget:
 * one EC2 instance runs Postgres 16 + the MCP server + the voice simulator
 * with docker compose (Postgres needs a true superuser for the repo's RLS
 * bootstrap roles, which rules out RDS; see docs/hackathon/DECISIONS.md D13).
 * Two CloudFront distributions give public HTTPS endpoints; a secret origin
 * header keeps the instance from being reached around CloudFront. Secrets live
 * in SSM Parameter Store; Bedrock/Polly use the instance role.
 */
export class ShopVoiceStack extends Stack {
  constructor(scope: Construct, id: string, props: ShopVoiceStackProps) {
    super(scope, id, props);
    Tags.of(this).add('project', 'shopvoice');
    Tags.of(this).add('stage', props.stage);

    const ssmPath = `/shopvoice/${props.stage}/`;

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }]
    });

    const sg = new ec2.SecurityGroup(this, 'OriginSg', {
      vpc,
      description: 'ShopVoice origin: MCP 8090 and simulator 8091 (requests without the CloudFront X-Origin-Verify header are rejected by the apps).',
      allowAllOutbound: true
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8090), 'MCP server via CloudFront');
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8091), 'Simulator via CloudFront');

    const logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: `/shopvoice/${props.stage}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const role = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')]
    });
    role.addToPolicy(new iam.PolicyStatement({
      sid: 'ReadShopVoiceParameters',
      actions: ['ssm:GetParametersByPath', 'ssm:GetParameter', 'ssm:GetParameters'],
      resources: [`arn:${this.partition}:ssm:${this.region}:${this.account}:parameter${ssmPath}*`, `arn:${this.partition}:ssm:${this.region}:${this.account}:parameter${ssmPath.slice(0, -1)}`]
    }));
    role.addToPolicy(new iam.PolicyStatement({
      sid: 'DecryptSecureStringsViaSsm',
      actions: ['kms:Decrypt'],
      resources: ['*'],
      conditions: { StringEquals: { 'kms:ViaService': `ssm.${this.region}.amazonaws.com` } }
    }));
    role.addToPolicy(new iam.PolicyStatement({
      sid: 'BedrockConverse',
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        `arn:${this.partition}:bedrock:*::foundation-model/amazon.nova*`,
        `arn:${this.partition}:bedrock:*:${this.account}:inference-profile/*amazon.nova*`
      ]
    }));
    role.addToPolicy(new iam.PolicyStatement({ sid: 'PollyTts', actions: ['polly:SynthesizeSpeech'], resources: ['*'] }));
    logGroup.grantWrite(role);

    const userData = ec2.UserData.forLinux();
    userData.addCommands(renderUserData({
      repoUrl: props.repoUrl,
      gitRef: props.gitRef,
      ssmPath,
      region: this.region,
      logGroup: `/shopvoice/${props.stage}`,
      bedrockModelId: props.bedrockModelId,
      pollyVoiceId: props.pollyVoiceId,
      demoAnchorDate: props.demoAnchorDate
    }));

    const instance = new ec2.Instance(this, 'Host', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType(props.instanceType),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: sg,
      role,
      userData,
      userDataCausesReplacement: true,
      httpTokens: ec2.HttpTokens.REQUIRED,
      // Containers reach IMDS through the docker bridge: one extra hop.
      httpPutResponseHopLimit: 2,
      associatePublicIpAddress: true,
      blockDevices: [{ deviceName: '/dev/xvda', volume: ec2.BlockDeviceVolume.ebs(30, { volumeType: ec2.EbsDeviceVolumeType.GP3, encrypted: true }) }]
    });

    // MCP needs Authorization + Mcp-Session-Id forwarded and nothing cached.
    // Headers in a cache policy are forwarded to the origin; a 1s max TTL is
    // the minimum that allows header keys, and the origin sends no-store.
    const mcpCachePolicy = new cloudfront.CachePolicy(this, 'McpCachePolicy', {
      comment: 'ShopVoice MCP: forward auth/session headers, no caching (origin sends no-store)',
      defaultTtl: Duration.seconds(0),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.seconds(1),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Authorization', 'Mcp-Session-Id'),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none()
    });
    const mcpOriginRequest = new cloudfront.OriginRequestPolicy(this, 'McpOriginRequestPolicy', {
      comment: 'ShopVoice MCP: forward protocol headers',
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList('Mcp-Protocol-Version', 'Accept', 'Content-Type', 'Origin', 'Last-Event-Id'),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all()
    });

    const origin = (port: number) => new origins.HttpOrigin(instance.instancePublicDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: port,
      readTimeout: Duration.seconds(60),
      customHeaders: { 'X-Origin-Verify': props.originVerifySecret }
    });

    const mcpDist = new cloudfront.Distribution(this, 'McpDistribution', {
      comment: `ShopVoice MCP server (${props.stage})`,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origin(8090),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: mcpCachePolicy,
        originRequestPolicy: mcpOriginRequest
      }
    });

    const simDist = new cloudfront.Distribution(this, 'SimDistribution', {
      comment: `ShopVoice voice simulator (${props.stage})`,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origin(8091),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER
      }
    });

    new CfnOutput(this, 'McpUrl', { value: `https://${mcpDist.distributionDomainName}/mcp`, description: 'Public MCP endpoint (Streamable HTTP, bearer token required)' });
    new CfnOutput(this, 'SimulatorUrl', { value: `https://${simDist.distributionDomainName}/`, description: 'Voice simulator (access code required)' });
    new CfnOutput(this, 'InstanceId', { value: instance.instanceId, description: 'aws ssm start-session --target <id>' });
    new CfnOutput(this, 'LogGroupName', { value: logGroup.logGroupName });
    new CfnOutput(this, 'SsmParameterPath', { value: ssmPath });
  }
}
