#!/bin/sh
set -eu

STATE_DIR="${OPENCLAW_STATE_DIR:-/home/node/.openclaw}"
CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$STATE_DIR/openclaw.json}"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-$STATE_DIR/workspace}"
GATEWAY_PORT="${PORT:-18789}"
PRIMARY_MODEL="${OPENCLAW_PRIMARY_MODEL:-openai/gpt-5.6-sol}"

if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ] || [ "${#OPENCLAW_GATEWAY_TOKEN}" -lt 32 ]; then
  echo "OPENCLAW_GATEWAY_TOKEN must contain at least 32 characters" >&2
  exit 1
fi

mkdir -p "$STATE_DIR" "$WORKSPACE_DIR"
chown -R node:node "$STATE_DIR"

if [ ! -f "$CONFIG_PATH" ]; then
  jq -n --arg workspace "$WORKSPACE_DIR" --arg model "$PRIMARY_MODEL" '{
    gateway: {
      mode: "local",
      auth: { mode: "token" },
      controlUi: { enabled: false },
      http: {
        endpoints: {
          chatCompletions: { enabled: true },
          responses: { enabled: true }
        }
      }
    },
    agents: {
      defaults: {
        workspace: $workspace,
        skipBootstrap: true,
        model: { primary: $model }
      }
    },
    tools: { profile: "coding" }
  }' > "$CONFIG_PATH"
  chown node:node "$CONFIG_PATH"
fi

echo "Learning OpenClaw starting: state=$STATE_DIR port=$GATEWAY_PORT model=$PRIMARY_MODEL"
exec gosu node node dist/index.js gateway --bind lan --port "$GATEWAY_PORT"
