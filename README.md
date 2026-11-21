# AWS Cost Assistant for Welt

Ask about your AWS costs from Slack. The agent reaches AWS through the AWS MCP Server from the [Agent Toolkit for AWS](https://docs.aws.amazon.com/agent-toolkit/latest/userguide/what-is-agent-toolkit.html), behind AgentCore Gateway. AWS runs that server, and this sample deploys the other three parts as one CloudFormation stack with two AWS CDK commands.

| Part | Runs on | Job |
| --- | --- | --- |
| Slack entry point | AWS Lambda | Receives requests from Slack and passes them to the agent. Runs [Welt](https://github.com/iwamot/welt). |
| Agent | Amazon Bedrock AgentCore Runtime | Reads the question and decides which tools to call. Built with [Strands Agents](https://strandsagents.com/). |
| Tool entry point | AgentCore Gateway | Gives the agent one entry point for its tools, and a policy decides which tools it can use. |
| AWS tools | Run by AWS | Runs the Python scripts the agent writes in a sandbox and calls AWS APIs with the Gateway's credentials. The AWS MCP Server. |

## Prerequisites

- An AWS account where Cost Explorer is enabled.
- Claude Sonnet 4.6 invoked once in `us-east-1` from the Amazon Bedrock console, after you submit the Anthropic use case form. The first invocation in an account starts an AWS Marketplace subscription, and the agent's role doesn't have the permissions to start it. [Bedrock model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)
- AWS credentials that can use CloudFormation, IAM, AWS Lambda, Amazon Bedrock AgentCore, CloudWatch Logs, and Secrets Manager, and run `cdk bootstrap`. [CDK bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html)
- A Slack workspace where you can install an app, and a channel where the billing data can be shared.
- Git, Node.js 22 or later with npm, and uv.

## Deploy

### Deploy the stack

In `agentcore/cdk`, install the CDK dependencies.

```bash
cd agentcore/cdk
npm ci
```

The commands deploy to `us-east-1` with Claude Sonnet 4.6. To change these defaults or deploy a separate copy, set the environment variables first.

| Variable | Default | What it changes |
| --- | --- | --- |
| `STACK_REGION` | `us-east-1` | The Region for the stack |
| `MODEL_ID` | `global.anthropic.claude-sonnet-4-6` | The model the agent uses |
| `MODEL_REGION` | The stack's Region | The Region where the agent calls the model |
| `TARGET_NAME` | `default` | The name that separates copies, used in the stack name `AgentCore-WeltCostAssistant-<name>` and in the names of the main resources |

```bash
npm run cdk -- bootstrap
npm run cdk -- deploy
```

CDK asks you to confirm the IAM changes, and prints `SlackSecretName` and `FunctionUrl` when it finishes.

### Create the Slack app

1. Open [Create AWS Cost Assistant][create-slack-app].
   - If it doesn’t open, go to [Slack app settings](https://api.slack.com/apps), choose **Create New App** → **Paste a manifest** → **Continue**, switch to **YAML**, and replace the existing content with [the sample manifest](deploy/slack-manifest.yml).
2. Select your workspace and choose **Next**.
3. Choose **Create and Install**.
4. In the window that opens, choose **Allow**.
5. Back in the first window, expand **Your app credentials** and copy the **Bot token**.
6. Choose **Go to App Settings**, and copy the **Signing Secret** from **Basic Information**.

[create-slack-app]: https://api.slack.com/apps?new_app=1&manifest_yaml=display_information%3A%0A%20%20name%3A%20AWS%20Cost%20Assistant%0Afeatures%3A%0A%20%20app_home%3A%0A%20%20%20%20home_tab_enabled%3A%20false%0A%20%20%20%20messages_tab_enabled%3A%20false%0A%20%20bot_user%3A%0A%20%20%20%20display_name%3A%20AWS%20Cost%20Assistant%0A%20%20%20%20always_online%3A%20true%0Aoauth_config%3A%0A%20%20scopes%3A%0A%20%20%20%20bot%3A%0A%20%20%20%20%20%20-%20channels%3Ahistory%0A%20%20%20%20%20%20-%20chat%3Awrite%0A%20%20%20%20%20%20-%20files%3Aread%0A%20%20%20%20%20%20-%20groups%3Ahistory%0A%20%20%20%20%20%20-%20reactions%3Awrite%0A%20%20%20%20%20%20-%20users%3Aread%0Asettings%3A%0A%20%20socket_mode_enabled%3A%20false%0A

### Store the Slack credentials

The stack creates a Secrets Manager secret with empty values. Welt reads it and picks up an edited value within five minutes. In the Secrets Manager console in `us-east-1`, open the secret named in the `SlackSecretName` output, choose **Retrieve secret value** and then **Edit**, and enter the bot token as `SLACK_BOT_TOKEN` and the signing secret as `SLACK_SIGNING_SECRET`.

### Connect Slack and ask a question

1. In **App Manifest**, on the **YAML** tab, add these lines right after `settings:` (put the `FunctionUrl` output in both `request_url` fields).

   ```yaml
     event_subscriptions:
       request_url: <FunctionUrl>
       bot_events:
         - message.channels
         - message.groups
     interactivity:
       is_enabled: true
       request_url: <FunctionUrl>
   ```

2. Choose **Save Changes**.
3. In the warning at the top of the page, choose **Click here to verify**, and check that the warning goes away.
   - If the warning stays, choose it again, since a Lambda cold start can take close to Slack's three-second limit. If it still stays, check the settings so far, especially `request_url` and the signing secret.
   - If you edit the Secrets Manager values, wait a few minutes before you choose it again, since Welt keeps using the old values for up to five minutes.
4. In the channel you prepared, run `/invite @AWS Cost Assistant` to invite the app.
5. Mention the app with a question, such as `@AWS Cost Assistant What are my AWS costs this month?`.
6. Check in the Cost Explorer console that the amount in the thread reply is correct.

To ask a follow-up question, reply in the same thread; you don't need to mention the app again. You can also ask questions such as these:

- `Which services cost the most?`
- `How did my costs change from last month?`
- `Where can I save money?`

## How it works

- **Tools.** The Gateway's only target is the AWS MCP Server (`agentcore/agentcore.json`). A Gateway policy lets the agent's role list and call seven of its eight tools (the `AgentToolsPolicy` statement in `agentcore/cdk/lib/cdk-stack.ts`); `get_presigned_url` stays commented out. The Gateway denies any tool that no policy permits, including tools AWS adds to the server later.
- **Permissions.** The AWS MCP Server calls AWS APIs with the Gateway's role. That role holds 46 cost read actions (`readActions`), taken from the read commands in AWS's `aws-billing-and-cost-management` skill, and allowed only when `aws:CalledViaAWSMCP` is `aws-mcp.amazonaws.com`. The agent's role can call Bedrock and invoke the Gateway, and holds no permissions to read cost data.
- **System prompt.** The system prompt tells the model where it runs and who reads it: it answers in a Slack thread for the people in the channel, only when someone messages it, and it can read cost data but can't monitor, notify, or change anything. It also lists the 46 actions that the stack attaches to the Gateway's role and passes to the agent as `AWS_READ_ACTIONS`.
- **Thinking.** The agent turns on adaptive thinking, so the model decides when and how much to think before it answers.
- **Date.** Strands' `ContextInjector` appends today's date (UTC) to the latest user message so the model can resolve periods such as "this month".
- **Caching.** `CacheConfig(strategy="auto")` caches the system prompt, the tool definitions, and earlier messages.
- **Shared visibility.** Everyone who can message the app reads the same cost data. In an AWS Organizations management account, that includes linked-account costs.
- **Policy decisions.** The Gateway's policy decisions go to CloudWatch metrics by default, in the `AWS/Bedrock-AgentCore` namespace: `AllowDecisions` and `DenyDecisions`. The decisions on which tools to list carry the tool in the `ToolName` dimension; the decisions on tool calls are counted per Gateway. The Gateway's logs don't record policy decisions, so the metrics are where you check that the policy works.
- **Traces.** Tracing is off (`enableOtel: false` in `agentcore/agentcore.json`). Turning it on needs the `aws-opentelemetry-distro` package in `app/agent` and CloudWatch Transaction Search, an account-level setting that stays after you remove the stack. Traces can include the prompts and tool results, which here are your cost data.

## Check locally

```bash
./validate.sh
```

The script uses [mise](https://mise.jdx.dev/) to install the pinned tools, including the Python version that AgentCore Runtime runs. It audits the dependencies and checks their licenses, lints and type-checks the code, synthesizes the stack with a placeholder account ID, which needs no AWS credentials, and runs the tests. The tests cover how the agent builds its system prompt, and check the synthesized template for the Cedar policy's tools, the policy engine's ENFORCE mode, and the IAM permissions of the Gateway and the agent. They also check that the link to Slack's app-creation screen carries the manifest in `deploy/slack-manifest.yml`.

To run the agent's test on Python 3.12 or 3.13, which AgentCore Runtime and the dependencies also support, set the version for `uv`:

```bash
UV_PYTHON=3.12 ./compatibility.sh
```

## Costs

In 20 test questions with the `global.anthropic.claude-sonnet-4-6` profile in `us-east-1`, the model charges came to about USD 0.05 per question on average: about USD 0.02 for a typical cost question, and about USD 0.07 for open-ended requests such as help with budgets, which get longer answers. These are estimates from the token counts multiplied by the list prices. Each Cost Explorer request costs USD 0.01. The AWS MCP Server has no additional charge. AgentCore Runtime, Gateway, and Policy, Lambda, CloudWatch Logs, and Secrets Manager charge for usage. [Bedrock](https://aws.amazon.com/bedrock/pricing/) · [AgentCore](https://aws.amazon.com/bedrock/agentcore/pricing/) · [Cost Explorer](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/)

## Clean up

1. In Slack app settings, open **Basic Information** for **AWS Cost Assistant**, choose **Delete App**, and choose **Delete App** again to confirm.
2. In `agentcore/cdk`, run `npm run cdk -- destroy`. If you set `STACK_REGION` or `TARGET_NAME` for the deployment, set them again.
3. In CloudWatch Logs, delete the agent's Runtime log group, which AgentCore creates outside the stack. Its name starts with `/aws/bedrock-agentcore/runtimes/WeltCostAssistant_<target name>_`, which is `WeltCostAssistant_default_` unless you set `TARGET_NAME`.
4. If you ran `cdk bootstrap` for the first time for this sample, also delete the resources that CDK created for it. In the CloudFormation console in the Region you deployed to, check the creation time of the `CDKToolkit` stack: a creation time close to your deployment is a hint that it's yours.
   1. Delete the `CDKToolkit` stack.
   2. In the S3 console, select the bucket in the Region you deployed to whose name starts with `cdk-hnb659fds-assets-`, choose **Empty**, and then delete the bucket. The bucket remains after the stack is deleted.
