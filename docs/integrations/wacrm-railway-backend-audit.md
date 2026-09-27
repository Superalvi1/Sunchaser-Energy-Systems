# WA CRM on Railway: Supabase dependency audit and backend decision

Date: 2026-09-28. Fork: https://github.com/Superalvi1/Sunchaser-WA-CRM
Pinned upstream commit: `aee1b01f4b557870f1bbf9e7f566a2759e8f20f3` (v0.8.0, 2026-09-21)
Pinned deployment branch: `sunchaser-pinned-aee1b01` (never deploy upstream `main`).
Railway sandbox project: `Sunchaser WA CRM Sandbox` (`032d2726-7784-4cca-bb70-6b4d17a147e8`).

## Why this document exists

The Railway-only update asks for upstream's Supabase dependencies to be audited
and replaced. This measures that surface first, because the size of it decides
which replacement is actually safe.

## Measured coupling at the pinned commit

Counted over `src/` (`*.ts`, `*.tsx`) and `supabase/migrations/`:

| Surface | Measure | Count |
|---|---|---|
| App files | `.ts` / `.tsx` under `src/` | 393 |
| Files importing Supabase | files matching `supabase` | 164 |
| Total Supabase references | occurrences | 803 |
| PostgREST table access | `.from(` | 466 |
| PostgREST reads | `.select(` | 300 |
| PostgREST filters | `.eq(` | 417 |
| Writes | `.insert(` / `.update(` / `.upsert(` / `.delete(` | 58 / 100 / 7 / 43 |
| Stored procedures | `.rpc(` | 15 |
| Auth calls | `auth.getUser` / `getSession` / others | 24 / 12 / 10 |
| Storage | `.storage` | 21 |
| Realtime | `.channel(` / `realtime` | 7 / 39 |
| **RLS policies** | `CREATE POLICY` across 23 migration files | **155** |

Upstream `docker-compose.yml` defines only the `app` service: it assumes a
Supabase-compatible API endpoint exists. `.env.local.example` requires
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`. Migration 030 additionally wants `pgvector`.

## What this rules out

**Rewriting the data layer to plain SQL/Prisma against a Railway
`DATABASE_URL` is not a viable next step.** It would touch on the order of
1,000 call sites and, critically, require re-implementing **155 RLS policies**
as hand-written application authorization. Tenancy upstream is per-user
(`user_id UUID REFERENCES auth.users(id)` on every table); a single missed
policy is a cross-account data leak. The effort is large and the failure mode
is silent.

Setting only `DATABASE_URL` is likewise impossible: `@supabase/supabase-js`
speaks HTTP to PostgREST/GoTrue/Storage/Realtime, not the Postgres wire
protocol.

## Decision

Use the Railway sandbox as an **evaluation and module-harvest environment**,
not as a second production CRM, and give it a **self-hosted,
Supabase-compatible API stack on Railway** rather than a rewritten data layer.

This is the alternate the handoff permits "only if documented and proved
superior in complexity/cost/security". On all three axes it is:

- **Complexity** — 0 changed call sites versus ~1,000.
- **Security** — the 155 reviewed RLS policies keep running in Postgres,
  instead of being re-expressed by hand.
- **Cost** — one Railway project either way; no hosted Supabase, Vercel or
  Render project is created.

Minimal pilot stack, in the sandbox project only:

1. `Postgres` — Railway managed, already provisioned, isolated. **Never the
   production CRM database.**
2. `postgrest` — serves `/rest/v1`.
3. `gotrue` — serves `/auth/v1`.
4. `gateway` — path-routes `/rest/v1`, `/auth/v1` (later `/storage/v1`,
   `/realtime/v1`) and presents one HTTPS origin as
   `NEXT_PUBLIC_SUPABASE_URL`.
5. `wacrm` — the pinned fork.

Storage (21 sites) and Realtime (7 channels) are deferred to a second pass:
they are not needed to prove signup/login, migrations, `/api/v1/me` and the
read-only endpoints, and the handoff asks for a minimal single-instance pilot.

The long-term target is unchanged and this decision serves it: selectively port
WA CRM modules into Sunchaser's existing `src/inbox/`,
`server/unifiedMessaging/` and CRM RBAC. No second authentication system
reaches Sunchaser production, because the sandbox auth stack stays in the
sandbox.

## Migrations

Upstream's 42 SQL migrations run against the **sandbox** Postgres only. They
are never applied to the Sunchaser production or staging CRM database. They
need a Supabase-shaped target first: they reference `auth.users`, the
`auth`/`storage` schemas, and the `anon` / `authenticated` / `service_role`
roles, which the GoTrue + PostgREST stack above provides.

## Cost note (Railway HOBBY, $5 included usage)

The pilot adds four small always-on services beyond the existing projects.
Railway bills by consumption, so the exact figure depends on idle footprint;
a 4–5 service pilot of this shape is expected to run **above the $5 included
credit**, in the rough range of **$8–18/month**, i.e. an incremental **$5–13**
against today's bill. This is an estimate from Railway's per-GB-RAM and
per-vCPU pricing, not a quoted price. Confirm before the remaining three
services are provisioned.

## Status at time of writing

Done: fork created (MIT preserved), upstream commit pinned, sandbox Railway
project created, isolated Postgres provisioned and `SUCCESS`.

Not done, and why:

- `postgrest` / `gotrue` / `gateway` / `wacrm` services — pending the cost
  confirmation above.
- Meta test number roundtrip — **blocked**: requires a test WABA/number and
  opted-in test recipients from the Sunchaser Meta developer app. No Meta
  credentials are available to this environment, and the production number is
  deliberately untouched.
- Sunchaser-side RBAC endpoint and signed webhook consumer — gated by the
  handoff behind isolated API proof, which needs the stack above.

`WACRM_INTEGRATION_ENABLED` remains `false` everywhere.
