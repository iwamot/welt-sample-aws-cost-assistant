import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# validate.sh runs `cdk synth` before the tests, so the template matches the current
# CDK code and agentcore.json.
TEMPLATE = (
    ROOT / "agentcore/cdk/cdk.out/AgentCore-WeltCostAssistant-default.template.json"
)
# Nothing else ties these pins to the Runtime settings in the template:
# deployment succeeds either way, and a mismatch only shows when the code runs.
MISE = (ROOT / "mise.toml").read_text()
RENOVATE = json.loads((ROOT / ".github/renovate.json").read_text())
READ_VERBS = ("Describe", "Get", "List", "View")
# The services in the Gateway role's read actions that hold cost data. The role's other
# reads (EC2, Lambda, CloudWatch Logs, and so on) feed Compute Optimizer's analysis.
COST_SERVICES = {
    "billing",
    "budgets",
    "ce",
    "compute-optimizer",
    "cost-optimization-hub",
    "freetier",
    "pricing",
}


def joined(value: object) -> str:
    """Return the text of a CloudFormation string, with each intrinsic function as `<ref>`."""
    if isinstance(value, str):
        return value
    if isinstance(value, dict) and "Fn::Join" in value:
        separator, parts = value["Fn::Join"]
        return separator.join(joined(part) for part in parts)
    return "<ref>"


def tool_names(statement: str) -> tuple[list[str], list[str]]:
    """Split the AWS MCP Server tools in a Cedar statement into permitted and commented out."""
    permitted, commented = [], []
    for line in statement.splitlines():
        match = re.search(r'AgentCore::Action::"awsmcp___aws___(\w+)"', line)
        if match:
            target = commented if line.lstrip().startswith("//") else permitted
            target.append(match.group(1))
    return permitted, commented


class StackTemplateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.resources = json.loads(TEMPLATE.read_text())["Resources"]

    def of_type(self, resource_type):
        return [r for r in self.resources.values() if r["Type"] == resource_type]

    def statements_of(self, role_arn):
        role = role_arn["Fn::GetAtt"][0]
        return [
            statement
            for policy in self.of_type("AWS::IAM::Policy")
            if {"Ref": role} in policy["Properties"]["Roles"]
            for statement in policy["Properties"]["PolicyDocument"]["Statement"]
        ]

    def test_gateway_enforces_the_policy_engine(self):
        (gateway,) = self.of_type("AWS::BedrockAgentCore::Gateway")
        self.assertEqual(
            gateway["Properties"]["PolicyEngineConfiguration"]["Mode"], "ENFORCE"
        )

    def test_policy_permits_seven_tools_and_leaves_out_get_presigned_url(self):
        (policy,) = self.of_type("AWS::BedrockAgentCore::Policy")
        statement = joined(policy["Properties"]["Definition"]["Policy"]["Statement"])
        self.assertEqual(
            tool_names(statement),
            (
                [
                    "retrieve_skill",
                    "search_documentation",
                    "read_documentation",
                    "list_regions",
                    "get_regional_availability",
                    "run_script",
                    "get_tasks",
                ],
                ["get_presigned_url"],
            ),
        )

    def test_gateway_role_reads_aws_only_through_aws_mcp_server(self):
        (gateway,) = self.of_type("AWS::BedrockAgentCore::Gateway")
        (statement,) = [
            s
            for s in self.statements_of(gateway["Properties"]["RoleArn"])
            if "aws:CalledViaAWSMCP" in s.get("Condition", {}).get("StringEquals", {})
        ]
        self.assertEqual(
            statement["Condition"]["StringEquals"]["aws:CalledViaAWSMCP"],
            "aws-mcp.amazonaws.com",
        )
        self.assertEqual(len(statement["Action"]), 46)
        for action in statement["Action"]:
            with self.subTest(action=action):
                self.assertTrue(action.split(":")[1].startswith(READ_VERBS))
        services = {action.split(":")[0] for action in statement["Action"]}
        self.assertLessEqual(COST_SERVICES, services)

    def test_agent_role_cannot_read_cost_data(self):
        (runtime,) = self.of_type("AWS::BedrockAgentCore::Runtime")
        for statement in self.statements_of(runtime["Properties"]["RoleArn"]):
            actions = statement["Action"]
            for action in actions if isinstance(actions, list) else [actions]:
                with self.subTest(action=action):
                    self.assertNotIn(action.split(":")[0], COST_SERVICES)

    def test_checks_run_on_the_python_that_agentcore_runtime_runs(self):
        (runtime,) = self.of_type("AWS::BedrockAgentCore::Runtime")
        artifact = runtime["Properties"]["AgentRuntimeArtifact"]["CodeConfiguration"]
        ((major, minor),) = re.findall(r'^python = "(\d+)\.(\d+)\.', MISE, re.MULTILINE)
        self.assertEqual(artifact["Runtime"], f"PYTHON_{major}_{minor}")
        (rule,) = [
            r for r in RENOVATE["packageRules"] if r.get("matchDepNames") == ["python"]
        ]
        self.assertEqual(rule["allowedVersions"], f"<{major}.{int(minor) + 1}")

    def test_slack_secret_name_starts_with_the_name_the_steps_give(self):
        # CloudFormation names the secret after the first 27 characters of its logical
        # ID, and the README and the article tell readers to open the secret whose name
        # starts with this.
        (logical_id,) = [
            key
            for key, resource in self.resources.items()
            if resource["Type"] == "AWS::SecretsManager::Secret"
        ]
        self.assertTrue(logical_id[:27].startswith("CostAssistantSlackSecret"))


class HelperTest(unittest.TestCase):
    def test_joined_replaces_intrinsic_functions(self):
        self.assertEqual(
            joined({"Fn::Join": ["", ["a", {"Ref": "X"}, "b"]]}), "a<ref>b"
        )

    def test_tool_names_splits_commented_lines(self):
        statement = (
            '  AgentCore::Action::"awsmcp___aws___run_script",\n'
            '  // AgentCore::Action::"awsmcp___aws___get_presigned_url",\n'
        )
        self.assertEqual(tool_names(statement), (["run_script"], ["get_presigned_url"]))
