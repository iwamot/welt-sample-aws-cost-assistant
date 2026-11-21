import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { AgentCoreApplication, type AgentCoreApplicationProps } from '@aws/agentcore-cdk';
import {
  ArnFormat,
  AssetHashType,
  BundlingOutput,
  CfnOutput,
  CfnResource,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import { CfnPolicy } from 'aws-cdk-lib/aws-bedrockagentcore';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import {
  Architecture,
  Code,
  FunctionUrlAuthType,
  Function as LambdaFunction,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

interface AgentCoreStackProps extends StackProps {
  application: AgentCoreApplicationProps;
}

export class AgentCoreStack extends Stack {
  constructor(scope: Construct, id: string, props: AgentCoreStackProps) {
    super(scope, id, props);

    const app = new AgentCoreApplication(this, 'Application', props.application);
    const agent = app.runtime('welt_cost_assistant');
    const gateway = app.gateway('tools');
    const gatewayTargets = gateway.node
      .findAll()
      .filter(
        (child): child is CfnResource =>
          CfnResource.isCfnResource(child) &&
          child.cfnResourceType === 'AWS::BedrockAgentCore::GatewayTarget',
      );
    // The Gateway lets the agent list and call only these tools. Its policy engine denies
    // everything a policy does not permit. The policy names the agent's role and the
    // Gateway, so the stack creates it after the Gateway and its target instead of
    // declaring it in agentcore.json.
    // AWS MCP Server can add tools at any time, and the policy keeps them out until they
    // are listed in the statement. The statement lists the tools in the order of the AWS MCP
    // Server documentation, and get_presigned_url stays commented out because the agent has
    // no use for S3.
    const agentPrincipal = `arn:${this.partition}:sts::${this.account}:assumed-role/${agent.role.roleName}`;
    const agentToolsPolicy = new CfnPolicy(this, 'AgentToolsPolicy', {
      name: 'agent_cost_tools',
      description: "Lets the cost assistant agent use AWS MCP Server's knowledge and API tools.",
      policyEngineId: app.policyEngine('tools_access').policyEngineId,
      definition: {
        policy: {
          statement: [
            'permit(',
            `  principal == AgentCore::IamEntity::"${agentPrincipal}",`,
            '  action in [',
            '    AgentCore::Action::"awsmcp___aws___retrieve_skill",',
            '    AgentCore::Action::"awsmcp___aws___search_documentation",',
            '    AgentCore::Action::"awsmcp___aws___read_documentation",',
            '    AgentCore::Action::"awsmcp___aws___list_regions",',
            '    AgentCore::Action::"awsmcp___aws___get_regional_availability",',
            '    AgentCore::Action::"awsmcp___aws___run_script",',
            '    // AgentCore::Action::"awsmcp___aws___get_presigned_url",',
            '    AgentCore::Action::"awsmcp___aws___get_tasks"',
            '  ],',
            `  resource == AgentCore::Gateway::"${gateway.gatewayArn}"`,
            ');',
          ].join('\n'),
        },
      },
    });
    for (const target of gatewayTargets) {
      agentToolsPolicy.node.addDependency(target);
    }
    // The agent calls the model in the Runtime's Region unless MODEL_REGION is set at
    // deploy time. Without MODEL_ID, the agent uses its own default model.
    agent.addEnvironmentVariable('MODEL_REGION', process.env.MODEL_REGION || this.region);
    if (process.env.MODEL_ID) {
      agent.addEnvironmentVariable('MODEL_ID', process.env.MODEL_ID);
    }
    // AWS MCP Server calls AWS APIs with the Gateway's credentials, so the Gateway's role
    // holds the cost read actions. The condition limits them to calls that come through
    // AWS MCP Server, so the Gateway can't use them directly. The list covers the read
    // commands in AWS's aws-billing-and-cost-management skill, plus the reads Compute
    // Optimizer needs (from ComputeOptimizerReadOnlyAccess). The skill's write commands and
    // its CUR queries, which need Athena and S3 writes, stay out.
    const readActions = [
      'autoscaling:DescribeAutoScalingGroups',
      'autoscaling:DescribeAutoScalingInstances',
      'billing:GetBillingViewData',
      'billing:ListBillingViews',
      'budgets:ViewBudget',
      'ce:GetAnomalies',
      'ce:GetCostAndUsage',
      'ce:GetCostAndUsageWithResources',
      'ce:GetCostComparisonDrivers',
      'ce:GetCostForecast',
      'ce:GetDimensionValues',
      'ce:GetReservationCoverage',
      'ce:GetReservationPurchaseRecommendation',
      'ce:GetReservationUtilization',
      'ce:GetSavingsPlansCoverage',
      'ce:GetSavingsPlansPurchaseRecommendation',
      'ce:GetSavingsPlansUtilization',
      'ce:GetTags',
      'ce:GetUsageForecast',
      'compute-optimizer:GetAutoScalingGroupRecommendations',
      'compute-optimizer:GetEBSVolumeRecommendations',
      'compute-optimizer:GetEC2InstanceRecommendations',
      'compute-optimizer:GetECSServiceRecommendations',
      'compute-optimizer:GetEnrollmentStatus',
      'compute-optimizer:GetIdleRecommendations',
      'compute-optimizer:GetLambdaFunctionRecommendations',
      'compute-optimizer:GetRDSDatabaseRecommendations',
      'cost-optimization-hub:GetRecommendation',
      'cost-optimization-hub:ListRecommendationSummaries',
      'cost-optimization-hub:ListRecommendations',
      'ec2:DescribeAddresses',
      'ec2:DescribeInstances',
      'ec2:DescribeVolumes',
      'ec2:DescribeVpcEndpoints',
      'ecs:ListClusters',
      'ecs:ListServices',
      'freetier:GetAccountPlanState',
      'freetier:GetFreeTierUsage',
      'lambda:ListFunctions',
      'lambda:ListProvisionedConcurrencyConfigs',
      'logs:DescribeLogGroups',
      'pricing:DescribeServices',
      'pricing:GetAttributeValues',
      'pricing:GetProducts',
      'rds:DescribeDBClusters',
      'rds:DescribeDBInstances',
    ];
    gateway.addToPolicy(
      new PolicyStatement({
        actions: readActions,
        resources: ['*'],
        conditions: { StringEquals: { 'aws:CalledViaAWSMCP': 'aws-mcp.amazonaws.com' } },
      }),
    );
    // The agent tells the model which read actions it has, so the model doesn't try or
    // offer anything else.
    agent.addEnvironmentVariable('AWS_READ_ACTIONS', readActions.join(','));

    const deployDir = resolve(__dirname, '../../../../deploy');
    const functionName = `${this.stackName}-welt`;
    // The stack creates the secret with empty values. Welt reads it on a cold start, so
    // the Slack credentials stay out of the template and the function's environment.
    const slackSecret = new Secret(this, 'SlackSecret', {
      description: 'Slack credentials for Welt: SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET.',
      secretObjectValue: {
        SLACK_BOT_TOKEN: SecretValue.unsafePlainText(''),
        SLACK_SIGNING_SECRET: SecretValue.unsafePlainText(''),
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const welt = new LambdaFunction(this, 'Welt', {
      functionName,
      runtime: Runtime.PYTHON_3_14,
      architecture: Architecture.ARM_64,
      handler: 'lambda_function.lambda_handler',
      code: Code.fromAsset(deployDir, {
        assetHashType: AssetHashType.OUTPUT,
        bundling: {
          image: Runtime.PYTHON_3_14.bundlingImage,
          outputType: BundlingOutput.ARCHIVED,
          local: {
            tryBundle(outputDir) {
              execFileSync(process.execPath, [resolve(deployDir, 'download-welt.mjs'), outputDir], {
                stdio: 'inherit',
              });
              return true;
            },
          },
        },
      }),
      memorySize: 512,
      timeout: Duration.minutes(15),
      retryAttempts: 0,
      logGroup: new LogGroup(this, 'WeltLogs', {
        logGroupName: `/aws/lambda/${functionName}`,
        retention: RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        AGENT_ARN: agent.runtimeArn,
        SLACK_SECRET_ARN: slackSecret.secretArn,
      },
    });

    welt.addToRolePolicy(
      new PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [
          this.formatArn({
            service: 'lambda',
            resource: 'function',
            resourceName: functionName,
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
          }),
        ],
      }),
    );
    welt.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'bedrock-agentcore:InvokeAgentRuntime',
          'bedrock-agentcore:InvokeAgentRuntimeForUser',
        ],
        resources: [agent.runtimeArn, `${agent.runtimeArn}/runtime-endpoint/DEFAULT`],
      }),
    );

    const url = welt.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });
    slackSecret.grantRead(welt);
    new CfnOutput(this, 'FunctionUrl', { value: url.url });
    new CfnOutput(this, 'SlackSecretName', { value: slackSecret.secretName });
    new CfnOutput(this, 'RuntimeLogGroup', {
      value: `/aws/bedrock-agentcore/runtimes/${agent.runtimeId}-DEFAULT`,
    });
  }
}
