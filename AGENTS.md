## About this repository

This repository is a sample of a Slack assistant that answers questions about AWS costs. [Welt](https://github.com/iwamot/welt) on AWS Lambda connects Slack to a Strands agent on Amazon Bedrock AgentCore Runtime, and the agent reads cost data through AWS MCP Server behind AgentCore Gateway.

- `agentcore/agentcore.json` declares the Runtime, the Gateway, and the policy engine. `agentcore/cdk/` deploys them with the rest of the stack: the Cedar policy, the Gateway role's read actions, the Slack secret, and the Welt function.
- `app/agent/main.py` is the agent.
- `deploy/` holds the Slack app manifest and the script that downloads the Welt release for the Lambda function.

## Quoted code

The README and a hands-on article quote parts of this repository: `new_agent` and the `async with` block in `app/agent/main.py`, the Cedar policy statement in `agentcore/cdk/lib/cdk-stack.ts`, the Slack app manifest, and the deployment and cleanup steps. Keep their behavior when you change them. When a change alters what they show, say so in the pull request.

## Checks

Run before committing. The checks need no AWS credentials and make no Bedrock calls: `cdk synth` runs with a placeholder account ID.

    ./validate.sh

`validate.sh` uses the Python version that AgentCore Runtime runs (`runtimeVersion` in `agentcore/agentcore.json`, pinned in `mise.toml`). To run the agent's test on another Python version that both the Runtime and the dependencies support:

    UV_PYTHON=3.12 ./compatibility.sh

Deploying the stack and asking the assistant questions call AWS and Bedrock, which cost money.
