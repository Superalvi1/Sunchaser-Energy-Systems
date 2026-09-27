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
        model: { primary: $model, fallbacks: ["openai/gpt-5.5"] }
      }
    },
    tools: { profile: "coding" }
  }' > "$CONFIG_PATH"
  chown node:node "$CONFIG_PATH"
fi

# The persistent volume can predate the fallback configuration. Update only
# the model policy, retaining OAuth profiles and all other user configuration.
# A same-provider fallback needs no additional credential when OpenAI OAuth
# already covers both models. Client cancellations are terminal, not fallback.
if [ -f "$CONFIG_PATH" ]; then
  CONFIG_TMP="$(mktemp "$STATE_DIR/openclaw.json.XXXXXX")"
  if jq --arg model "$PRIMARY_MODEL" '
    .agents.defaults.model = ((.agents.defaults.model // {})
      + {primary: $model, fallbacks: ["openai/gpt-5.5"]})
  ' "$CONFIG_PATH" > "$CONFIG_TMP"; then
    chown node:node "$CONFIG_TMP"
    chmod 0600 "$CONFIG_TMP"
    mv "$CONFIG_TMP" "$CONFIG_PATH"
  else
    rm -f "$CONFIG_TMP"
    echo "OpenClaw config is invalid; refusing to overwrite persistent state" >&2
    exit 1
  fi
fi

# Start the requested one-time subscription login alongside the private
# gateway so Railway health checks remain available while the owner approves
# the device code. Tokens are written only to the persistent state volume.
case "${OPENCLAW_BOOTSTRAP_AUTH:-}" in
  openai)
    echo "Starting ChatGPT/Codex device authorization; follow the URL and code below."
    (gosu node node dist/index.js models auth login --provider openai --method device-code && echo "ChatGPT authorization completed; remove OPENCLAW_BOOTSTRAP_AUTH and restart Gateway.") &
    ;;
  xai)
    echo "Starting xAI subscription device authorization; follow the URL and code below."
    (gosu node node dist/index.js models auth login --provider xai --method oauth && echo "xAI authorization completed; remove OPENCLAW_BOOTSTRAP_AUTH and restart Gateway.") &
    ;;
esac

echo "Learning OpenClaw starting: state=$STATE_DIR port=$GATEWAY_PORT model=$PRIMARY_MODEL"
exec gosu node node dist/index.js gateway --bind lan --port "$GATEWAY_PORT"
