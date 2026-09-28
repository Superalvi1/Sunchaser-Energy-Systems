# WA CRM: selective integration decision (supersedes standalone-stack proposal)

Date: 2026-09-28. Status: **decided — selective integration into Sunchaser CRM.**
Fork (reference only): https://github.com/Superalvi1/Sunchaser-WA-CRM
Pinned upstream commit: `aee1b01f4b557870f1bbf9e7f566a2759e8f20f3` (v0.8.0, 2026-09-21),
branch `sunchaser-pinned-aee1b01`. Upstream is MIT licensed.

## Decision

WA CRM will **not** run as a standalone application. Useful upstream modules are
ported into the existing Sunchaser CRM, on its existing JWT/RBAC, Railway
infrastructure, customer records, WhatsApp inbox and official Meta Cloud API
transport. The fork and its pinned branch are kept as reference source only.

**Superseded:** the earlier revision of this document proposed a self-hosted
Supabase-compatible stack (Postgres + PostgREST + GoTrue + gateway + app) in a
Railway sandbox. That proposal is withdrawn and none of those services will be
provisioned. Its cost estimate of $8–18/month was also overstated; see below.

## Why

### 1. Only one application may own the production number

Sunchaser's official transport owns the Meta webhook and the production
WhatsApp number, and the single-writer rule forbids two handlers replying to
the same inbound event. A standalone WA CRM could therefore only ever run
against a test number. Anything built to connect it long-term would be glue
for a system that cannot serve real customers.

### 2. It would create a second customer database and a second login

Standalone WA CRM brings its own auth (GoTrue) and its own contacts store,
which would need a two-way sync and dedupe layer against Sunchaser leads. That
contradicts the goal of one integrated WhatsApp menu with one customer record.

### 3. The upstream backend is deeply Supabase-bound

Measured at the pinned commit over `src/` and `supabase/migrations/`:

| Surface | Count |
|---|---|
| App files (`.ts`/`.tsx`) | 393 |
| PostgREST `.from(` call sites | 466 |
| `.select(` / `.eq(` | 300 / 417 |
| Writes (`insert`/`update`/`upsert`/`delete`) | 208 |
| `.rpc(` | 15 |
| Auth calls | 46 |
| `.storage` / realtime channels | 21 / 7 |
| `CREATE POLICY` RLS rules | 155 across 23 migrations |

Running it on a plain Railway `DATABASE_URL` is impossible (`supabase-js`
speaks HTTP to PostgREST/GoTrue, not the Postgres wire protocol), and
rewriting its data layer means ~1,000 call sites plus re-implementing 155
tenant-isolation policies by hand.

### 4. The reusable value is in the logic, not the plumbing

Supabase references are concentrated in data access. The business logic in the
modules Sunchaser lacks is comparatively decoupled — e.g. flows 6,153 LOC with
14 Supabase references, automations 2,924 LOC with 21, notifications 563 LOC
with 0. That logic ports cleanly onto Sunchaser's repositories.

## Gap analysis

Already present in Sunchaser (no port needed): official Meta webhook and
outbound transport, inbox, conversations, assignment, CRM lead linking, AI
drafts, AI engine/query agent, knowledge base, inbound media, the 24-hour
customer-service window guard, and RBAC.

Missing, and ported in this order:

1. **Approved message templates and template sending** — the only compliant
   way to message a customer outside the 24-hour window. Sunchaser has no
   template-send code today.
2. **Staff notifications.**
3. **Consent tracking** — opt-in, opt-out, source, timestamp, audit history.
4. **Broadcasts** — permission-controlled, approved templates only, rate
   limited, deduplicated, opted-out recipients suppressed. Depends on 1 and 3.
5. **Automations and conversation flows.**

Each is a separate focused PR with reviewed migrations. Adapted upstream code
carries an MIT attribution header naming the source path and pinned commit.

## Cost

Selective integration adds **no infrastructure**: ported features run in the
existing Railway CRM service and database.

For the record, the standalone option was re-estimated from measured idle
usage — the sandbox Postgres used ~66 MB RAM, ~0.0001 vCPU and a 138 MB volume
over a day, about $0.70/month — giving roughly **$4–7/month** for the full
stack, not $8–18. Estimated from Railway's published rates, not quoted.

## Sandbox project status

Project `Sunchaser WA CRM Sandbox` (`032d2726-7784-4cca-bb70-6b4d17a147e8`)
holds a single `Postgres` service created 2026-09-27 and never attached to an
application. It is retained until its deletion has been reviewed; see the PR
for the verification findings.

## PR #99 read-only adapter

Under this decision there is no WA CRM instance for
`server/integrations/wacrm/wacrmReadOnlyClient.ts` to call. It is not imported
by any server or client code and reads no configuration outside its own module,
so it cannot enter the esbuild server bundle, but merging it would add
unused code and a CI workflow to maintain. Recommendation: do not merge the
adapter; keep the documentation.
