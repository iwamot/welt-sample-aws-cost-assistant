"""Stream AWS cost answers from AgentCore Runtime to Welt."""

import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import TypedDict

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from mcp_proxy_for_aws.client import aws_iam_streamablehttp_client
from mcp_proxy_for_aws.utils import get_service_name_and_region_from_endpoint
from strands import Agent
from strands.injection.types import InjectionContext
from strands.models import BedrockModel, CacheConfig
from strands.tools.mcp import MCPClient
from strands.vended_plugins.context_injector import ContextInjector
from welt_io_strands import renderable_events, start_reply

app = BedrockAgentCoreApp()
DEFAULT_MODEL_ID = "global.anthropic.claude-sonnet-4-6"


class WeltMessage(TypedDict):
    role: str
    content: list[dict[str, object]]


class WeltPayload(TypedDict):
    messages: list[WeltMessage]


def gateway_client(url: str) -> MCPClient:
    """Connect to the Gateway with SigV4 for the service and Region in its URL."""
    service, region = get_service_name_and_region_from_endpoint(url)
    return MCPClient(
        lambda: aws_iam_streamablehttp_client(
            url, aws_service=service, aws_region=region
        ),
    )


def system_prompt(read_actions: str) -> str:
    """Tell the model where it runs, who reads it, and which AWS actions its scripts can call."""
    actions = ", ".join(read_actions.split(","))
    return (
        "You answer questions about this AWS account's costs in a Slack thread, "
        "for the people in the channel. You run only when someone messages you: "
        "you can read cost and usage data, but you can't monitor, notify, or change "
        "anything in the account. "
        f"Your AWS access is read-only and limited to these actions: {actions}."
    )


def today(context: InjectionContext) -> str:
    """Tell the model today's date, which it needs for periods like this month."""
    return f"<today>{datetime.now(UTC).date().isoformat()} (UTC)</today>"


def new_agent(model: BedrockModel, gateway: MCPClient, prompt: str) -> Agent:
    return Agent(
        model=model,
        system_prompt=prompt,
        tools=[gateway],
        plugins=[ContextInjector(today)],
        callback_handler=None,
    )


@app.entrypoint
async def invoke(payload: WeltPayload) -> AsyncIterator[dict[str, object]]:
    # The system prompt, the tool definitions, and earlier messages stay the same from
    # call to call, so the model caches them.
    model = BedrockModel(
        model_id=os.environ.get("MODEL_ID") or DEFAULT_MODEL_ID,
        region_name=os.environ.get("MODEL_REGION"),
        cache_config=CacheConfig(strategy="auto"),
        additional_request_fields={"thinking": {"type": "adaptive"}},
    )
    gateway = gateway_client(os.environ["AGENTCORE_GATEWAY_TOOLS_URL"])
    prompt = system_prompt(os.environ["AWS_READ_ACTIONS"])
    async with new_agent(model, gateway, prompt) as agent:
        async for event in renderable_events(
            start_reply(agent, dict(payload)), agent=agent
        ):
            yield event


if __name__ == "__main__":
    app.run()
