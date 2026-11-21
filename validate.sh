#!/bin/bash
set -e

# mise
eval "$(mise activate bash)"
mise fmt
mise install

# Run shared lint tasks
mise run gha-lint
mise run shell-lint

# Python: the agent runs on AgentCore Runtime with the Python that mise.toml pins
unset VIRTUAL_ENV
UV_PYTHON="$(command -v python)"
export UV_PYTHON
uv sync --project app/agent --locked
# The shared task runs uv from the repository root, so UV_PROJECT points it at the agent.
UV_PROJECT=app/agent mise run licenses python 'The Unlicense (Unlicense)'
uv audit --project app/agent --locked
ruff check --fix
ruff format
ty check --error-on-warning

# TypeScript and JavaScript: the CDK app and the Welt download script
biome check --write

# CDK: synth needs an account ID but no credentials, so a placeholder keeps the
# template free of any real account. The deployment settings stay unset, so the
# tests always read the default stack's template.
(
  cd agentcore/cdk
  npm ci --no-fund
  npm audit
  rm -rf cdk.out
  env -u TARGET_NAME -u STACK_REGION -u MODEL_ID -u MODEL_REGION \
    CDK_DEFAULT_ACCOUNT=123456789012 npm run cdk -- synth --quiet
)

uv run --project app/agent --locked python -m unittest discover -s tests

# Check for uncommitted changes
git diff --exit-code
