# Railway CRM backend: isolated staging preflight

This is **not** a database migration or a production deployment. Keep the
Render production API, Supabase project, Vercel CRM frontend, Meta webhook URL,
customer portals, and production DNS unchanged throughout the pilot.

## Deployment scope and blockers

The root project runs an Express API + Vite SPA, Playwright/Chromium-based PDF
generation, WhatsApp/Meta webhooks and scheduled backup logic. Unlike the
marketing website, it handles customer accounts and financial documents.
Never expose an unauthenticated staging instance or seed data publicly.

The previous entrypoint hard-coded port 3000. This branch adds
`resolveListenPort` to respect Railway's injected `PORT`, keeping 3000 as the
Render/local fallback.

**Do not deploy a CRM runtime connected to production Supabase or Meta.**
A staging runtime requires one of:

1. A separate, disposable Supabase project with synthetic accounts and
   redacted/mock documents plus a new, isolated JWT secret; or
2. A narrowly scoped private-network build/start smoke test with every
   external integration, webhook, cron and public domain disabled. A local
   `database.json` fallback is ephemeral and must not be presented as a
   production database test.

The second option can validate building and booting only; it does not verify
authentication, customer portals, RLS, media permissions or persistent data.

## Railway staging service configuration

GitHub source: `Superalvi1/Sunchaser-Energy-Systems`
Branch: `chore/railway-crm-staging-preflight-20260923`
Root: `/`
Builder: Railpack, Node 22.
Build script: `npm run build` (includes Playwright Chromium install).
Start: `npm run start`
Healthcheck path: `/health`.
**No generated or custom public domain** at this phase.

The Railway trial currently has a **1 GiB RAM limit**, so Chromium PDF
generation may exceed it. A successful boot does not establish PDF readiness.

Safe variables for an eventual private-only smoke test:

```text
NODE_ENV=production
MARKETPLACE_ENABLED=false
MARKETPLACE_CART_ENABLED=false
MARKETPLACE_CHECKOUT_ENABLED=false
MARKETPLACE_PAYMENTS_ENABLED=false
MARKETPLACE_COD_ENABLED=false
MARKETPLACE_GATEWAY_ENABLED=false
MARKETPLACE_CATALOGUE_SOURCE=static
WHATSAPP_CONVERSATIONS_ENABLED=false
WHATSAPP_AI_QUERY_DRAFT_ENABLED=false
WHATSAPP_AI_AUTO_REPLY_ENABLED=false
WHATSAPP_AI_LIVE_PROVIDER_ENABLED=false
UNIFIED_MESSAGING_POSTGRES_ENABLED=false
PUBLIC_LEAD_API_KEY=  # intentionally absent; leads must remain closed
JWT_EXPIRES_IN=8h
```

Set `JWT_SECRET` via Railway's protected variables **only**, using a unique
random 32+-character secret generated for staging. Do not commit secrets.
Keep `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`WHATSAPP_ACCESS_TOKEN`, `DATABASE_URL` and all production keys **unset**.

**Before any runtime deployment** review which public routes are enabled by
default, especially registration and local seeded users. Prefer a strictly
private service without an assigned external domain; confirm health
internally or via read-only Railway logs.

## Acceptance

1. `npx tsx server/runtime/listenPort.test.ts` passes.
2. Current Render remains reachable on its existing port.
3. Railway build and initial boot succeed *without production credentials*.
4. Runtime listens on injected `PORT` and private `/health` is healthy.
5. Neither staging startup nor any requests write to live Supabase or
   send WhatsApp, email, merchant orders, or scheduled posts.
6. Compare actual Railway memory, CPU, egress and build time after a short
   pilot. Trial capacity may be too low for the PDF workload.
7. Only once this passes: create an isolated staging database and use
   synthetic records to test permissions, storage and PDF exports.
8. Production cutover requires backup/restore rehearsal, auth/RLS migration
   tests, callback URL plan, monitored traffic, and an explicit rollback plan.

Do not switch live website, DNS, billing, or customer applications as part of
this preflight.

## Observed first private smoke build — September 23, 2026

Railway private service: `sunchaser-crm-private-smoke`
Deployment: `1dff95ef-3650-400c-8dd1-1cbe7c302dfd`.

- GitHub targeted CI passed: listen-port unit tests and esbuild bundle.
- Railway dependency install, Vite build (3,378 modules), esbuild server bundle,
  and Playwright/Chromium downloads completed successfully.
- The service **FAILED at runtime before /health** without Supabase because
  `server.ts` unconditionally calls `buildProductionWebhookAutoLinkLead()`,
  which calls `createProductionWhatsAppServices()` and then
  `createDefaultWhatsAppInboxRepositories()`. The latter requires active
  Supabase persistence **even with `WHATSAPP_CONVERSATIONS_ENABLED=false`**.
  The inbox service options also wire persistent connection stores at startup.
- The error was: `WhatsApp inbox repositories require active Supabase persistence.
  Use createInMemoryWhatsAppInboxRepositories() for tests.`
- No production credentials, Supabase project or Meta webhooks were linked.
  The private service has **no public domain**. Failed deployment is stopped.
- The installation reported 15 npm audit findings (including 2 critical);
  investigate separately before production rollout—do not blindly run
  `npm audit fix --force`. esbuild reported an existing `import.meta`
  warning in the CommonJS server bundle; verify PDF config behavior later.

**Do not work around this by injecting production Supabase secrets into this
private smoke service.** Next stage is a targeted, fail-closed WhatsApp
initialization review with tests to avoid weakening production auth/security,
or a fresh disposable Supabase project with synthetic data. Neither is
completed by this preflight.

## Stage 2: explicit health-only boot without production credentials

Set `RAILWAY_CRM_PRIVATE_SMOKE_MODE=true` on the **private** Railway smoke
service only. Startup rejects any public Railway domain, live database or
WhatsApp credentials, or enabled WhatsApp/marketplace flags. The HTTP guard
returns 404 for every route except `GET /health`; WhatsApp persistence wiring
is skipped only for this mode. Normal Render/CRM behavior is unchanged.

This tests only application boot, port binding and build compatibility; it
cannot verify customer login, Supabase authorization, PDF rendering, or
persistence. Next phase uses a new synthetic-data staging database and
isolated keys, and removes the smoke flag before functional testing.

## Production database inventory (read-only; 2026-09-23)

From Sunchaser Production's schema and aggregate-size queries only (no
customer records, passwords or document bytes exported):

- Database: **53 MB**; **142 public tables**. There are also older
  `*_backup_20260606` tables that must not be silently discarded.
- CRM: **112 customers** and **71 leads** at the time of inspection.
- Storage: **10 objects / approximately 18 MB**. Bucket policies and media
  URL behavior need migration validation.
- `auth.users`: **0 users**; inspect the custom `public.users` login and
  password-hash compatibility separately before any user migration.
- Migration registry only lists **3 tracked migrations**, so production
  schema cannot be assumed reproducible by running tracked migrations alone.
  Establish an independently verified schema-only dump and extension/RLS
  inventory before bringing up a disposable staging database.

Recommended order: Railway private boot smoke → fresh isolated staging DB
with no production data → verify auth/RLS/storage/quotes/PDF/inbox in staging →
production-ready parallel traffic, backup/restore rehearsal, and rollback.
Production Supabase remains untouched until all gates pass.
