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
