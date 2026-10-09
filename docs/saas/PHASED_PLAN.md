# Paid solar-company pilots: phased implementation plan

Status: **plan + Phase 0 inventory only.** Nothing here has been deployed, migrated or rotated.
Branch: `claude/saas-pilot-multi-company`, stacked on pull request #111 (`claude/fervent-goodall-jz9g7m`).
Merge order when approved: #111 first, then this branch phase by phase.

> **Readiness statement.** This codebase is **not** multi-company ready. It becomes pilot-ready only when
> the isolation suite (Phase 7) and a full restore test pass on two synthetic companies. Until then no
> document, PR text or message may describe it as "SaaS ready".

## 1. What exists today (inspected, not assumed)

| Area | Fact | Source |
|---|---|---|
| Runtime | One Express app, `server.ts` (10.7k lines, 275 routes) plus about 15 router files; React/Vite SPA; Capacitor Android shell | repo |
| Data access | One process-wide **service-role** Supabase client (`getSupabase()` in `dbManager.ts`) talking to a private PostgREST. Roughly 100 modules call it. The service role bypasses RLS, so the database enforces nothing per user today | `dbManager.ts` |
| Hosting | Railway: CRM service (builds from `main`, one replica), PostgreSQL 17 container on a 1 GB volume, PostgREST, S3-compatible bucket, daily price-sync cron, WhatsApp/quote gateway services | Railway config (names only) |
| Tenancy | None. WhatsApp tables carry `company_id text default 'sunchaser'`, declared in their own schema comment as "NOT yet a true tenant security boundary". Marketplace pricing hard-codes `'sunchaser'` | `scripts/whatsapp-transport-schema.sql` |
| Singletons | `settings`, `quote_pdf_settings` (read with `order by id limit 1`), `bank_accounts`, `company_terms`, quote templates are global | `brandingDb.ts` |
| Pricing | Smart Quote selling rates are a static catalogue in code, separate from supplier price sync | `src/lib/boqCatalog.ts` |
| Roles | Static role/permission map plus `roles`/`role_permissions` tables; role lives on `users` | `roleManagementDb.ts` |
| AI | Four separate outbound LLM paths (`server/ai/providers/*`, `queryAgentGateway.ts`, `agentProvider.ts`, lead scoring in `server.ts`); token usage is extracted but never stored or limited | repo |
| Jobs | A 5-second AI-agent drain loop and one other interval in the server process; external Railway cron services | repo |
| Bypasses | Raw `pg` in the marketplace auto-import and in the unified-messaging factory; `.from(variable)` generic table helpers; `SECURITY DEFINER`-style RPCs must be audited | repo |
| Schema drift | `bills` is used by code but defined in no tracked SQL; `invoices.created_by_user_id` exists in production only. The production schema must be read before any migration | repo |

Table census (`scripts/saas/table-classification.json`, 141 tables):
64 `tenant`, 14 `tenant_existing_company_id` (WhatsApp), 10 `tenant_config`, 1 `identity`,
2 `role_template`, 12 `dormant`, 38 `sunchaser_only` (marketplace, learning studio).

## 2. Design decisions

| Decision | Options | Choice | Why / trade-off |
|---|---|---|---|
| Tenancy model | database per company / schema per company / shared tables with `company_id` | **Shared tables, `company_id` text** | DB-per-company multiplies Railway cost and migrations; schema-per-company needs PostgREST reconfiguration per company. Row level fits 1 GB of data and ten-ish pilots. |
| Where isolation is enforced | application code only / database only / both | **Both** | App-only relies on every one of hundreds of queries remembering a filter. DB-only needs a rewrite of the data layer. |
| How the database enforces it | per-request JWT with secret in the app / header trusted from the app | **Non-bypass role `crm_tenant` + request header `x-company-id`, read by RLS policies and column defaults** | Existing `.from()` call sites keep working: reads/updates/deletes are filtered by RLS, inserts take `company_id` from a default. Needs only a pre-signed tenant key (no PostgREST signing secret in the app). Limit: it stops *forgotten filters*, not a compromised CRM server, because the server chooses the header. |
| Identity | per-company users / global users + memberships | **Global `users`, new `company_memberships(role, status)`** | A person can work for two companies; role and suspension are per company. |
| Founding company | special case / ordinary tenant | **Ordinary tenant with id `sunchaser`** | Existing WhatsApp rows already say `'sunchaser'`, so no rewrite. Existing records are backfilled to it. |
| Unscoped modules | scope all 141 tables / block what is not scoped | **Block**: `sunchaser_only` and `dormant` tables are invisible to `crm_tenant`; their routes return 404 for other companies | Honest scope for a pilot; marketplace and learning studio are not pilot features. |
| Routes | trust developers / deny by default | **One scope-policy table inside the existing central authorization middleware** (`createAuthorizationMiddleware`, `isPublicApiRoute`): each path prefix is `company`, `public`, `platform` or `blocked-for-pilot`. A test walks the live Express route stack and fails on any route no policy entry matches | 389 route registrations (about 133 under `/api/admin`) cannot be audited by eye on every change; authentication is already central, so scope belongs next to it. |
| Switch | big bang / feature flag | **`MULTI_COMPANY_ENABLED` (default off)**: off resolves every request to `sunchaser` and keeps today's behaviour | Allows deploying schema and code before turning anything on, and a code-only rollback. |
| IDs and uniqueness | keep global | **Include `company_id` in every deterministic id hash and in every business unique key** (`quote_number`, invoice number, `plan_code`, customer code) | Otherwise one company can probe another's quote numbers through 409 responses and numbering collides. |
| Billing | gateway / manual | **Manual payment tracking only**, append-only, voidable | Requested scope; no payment-card data stored. |
| Support | impersonation / consent | **Time-limited, company-granted, read-only support access, fully audited** | No silent cross-company access. |

## 3. Phases

Each phase ships: code, tests, a migration plus rollback where the schema changes, a completion
checklist, and an explicit statement of what was *tested* versus *inspected*.

### Phase 0: inventory and plan (this commit)
- Deliverables: this plan, `scripts/saas/table-classification.json`, a checker test that fails when a table
  in tracked SQL is unclassified.
- Checklist: all 141 tables classified; `bills` and other drift items listed for the production preflight;
  owner reviews the classification and the decision table above.

### Phase 1: credential remediation and verified backup/restore (gated; nothing runs in production without approval)
- 1a Credentials. Private checklist (kept outside this repo); code readiness: signing configuration read from
  environment instead of files, secret scanning in CI, support for overlapping old/new secret during rotation
  where a rotation would otherwise break stored data (signed storage links), repository hygiene commit
  (removal of tracked archives, data exports and keystores from HEAD) prepared but unmerged.
- 1b Backup/restore. `pg-backup` and `restore-verify` tooling, per-table manifest, encryption at rest, a
  restore into a second database, an authenticated application smoke against the restored copy, and
  failure-detection tests. Production execution method needs the owner's choice.
- Gate: the owner approves (i) the backup method, (ii) the rotation order and downtime. Then: production
  backup, restore proof on a scratch PostgreSQL 17, then rotations.
- Rollback: backup artefact retained and restore procedure tested before the first rotation.

### Phase 2: company foundation
- Schema: `companies`, `company_memberships`, `app.current_company_id()`, role `crm_tenant`, RLS framework
  generated from the classification, `company_id` added (nullable, then backfilled to `sunchaser`, then
  `NOT NULL` with FK and index) to the 88 tenant-bearing tables, business unique keys made composite.
- Backend: authenticated company context (`cid` in the token, membership re-checked on every request),
  `AsyncLocalStorage` request context, tenant client from `getSupabase()` inside a company context and an
  explicit `getSystemSupabase()` for platform work, route registry and boot check.
- Tests: database-level isolation for every tenant table (two companies, read/insert/update/delete/upsert,
  missing header fails closed), `SECURITY DEFINER` audit, route registry completeness, flag-off equivalence.
- Migration: additive and idempotent; rollback drops policies/functions and the new columns after copying
  the membership data.

### Phase 3: company-scoped core modules
Order: leads, customers, Smart Quote and quotations; invoices, payments, ledger; documents and storage
(company key prefix, expiring signed links, requester check); customer portal; projects, delivery,
after-sales; inventory; customer support tickets; activity logs; exports and PDFs.
- Tests: for each module, Company B using Company A object ids on every verb returns 404/403 and leaks nothing
  in bodies, headers or error text; deterministic-id collision tests across companies.

### Phase 4: branding and company-specific pricing
- Per-company branding (name, logo, colours, contact, PDF header/footer, terms, bank accounts) replacing the
  singletons; per-company price books (versioned) seeded for `sunchaser` from today's static catalogue.
- Public Smart Quote resolved by company slug with a per-company public key.
- Tests: Sunchaser totals identical before and after on a fixed corpus of configurations; Company B price
  changes never alter Company A quotes; historical quotations keep their stored lines.

### Phase 5: WhatsApp, AI and background jobs
- WhatsApp: a phone-number id belongs to exactly one company (global unique), webhook routed by that id,
  per-company token storage, AI replies still require staff approval.
- AI: one metering gateway around all four call paths; per-company monthly budget from the plan, per-user and
  per-company rate limits, atomic reservation before the call, hard stop with a clear message; retrieval and
  prompt assembly take a company context object.
- Jobs: every loop runs inside an explicit company context; the AI-agent drain becomes company-aware.
- Tests: captured-prompt tests (Company A prompts never contain Company B data), webhook routing, budget
  exhaustion, concurrent reservations.

### Phase 6: onboarding, plan limits, manual subscription payments, support
- Platform admin creates a company and invites its owner (hashed, expiring token); guided checklist: profile,
  branding, pricing, staff, optional WhatsApp, first test quote.
- `saas_plans`, `company_subscriptions`, `company_subscription_payments` (names chosen to avoid the existing
  customer-maintenance `subscription_*` tables). Limits: users, leads/month, storage, AI credits, WhatsApp
  channels. Over-limit blocks **creation only**; reads and exports stay available.
- Support: `saas_support_requests` per company, a platform inbox, consent-based time-limited access grants.
- Tests: limit enforcement at and over the limit, payment recording idempotency and voiding, support access
  expiry and audit.

### Phase 7: certification
- Two synthetic companies across APIs, documents, exports, background jobs, WhatsApp and AI retrieval; full
  restore test on a multi-company dataset; per-company export and restore; Sunchaser record equality before
  and after the migration on a production-shaped copy.
- Output: pass/fail report. Only a full pass permits the sentence "ready for pilots".

## 4. Access the owner must provide (never pasted into chat)

| Need | For |
|---|---|
| Railway project access, ability to set variables and run a one-off job | Backup, restore, rotations, `crm_tenant` key |
| PostgREST signing secret (used offline by the owner to sign the tenant key) | Phase 2 database enforcement |
| Supabase dashboards for every project that ever held keys | Key revocation / project deletion |
| Google Play Console | Android key recovery path |
| GitHub repository admin | Visibility, secret scanning, history purge request |
| Meta business and AI provider consoles | Token rotation |

## 5. Approval gates

| Gate | Needed before |
|---|---|
| G1 | Any production backup job |
| G2 | Any credential rotation (order and downtime window agreed) |
| G3 | Any production migration (preflight on the real schema passed, backup restored OK) |
| G4 | Turning on `MULTI_COMPANY_ENABLED` |
| G5 | Onboarding the first external company |
| G6 | Any history rewrite or Android release |

## 6. Risks

| Risk | Mitigation |
|---|---|
| Hidden unscoped paths (raw SQL, generic table helpers, RPCs) | Classification test, `SECURITY DEFINER` audit, route registry, dormant/blocked classes |
| Production schema differs from tracked SQL | Read-only preflight before every migration |
| Header-based RLS does not protect against a compromised CRM server | Stated limit; keys held only by the CRM; private network; rotation procedure |
| Migration locks on production tables | Measured on the isolated database; additive steps; off-hours window |
| Scope creep | Non-goals below |

## 7. Non-goals

Marketplace and learning studio for pilots, self-serve card payments, custom domains, a rewrite of the data
layer, multi-region, SSO, and any module not named in the request.
