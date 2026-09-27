# Claude Code handoff: Sunchaser × WA CRM implementation

You are working on the EXISTING Sunchaser production software ecosystem, not starting a replacement CRM. Execute code and deployment tasks, run tests, commit a branch, and provide exact links/evidence. Do not merely return suggestions.

## Repositories and handoff

Sunchaser: https://github.com/Superalvi1/Sunchaser-Energy-Systems
Existing draft PR #99: https://github.com/Superalvi1/Sunchaser-Energy-Systems/pull/99
Branch: feat/wacrm-isolated-readonly-integration
Upstream: https://github.com/ArnasDon/wacrm (MIT licensed)
Read the PR code and docs/integrations/wacrm-phase1-handoff.md BEFORE modifying anything.

Railway account project already has deployed CRM and PostgreSQL. Project name "Sunchaser Railway Staging" is misleading: its only environment is named production, so preserve its services. Existing CRM service: sunchaser-crm-private-smoke. Never repurpose or restart it for this work.

## Primary objective

Make an isolated fork of WA CRM work on Railway using a sandbox Meta WhatsApp Business account/test number. Then implement API-based, initially read-only integration with Sunchaser CRM while retaining the existing Sunchaser official Meta Cloud API and inbox as production owner. Long-term one integrated WhatsApp menu in Sunchaser, not two competing CRM customer databases.

## Execution order

1. Confirm GitHub/Railway access and current main SHA. Inspect upstream code, package and the full upstream installation instructions, and review PR #99. Do not overwrite existing branches or duplicate existing integration work. Report relevant changes to upstream since the reviewed SHA.
2. Fork ArnasDon/wacrm to Superalvi1/Sunchaser-WA-CRM (or if already present, check fork origin). Keep LICENSE/MIT attribution. Pin an audited upstream commit. Do not use an upstream main branch floating deployment.
3. Create a dedicated sandbox Railway project/service, not the live CRM project. Isolate its database and secrets. Stock WA CRM requires Supabase Postgres/Auth/Storage/RLS/realtime: use a SEPARATE sandbox Supabase project to prove the upstream app first; do not assume plain Railway PostgreSQL is a drop-in replacement. Do not apply upstream migrations to Sunchaser's existing database. Preserve all current Render/Vercel/Supabase services.
4. Set up sandbox-only environment variables from upstream .env.local.example. Store sensitive values in the connected hosting secret manager, never commit or print them. Next.js NEXT_PUBLIC_* values must be available during build, including if using the Dockerfile build args. Give the sandbox its own generated hostname and verify HTTPS. Do not change any sunchaserenergy.co DNS or production domain.
5. On sandbox, run signup/login, DB migrations, UI render, /api/v1/me and read-only API smoke checks. Generate an account-scoped READ-ONLY API key with contacts:read, conversations:read, messages:read. Set WACRM_INTEGRATION_ENABLED=false on all Sunchaser deployed services until verified. Do not expose the token to browser.
6. Test WhatsApp on an isolated Meta test WABA/number and opted-in test recipients. NEVER register, subscribe, disconnect, transfer, alter webhook for, or use the real Sunchaser business phone. Avoid duplicate Meta webhook handling. No production broadcasts.
7. Extend PR #99's read-only adapter with an authenticated, RBAC-protected Sunchaser backend endpoint ONLY after isolated API checks. Respect current CRM user roles. Add provider-specific external contact mapping, organization scope, dedupe and ambiguity fail-closed. Never automatically overwrite existing leads/customer identity. No schema mutation before reviewed migration.
8. Add an isolated, signed outgoing WA CRM webhook consumer (different URL from existing /api/whatsapp/webhook) only after API proof. Verify raw-body X-Wacrm-Signature HMAC and bounded timestamp freshness, dedupe by event UUID, durable retry/reconciliation, no cross-tenant spoofing. Test replay/invalid signature/out-of-order statuses.
9. Design single-writer routing: Sunchaser's current Meta transport remains sole production owner. WA CRM sandbox must not independently respond to Sunchaser's real WABA. If useful upstream inbox/automation/AI UX modules are ported, adapt them to the existing src/inbox/, server/unifiedMessaging/ and unified CRM RBAC rather than embedding a second login via iframe.
10. Implement AI assistant as DRAFT ONLY at first, with explicit human send action. Ground outputs in verified Sunchaser knowledge/catalog and live SmartQuote data; no invented prices, discounts, warranty guarantees, duplicate replies, unattended promotional sends, or automatic quote approval.
11. Test on fake/demo data: account isolation, read scope, webhook HMAC/replay, identity collisions (e.g. Pakistani 03xx vs +923xx), no credential leaks, no double send, existing WhatsApp tests, lead-link workflow, quote routing. Run PR #99's Node contract CI plus applicable npm scripts; document any baseline failures.
12. Create separate focused PRs for integration, database migrations, and controlled outbound switching. Do not merge/deploy production changes until tested and explicitly approved. Provide a final status matrix with commits/PRs, sandbox URLs, test results, all missing external credentials/permissions, rollback, and evidence.

## Safety gates

- Existing Meta and WhatsApp Business App Coexistence (Embedded Signup) code must not change at the webhook URL level.
- Keep Render, Vercel and Supabase active until verified Railway parity and backup/rollback.
- No production phone number API registration or webhook subscription without explicit approval.
- Never put secrets, session tokens, customer phone numbers or real chat content into public GitHub.
- No "just connect both" if each application could auto-reply to the same inbound event.
- API upstream documents best-effort outbound event webhook and process-local rate limiting; add reconciliation/durable processing before production.
- WA CRM public API documented sends need E.164 +countrycode; guard against wrong-country deliveries.
- No autonomous mass broadcasts. Obtain and store opt-in/opt-out status; use approved Meta templates where required.

## Deliverable

A WORKING isolated WA CRM sandbox on Railway with one test-number message roundtrip and Sunchaser read-only integration contract/tests, or a precise blockers report if a Meta/Supabase permission prevents completion. Do not claim a deploy, message delivery, domain configuration, or end-to-end connection without evidence. Preserve existing Sunchaser production traffic.
