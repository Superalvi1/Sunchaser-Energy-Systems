FROM ghcr.io/openclaw/openclaw:2026.9.4

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl jq gosu \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node bootstrap-openclaw.sh /usr/local/bin/bootstrap-learning-openclaw
RUN chmod 0755 /usr/local/bin/bootstrap-learning-openclaw

ENV HOME=/home/node \
    OPENCLAW_HOME=/home/node \
    OPENCLAW_STATE_DIR=/home/node/.openclaw \
    OPENCLAW_CONFIG_PATH=/home/node/.openclaw/openclaw.json \
    OPENCLAW_CONFIG_DIR=/home/node/.openclaw \
    OPENCLAW_WORKSPACE_DIR=/home/node/.openclaw/workspace \
    OPENCLAW_DISABLE_BONJOUR=1 \
    OPENCLAW_GATEWAY_BIND=lan \
    TZ=Asia/Karachi

ENTRYPOINT ["/usr/local/bin/bootstrap-learning-openclaw"]
