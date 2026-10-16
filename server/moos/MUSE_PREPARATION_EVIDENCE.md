# Muse preparation evidence — 16 October 2026

Verdict: NOT production ready. Draft preparation only; no merge, customer-facing deployment, Meta callback change or real WhatsApp send is authorized or performed.

## Observed infrastructure

| Item | Actual evidence | Limit |
|---|---|---|
| PR #120 | Open, draft, unmerged; starting head f99c2ce8265a04e57bd39c49ef40725aab4b130a | Final changes require new CI |
| Public CRM | main commit 5840c3a3b844ef603df082048a6401d92a82760a; deployment 5065e41a-a7da-4b83-bfda-531fad3d87e0 SUCCESS | Public main source does not mount Muse router |
| CRM health | GET /health returned 200 and service=sunchaser-crm | No DB/token proof |
| CRM webhook traffic | 101 recent logged webhook requests returned 200; sampled 05:12–07:33 UTC | Does not prove Meta dashboard settings or individual DB commits |
| Isolated worker | Deployment 60c7b7ae-bf4a-41f6-8c0b-8e9b829a309e SUCCESS; schema verified; startup logs autosend=false and internal staging CRM target | No external model call or production link |
| Isolated CRM | Deployment 50708e59-8b91-4a4e-9a3f-ba12b2dce144 SUCCESS | Logs explicitly show no configured data API and fallback JSON storage; DB integration is not established |
| xAI credential | XAI_API_KEY absent from worker variable names | Real Grok inference not tested |
| OAuth preference | User requested Grok/X or OpenAI OAuth; official routes assessed separately | No Muse OAuth client/consent or tokens available |

Safety settings were explicitly written only to the two isolated services, with deploys skipped: worker ENABLE_AUTOSEND=false, MUSE_GROK_ENABLED=false; CRM MOOS_ENABLED=false and MOOS_RELAY_ENABLED=false; both MUSE_TEXT_ONLY_MODE=true, pilot scope required, recipient restricted to the privately configured authorized handset. These writes apply on their next deployment. OAuth names-only reads cannot independently read back existing values. No production variables changed.

## Fixes prepared

- Stop the worker before ownership reads, provider calls or CRM mutations when its switch is off; independently check recipient scope even for direct process calls.
- Preserve newest distinct inbound message when an older duplicate shares its Meta timestamp.
- Record CRM providerMessageId in the worker outbound evidence row.
- Localize deterministic greetings/review/sales/location text in English, Urdu and Roman Urdu.
- Strictly reject extra model fields, overlong reason/reply, numeric claims and common commercial/payment output. This reduces risk; it cannot prove all generated prose is factual.
- Add regression tests, including actual Postgres duplicate/order/provider/restart tests in disposable CI.

## Validation at local working tree

Worker: 64 passed, zero failed; one real Postgres test skipped locally because no disposable Postgres was available. GitHub CI must run that test with MOOS_TEST_DATABASE_URL. Existing 60-test baseline also passed before changes.

All seven CRM suites passed locally using node --import tsx: recipient scope, router security/text-only gating, HMAC/legacy exclusion, relay outbox, Graph serialization using fake HTTP, existing webhook and repository behavior. These are automated local tests with injected transports, not live Meta sends or production DB validation.

## Blockers before activation request

1. Establish and complete the supported OAuth route; obtain completed synthetic model responses with usage/latency evidence in all three languages. No credentialed API test has run.
2. Give isolated CRM a proper disposable persistent data API/DB and test signed relay, ownership, handoff and outbox against it. Do not copy production secrets or rely on JSON fallback.
3. Read-only confirmation of actual Meta app callback/phone binding, token health, production data source and pilot ownership; 200 webhook logs alone are insufficient. OAuth connector does not expose secret values.
4. Verify legacy agent settings from the actual production data source. Preserve staff handling for other customers.
5. Run final-head GitHub jobs, including real Postgres regression, and verify staging deployment results.
6. Prepare protected backup and additive outbox migration on the actual production data source. It is not applied by this work.

## Approval stages and rollback

Stage A, only after blockers are closed: request explicit approval to merge the reviewed head, apply the additive migration and deploy public CRM with all Muse gates OFF. Keep Meta webhook unchanged. Validate existing CRM/WhatsApp functionality, authentication, persistence, internal health and the blocked PDF/draft endpoints.

Stage B, separate approval: allow the one authorized recipient only; worker text-only=true and independent CRM scope enforced. Start with a fresh inbound from that handset inside the service window. Validate safe text receipt, provider id, dedup, staff takeover, model failure and audit evidence. Then turn Muse gates OFF for review. No customer-wide rollout implied.

Rollback: CRM MOOS_ENABLED=false and MOOS_RELAY_ENABLED=false; worker ENABLE_AUTOSEND=false and provider flag=false, applied with service restart/redeploy. Leave existing Meta callback and token intact. A request already accepted by Meta cannot be recalled. Hold outcome_unknown sends for manual reconciliation; do not retry them. Quarantine queued pilot events before reactivation so stale backlog is not replayed. Keep additive outbox data for evidence; do not drop tables during emergency rollback. Prior CRM deployment 5065e41a-a7da-4b83-bfda-531fad3d87e0 was listed as rollback-capable at inspection, but rollback must be separately authorized if needed.

These are tested safeguards plus an activation plan, not a claim of completed production acceptance. No Vercel replacement bot was used.
