#!/bin/bash
set -euo pipefail

# mise (uv only — a full `mise install` would put the pinned Python ahead of
# the version under test)
eval "$(mise activate bash)"
mise install aqua:astral-sh/uv

# CI (compatibility.yml) runs this once per Python version that both AgentCore
# Runtime and the agent's dependencies support — the requires-python floor
# upward — by setting UV_PYTHON.
# Locally: UV_PYTHON=3.12 ./compatibility.sh
export UV_PROJECT_ENVIRONMENT="$PWD/.venv-compat/${UV_PYTHON:-default}"

uv sync --project app/agent --locked
# The test imports app/agent/main.py, so it also catches a dependency or syntax
# that the version under test doesn't support. The stack template tests need
# `cdk synth`, which validate.sh runs once.
uv run --project app/agent --no-sync python -m unittest discover -s tests -p test_cost_assistant.py
