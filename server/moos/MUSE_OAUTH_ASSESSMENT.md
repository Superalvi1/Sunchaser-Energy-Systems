# Muse authentication decision — 16 October 2026

User preference: OAuth for Grok/X or OpenAI. Do not provision a new paid API key as an assumed substitute.

## Verified official capabilities

- xAI direct inference (`https://api.x.ai`) documents an xAI API key. Grok Build supports browser/device OAuth against its inference proxy. That does not establish permission or compatibility for using a Grok Build session in Muse's direct Responses adapter. X social OAuth is not an inference credential.
- OpenAI Sign in with ChatGPT supports plan usage for eligible open-source and locally hosted apps, including an open-source app on a self-hosted VM. Paid or remotely hosted app offerings have a separate interest/approval route.
- The documented self-hosted flow completes OAuth locally with a loopback callback, then securely transfers the selected registration to the VM. The VM has its own persistent host ID and owns refreshes.

Sources checked:
- https://docs.x.ai/developers/rest-api-reference/inference
- https://docs.x.ai/build/enterprise
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
- https://developers.openai.com/siwc/website

## Decision and remaining blocker

Preferred candidate is supported OpenAI OAuth. It is NOT connected or implemented by this assessment. Muse currently runs as a private hosted business worker; no qualifying OSS registration or approved commercial OAuth client has been established. Do not publish the CRM source to meet eligibility. Do not copy credentials from ChatGPT, Codex or Grok sessions, invent a client ID, or claim a consumer login alone authorizes Muse inference.

Before implementation, establish the applicable integration route and obtain its actual registration/consent. For the OSS self-hosted route, complete local PKCE sign-in using the same eligible tool/client, validate the ID token and plan scopes, transfer credentials securely, persist the VM host ID, and refresh atomically. For a hosted commercial integration, obtain the registered client and supported callback configuration. Model entitlement must be proven by completed synthetic inference, not a model-list entry.

Then implement the provider behind the existing text-only action boundary with token refresh/revocation handling, streaming through response.completed, store:false, strict reply/handoff validation and no model tools. Test synthetic English/Urdu/Roman Urdu cases and expired/revoked credentials before any WhatsApp activation. Do not silently fall back to billable API keys.

All production and real-message restrictions remain in force. No OAuth registration, token transfer, inference request or live send has been completed.
