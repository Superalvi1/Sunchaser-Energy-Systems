# Muse AI — restricted pilot preparation (NO ACTIVATION)

**Status:** draft PR #120. Do not merge this PR, connect a new Meta webhook, activate customer replies, or send a real WhatsApp message without the user's separate explicit final approval.

## Intended pilot
- Existing Sunchaser WhatsApp Business number stays on its existing CRM and Meta connection.
- One previously designated test recipient only. Store it as `MOOS_TEST_ONLY_RECIPIENT_E164` in Railway, never in deployed runtime code or a published runbook.
- Other customers must keep their normal human/legacy flow; no general autonomous replies.
- No unverified FAQ answers. Keep `moos-worker/faqs.json` at its existing reviewed one-entry baseline; do not apply uploaded patch 0007 unchanged, because prices, office hours, warranties, discount/installment terms and technical claims require human verification.
- Leave `MOOS_DECISION_URL` disabled until optional LLM classification has a separate shadow evaluation.

## Verified preparation
- Source is on `moos-whatsapp-agent`, not `main`; the PR stays in draft.
- CRM-side and worker-side allowlists check recipient E.164 and reject all when missing on a production runtime or `MOOS_PILOT_SCOPE_REQUIRED=true`.
- Signed relays not belonging to the test contact are rejected *before* worker queue insertion. CRM checks its own contact again before outbound text/document calls.
- Worker policy guard hands off questions about unverified warranties, financing, discounts, net metering, technical backup duration or service terms even when a system size is mentioned.
- CRM suppresses new Moos sends whenever legacy AI is enabled at send time. Other safety gates: ownership, 24-hour service window, approved unexpired native PDF and idempotency.
- No production data, existing Meta access token, or production credentials have been copied to staging.

## Required evidence before final activation approval
1. Verify the actual Meta webhooks product/app callback URL and phone-number-ID. DNS of `crm.sunchaserenergy.co` is evidence of the CRM service address, **not evidence of a configured Meta callback**.
2. Map live CRM domain and user conversation store; determine the actual source of `whatsapp_connections` and approved quotations. Verify existing Meta connection's state, token health and webhook receipts without exposing tokens.
3. Inspect who owns the pilot contact in CRM. Confirm legacy AI will not also reply and business inbox stays working for everyone else.
4. Verify exactly one current staff-approved 10 kW hybrid PDF, correct specifications/prices/expiry, and native document delivery path. A Smart Quote **draft** is not an approved PDF.
5. Plan `moos_relay_outbox` migration for the **actual webhook-receiving** CRM data source, with preflight backup, RLS verification, rollback and maintenance window. **Do not apply on customer-facing DB during preparation.**
6. Verify production service Git commit, Postgres queue schema, status, safety flags, and test-recipient scope. Railway OAuth exposes only env variable **names**, not actual readback values.
7. Re-run worker/CRM CI suites and DB integration verification on the final PR head.
8. Ask for **separate final approval** for merge/deploy and separately for enabling a **single recipient**. Existing test intent does not authorize broad customer rollout.

## Kill switches, all OFF while preparing
CRM: `MOOS_ENABLED=false`, `MOOS_RELAY_ENABLED=false`, `WHATSAPP_AI_AUTO_REPLY_ENABLED=false`.
Worker: `ENABLE_AUTOSEND=false`.
Pilot: `MOOS_PILOT_SCOPE_REQUIRED=true` and `MOOS_TEST_ONLY_RECIPIENT_E164` on both services. Production will fail closed if scope is not set.

## After final authorization (not before)
Stage changes, verify that only the test contact is eligible, open a 24-hour service window with a genuine inbound message, send a single approved PDF, inspect Meta provider ID/receipt and CRM audit, then immediately disable the three Muse gates while the outcome is reviewed. Do not retry unknown provider outcomes.

**Naming:** Muse AI is the product. `moos` filenames/environment identifiers are existing internal interfaces; rename separately with tests rather than breaking live integrations.
