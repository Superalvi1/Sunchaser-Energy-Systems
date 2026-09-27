# Sunchaser × WA CRM: isolated Phase 1 handoff

Date: 2026-09-27. Upstream: https://github.com/ArnasDon/wacrm (MIT, currently v0.8.0).
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
3. Provision an isolated Supabase project for the stock template or explicitly
   implement and test an alternative backend. Upstream uses Supabase Postgres,
   Auth, Storage, RLS and realtime; a Railway PostgreSQL DATABASE_URL alone is
   not drop-in compatible. Do not apply its 42 SQL migration files to Sunchaser's
   production/staging CRM database.
4. Set isolated NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
   SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, META_APP_SECRET,
   NEXT_PUBLIC_SITE_URL. Configure optional META_APP_ID and automation cron only
   when needed. NEXT_PUBLIC_* values need to exist at build time with the
   upstream Dockerfile; Railway build strategy/config must pass them as Docker
   build args, or adapt the fork to Nixpacks/Node with appropriate build vars.
   No credentials in Git, PRs, test logs, or ChatGPT.
5. Use a Meta test-number/WABA first. **Do not register, subscribe, disconnect
   or change the webhook for the existing Sunchaser business phone number.**
6. Test signup/login, inbox, one inbound+outbound test exchange, authorized
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
- Preserve current Railway, Render, Vercel and Supabase deployments and rollback.

## Acceptance criteria for next phase

1. Sandbox WA CRM is deployed and authenticated with isolated credentials.
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
