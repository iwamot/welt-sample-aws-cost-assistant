import unittest

from app.agent.main import system_prompt


class SystemPromptTest(unittest.TestCase):
    def test_lists_the_read_actions(self):
        self.assertEqual(
            system_prompt("ce:GetCostAndUsage,budgets:ViewBudget"),
            "You answer questions about this AWS account's costs in a Slack thread, "
            "for the people in the channel. You run only when someone messages you: "
            "you can read cost and usage data, but you can't monitor, notify, or change "
            "anything in the account. "
            "Your AWS access is read-only and limited to these actions: ce:GetCostAndUsage, budgets:ViewBudget.",
        )
