# Sunchaser × WA CRM: isolated Phase 1 handoff

Date: 2026-09-27; updated for Railway-only infrastructure 2026-09-28. Upstream: https://github.com/ArnasDon/wacrm (MIT, currently v0.8.0).
Sunchaser repository: https://github.com/Superalvi1/Sunchaser-Energy-Systems
Branch: `feat/wacrm-isolated-readonly-integration`.

## What this branch actually delivers

- `server/integrations/wacrm/wacrmReadOnlyClient.ts`: a server-only, opt-in,
  read-only API client for WA CRM's `/api/v1`.
- `server/integrations/wacrm/wacrmReadOnlyClient.test.ts`: mocked, no-network
  contract tests. It covers default-off behavior, HTTPS-only origin validation,
  account/scope verification, encoded pagination, invalid IDs, and secret-redacted
  upstream errors.
- No production server mount, no database changes, no outbound send method,
  no connection changes, no Meta app registration, no new Railway service,
  no legacy-provider retirement.

### Fail-closed configuration (only for an isolated WA CRM instance)

```env
WACRM_INTEGRATION_ENABLED=false
WACRM_BASE_URL=https://<your-isolated-wa-crm-host>
WACRM_READONLY_API_KEY=<account-scoped-key-with-read-scopes>
```

Keep the flag false in all existing production services. When validating a
standalone isolated service, create a key under WA CRM Settings > API keys with
only `contacts:read`, `conversations:read`, and `messages:read` (if checking
`GET /api/v1/me` only, a key with no scopes is adequate). No `messages:send`,
`broadcasts:send`, `contacts:write` or `webhooks:manage` at this stage.
Never use the Meta access token as this API key.

Run the contract test:
```bash
node --experimental-strip-types server/integrations/wacrm/wacrmReadOnlyClient.test.ts
```

## Deployment prerequisite — do not deploy upstream into existing CRM service

Railway project `Sunchaser Railway Staging`:
`11d4acc0-4f19-4c05-a41c-fa20d3b235af`;
existing environment `a3fcb877-f02b-44b5-af5c-f03fac71f05b`
is named `production` even though the project is labeled staging. Treat it as
production-capable. Existing `sunchaser-crm-private-smoke` and
`postgres-staging` must remain unchanged.

1. Fork `ArnasDon/wacrm` into `Superalvi1/Sunchaser-WA-CRM`, recording its
   upstream SHA and preserving the MIT copyright notice. GitHub fork/create
   functionality is not exposed by the current connector, so no fork was made
   as part of this branch.
2. Make a dedicated Railway **sandbox** project/environment for the fork,
   preferably separate from Sunchaser Railway Staging. Connect the new fork.
3. **Railway-only deployment requirement (user update, 2026-09-28):** Do not
   create a new hosted Supabase, Vercel, or Render project. Fork the upstream
   application and perform a dependency audit of all Supabase client/server,
   auth, storage, realtime, edge-function and RLS calls. Provision an isolated
   Railway PostgreSQL service/DB for the sandbox; do not point any forked
   service at the current production CRM database.
4. Stock upstream is NOT PostgreSQL-only: merely setting DATABASE_URL cannot
   make it run on Railway PostgreSQL. Implement a tested Railway-native
   persistence/auth/storage/realtime abstraction or, only if fully audited and
   isolated, deploy the required Supabase-compatible components self-hosted on
   Railway. Prefer reusing the established Sunchaser CRM auth/roles and porting
   useful WA CRM modules rather than duplicating auth stacks. Preserve all
   security semantics and migration parity. Upstream's 42 SQL migrations must
   be reviewed and translated as needed; never apply them wholesale to the
   Sunchaser production or staging CRM database.
5. Keep any needed legacy NEXT_PUBLIC_SUPABASE_*/SUPABASE_* compatibility
   variables **sandbox-local** only if a complete Railway-hosted compatible
   backend was actually deployed; otherwise remove their use in the fork.
   Store all credentials in Railway private environment variables and verify
   build-time NEXT_PUBLIC_* injection. No credentials in Git, PRs, tests or
   ChatGPT. No production DNS changes.
6. Use a Meta test-number/WABA first. **Do not register, subscribe, disconnect
   or change the webhook for the existing Sunchaser business phone number.**
7. Test signup/login, inbox, one inbound+outbound test exchange, authorized
   API read scopes, message status, media and template dry-run/approval flows.
   If an outbound live test is required, use the sandbox number and explicit
   test recipients, not customer contacts.

## Integration design — one production owner

Current Sunchaser official Meta transport is in
`server/whatsappTransport/`, inbox in `src/inbox/`, and normalized messaging
contracts in `server/unifiedMessaging/`. Keep it the production owner while
the WA CRM fork is assessed. Two independent handlers must not process and
auto-reply to the same Meta webhook/phone number.

Short term: compare useful WA CRM UX/automation/AI modules and verify its
REST integration against sandbox. Long term: selectively port features into
Sunchaser's inbox and routing. Do not permanently run duplicate lead/customer
data stores, separate employee authentication systems, or competing AI senders.

### Next PR boundaries

- Adapter read-only routes under existing JWT+RBAC, if needed, never expose the
  account-scoped bearer key to the browser.
- Persist external-contact `(provider, external_account_id, external_contact_id)`
  to Sunchaser identity mappings, scoped by organization and connection.
  Avoid matching by phone alone if a lead link is ambiguous. Preserve consent.
- Signed WA CRM outbound event webhook: verify exact raw body plus
  `X-Wacrm-Signature: t=<unix_seconds>,v1=<hex>`; use constant-time HMAC,
  enforce short timestamp freshness, deduplicate by delivery event `id`,
  persist to outbox and reconcile best-effort delivery losses. Use a new path,
  e.g. `/api/integrations/wacrm/events`; do NOT alter Meta's existing
  `/api/whatsapp/webhook`.
- Build explicit provider ownership and a dry-run shadow mode before allowing
  WA CRM sends. Reject duplicate outbound attempts by idempotency key.
- AI must begin in **draft-only / human approval**; no self-approved quotes,
  invented pricing, unauthorized discounts, autonomous bulk sends or silent
  credential changes.
- Railway is the deployment destination for all new WA CRM infrastructure.
  Do not re-enable or create hosted Supabase/Render/Vercel dependencies; preserve
  current production data, backup, rollback and unrelated services.

## Acceptance criteria for next phase

1. Sandbox WA CRM runs entirely on Railway with isolated credentials and a
   separately verified database/auth/storage/realtime strategy.
2. Read-only `GET /api/v1/me`, contacts, conversations and messages work.
3. No request to upstream `POST /api/v1/messages` from Sunchaser.
4. Sunchaser official Meta inbox, lead linking and existing webhook regression
   tests remain green.
5. Database cross-contamination, token/browser leakage, double send,
   webhook replay and customer-identity collision tests pass.
6. Only then consider a production number/coexistence migration design.

## Sources

- https://github.com/ArnasDon/wacrm/blob/main/README.md
- https://github.com/ArnasDon/wacrm/blob/main/docs/public-api.md
- https://github.com/ArnasDon/wacrm/blob/main/docs/multi-waba.md
- https://github.com/ArnasDon/wacrm/blob/main/.env.local.example
- https://github.com/Superalvi1/Sunchaser-Energy-Systems/blob/main/docs/architecture/unified-messaging-current-state.md
- https://github.com/Superalvi1/Sunchaser-Energy-Systems/blob/main/docs/architecture/unified-messaging-transport-contract.md
