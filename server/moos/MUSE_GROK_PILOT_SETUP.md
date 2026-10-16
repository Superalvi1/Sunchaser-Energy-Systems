# Muse AI — Grok text-only pilot (NO LIVE ACTIVATION)

## Objective and non-goals
- Existing Sunchaser business WhatsApp sender; exactly one designated test handset.
- English, Urdu and Roman Urdu short text replies for safe general solar enquiries.
- No PDF, quotations, prices, Smart Quote drafts, global auto-replies, Meta webhook change or production merge without separate approval.
- Grok has no CRM mutation tools or Meta credentials; unverified business facts and site-specific technical advice go to staff.

## Secure key provisioning
1. Open https://console.x.ai/ and select the correct xAI team.
2. Under API Keys create a dedicated inference key named sunchaser-muse-staging. Do NOT use a management key, paste a key into chat or commit it to GitHub.
3. Under Billing add modest prepaid credits, check usage and team limits; a Grok consumer subscription does not provide API credits.
4. Railway dashboard → Sunchaser Railway Staging → moos-worker-isolated-staging → Variables: add XAI_API_KEY as a secret/sealed variable. It must never appear in VITE_ frontend variables or PR comments.
5. Set XAI_MODEL=grok-4.3 and MUSE_TEXT_ONLY_MODE=true. Keep MUSE_GROK_ENABLED=false and ENABLE_AUTOSEND=false until synthetic testing and final rollout sign-off.
6. Maintain worker and CRM MOOS_PILOT_SCOPE_REQUIRED=true and MOOS_TEST_ONLY_RECIPIENT_E164 set to the one approved test handset. Keep CRM MOOS_ENABLED=false, MOOS_RELAY_ENABLED=false.
7. These OAuth-based deployment inspections can verify environment variable names, not secret values. Use the Railway dashboard and synthetic smoke result to confirm key validity.

## Synthetic, no-send evaluation
- Run npm test in moos-worker for mocked xAI cases, schema validation, text/handoff decisions, refusal, 401/429/timeout and redaction.
- From a trusted worker shell, after setting the private XAI_API_KEY, run npm run smoke:xai. It uses one synthetic solar-education question and makes a single xAI API call; it never calls WhatsApp or CRM and prints only PASS / NOT READY.
- Try at least 20 non-customer prompts in English, Urdu and Roman Urdu covering solar concepts, greetings, technical ambiguity, prices, warranties, electrical safety, human requests, prompt injection and duplicated requests.
- Validate CRM send gating, 24-hour customer window, legacy mutual exclusion, human takeover, idempotency, per-recipient allowlist and failed provider responses. No production sends during this phase.
- xAI Responses requests use store:false, four recent customer messages at most, redaction of common phone/email strings, 12-second timeout, and structured reply/handoff only. Review xAI data/privacy policies before forwarding real customer text.

## Production approval checkpoint
- Current public webhook receiver is crm.sunchaserenergy.co/api/whatsapp/webhook, backed by live CRM tracking main; Muse action API is not present there.
- Confirm actual Meta app and phone-number ID, production CRM database and safe outbox migration, key scopes, credential plan and rollback before requesting merge approval.
- The product is Muse AI (older code/env prefix moos remains intentionally stable).
- Ask for explicit approvals: first production deployment; then one-number activation; later customer-wide auto replies.
- At any point stop automatic sends by disabling MOOS_ENABLED, MOOS_RELAY_ENABLED and ENABLE_AUTOSEND.

This file describes preparation only. No live messages are authorized by it.
