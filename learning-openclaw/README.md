# Learning OpenClaw gateway

Private OpenClaw gateway for Sunchaser AI Learning Studio. It exposes the
OpenAI-compatible chat and responses endpoints only inside the Railway project.

Required Railway configuration:

```
PORT=18789
OPENCLAW_GATEWAY_TOKEN=<at least 32 random characters>
OPENCLAW_PRIMARY_MODEL=openai/gpt-5.6-sol
```

Attach a persistent volume at `/home/node/.openclaw` before completing OAuth.
Do not generate a public domain for this service.

Complete subscription sign-in from an interactive Railway shell:

```
openclaw models auth login --provider openai --method device-code
openclaw models auth login --provider xai --method oauth
openclaw models auth list --provider openai
openclaw models auth list --provider xai
```

The Learning Studio calls the gateway at:

```
http://learning-openclaw-core.railway.internal:18789/v1
```
