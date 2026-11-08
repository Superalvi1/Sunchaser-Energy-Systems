# Claude Code handoff: Sunchaser × WA CRM implementation (Railway-only update 2026-09-28)

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
3. **Authoritative user decision: Railway-only for all NEW WA CRM deployments.**
Create a dedicated sandbox Railway project/service with an isolated Railway
PostgreSQL database and private credentials. Do NOT create a new hosted Supabase,
Vercel or Render project, or add a paid subscription to any of them. Do NOT
connect the fork directly to the live Sunchaser CRM database. Inspect every
upstream Supabase dependency (DB/PostgREST, Auth, Storage, Realtime, RLS,
functions); a Railway PostgreSQL DATABASE_URL alone is NOT a replacement.
Choose and implement the smallest safe Railway-native backend/auth/storage
integration, preferentially sharing the existing Sunchaser auth/RBAC and
selectively porting WA CRM modules. A separately isolated, fully self-hosted
Supabase-compatible stack on Railway is an alternate only if documented and
proved superior in complexity/cost/security. Review/translate upstream's 42
migrations for the target; do not blindly run them on current CRM data.
4. Configure ONLY Railway sandbox variables, referencing the actual
Railway-native backend implemented. Preserve secure server-side secrets and
ensure any NEXT_PUBLIC_* build vars are public-safe and available at build
time. Remove old Supabase variables if not using an actually deployed
Railway-hosted compatible service. Use a generated Railway hostname with
HTTPS first; do not change sunchaserenergy.co DNS or production domain.
Before any new costly Railway resources, inspect current usage and the
incremental costs, and prefer a minimal single-instance pilot.
5. On Railway-only sandbox, verify database migrations, isolated signup/login
(or existing CRM SSO), UI, Auth/RLS-equivalent ownership, media storage and
realtime behavior, /api/v1/me and read-only API. Generate a scoped READ-ONLY key
for contacts:read, conversations:read, messages:read. Keep
WACRM_INTEGRATION_ENABLED=false in production until proven safe, and never
expose secrets to the browser. If porting changes the upstream REST contract,
update adapter tests and API documentation in the same PR.
6. Test WhatsApp on an isolated Meta test WABA/number and opted-in test recipients. NEVER register, subscribe, disconnect, transfer, alter webhook for, or use the real Sunchaser business phone. Avoid duplicate Meta webhook handling. No production broadcasts.
7. Extend PR #99's read-only adapter with an authenticated, RBAC-protected Sunchaser backend endpoint ONLY after isolated API checks. Respect current CRM user roles. Add provider-specific external contact mapping, organization scope, dedupe and ambiguity fail-closed. Never automatically overwrite existing leads/customer identity. No schema mutation before reviewed migration.
8. Add an isolated, signed outgoing WA CRM webhook consumer (different URL from existing /api/whatsapp/webhook) only after API proof. Verify raw-body X-Wacrm-Signature HMAC and bounded timestamp freshness, dedupe by event UUID, durable retry/reconciliation, no cross-tenant spoofing. Test replay/invalid signature/out-of-order statuses.
9. Design single-writer routing: Sunchaser's current Meta transport remains sole production owner. WA CRM sandbox must not independently respond to Sunchaser's real WABA. If useful upstream inbox/automation/AI UX modules are ported, adapt them to the existing src/inbox/, server/unifiedMessaging/ and unified CRM RBAC rather than embedding a second login via iframe.
10. Implement AI assistant as DRAFT ONLY at first, with explicit human send action. Ground outputs in verified Sunchaser knowledge/catalog and live SmartQuote data; no invented prices, discounts, warranty guarantees, duplicate replies, unattended promotional sends, or automatic quote approval.
11. Test on fake/demo data: account isolation, read scope, webhook HMAC/replay, identity collisions (e.g. Pakistani 03xx vs +923xx), no credential leaks, no double send, existing WhatsApp tests, lead-link workflow, quote routing. Run PR #99's Node contract CI plus applicable npm scripts; document any baseline failures.
12. Create separate focused PRs for integration, database migrations, and controlled outbound switching. Do not merge/deploy production changes until tested and explicitly approved. Provide a final status matrix with commits/PRs, sandbox URLs, test results, all missing external credentials/permissions, rollback, and evidence.

## Safety gates

- Existing Meta and WhatsApp Business App Coexistence (Embedded Signup) code must not change at the webhook URL level.
- Railway is the destination for all new WA CRM infrastructure. User reports
  existing CRM cutover is complete. Verify current Railway data ownership and
  backup/rollback, but do not create/re-enable hosted Supabase, Render, or
  Vercel resources or cancel unrelated subscriptions as part of this change.
- No production phone number API registration or webhook subscription without explicit approval.
- Never put secrets, session tokens, customer phone numbers or real chat content into public GitHub.
- No "just connect both" if each application could auto-reply to the same inbound event.
- API upstream documents best-effort outbound event webhook and process-local rate limiting; add reconciliation/durable processing before production.
- WA CRM public API documented sends need E.164 +countrycode; guard against wrong-country deliveries.
- No autonomous mass broadcasts. Obtain and store opt-in/opt-out status; use approved Meta templates where required.

## Deliverable

A WORKING Railway-only WA CRM sandbox with isolated Railway PostgreSQL and
fully supported auth/storage/realtime, one test-number WhatsApp roundtrip, and
Sunchaser read-only integration contract/tests; or an explicit blockers report
naming any missing Railway/Meta permissions, implementation debt, or cost gates.
Do not claim deployment, message delivery, DNS changes, or end-to-end
connection without evidence. Preserve Sunchaser's existing Railway production
traffic.
