# Railway staging parity — status and cutover gates (2026-09-24)

Production (Render API, Vercel frontends, Supabase) is unchanged and remains
authoritative. No DNS, webhook, or production configuration was changed.

## Automated suite

`scripts/railway-staging-parity.mjs`, run by
`.github/workflows/railway-staging-parity.yml` from GitHub Actions (the
Railway hosts are not reachable from every environment). It refuses any origin
other than `*.up.railway.app`; the optional production reference is a
public, read-only catalogue GET against `*.onrender.com`.

Output contains statuses, counts and byte sizes only — no tokens, passwords
or record fields.

| Area | Check | Mode |
|---|---|---|
| Auth | 15 staff routes return 401 anonymously | read-only |
| Permissions | Same 15 routes return 403 for a Customer token; foreign portal/invoice denied | read-only |
| Storage | Unsigned object request rejected | read-only |
| Lead gateway | `POST /api/public/leads` without key → 401 | read-only |
| Marketplace | Checkout fail-closed; catalogue source = `database` | read-only |
| Website | `/`, `/shop`, `/solar-panels`, `/contact`, robots, sitemap; shop shows live count | read-only |
| Customer portal | Synthetic customer: register, login, me/invoices/payments/warranties/documents/system | Railway-only write |
| Staff modules | Login (existing account), roles, users, clients, leads, quotations, invoices, payments/finance, warranties, deliveries, inventory, proposals, documents, portal, backup export, invoice render, quotation PDF, Chromium, WhatsApp status/inbox (read) | GET-only; needs secrets |
| Website → CRM lead | One synthetic lead via `/api/ai-lead`, then confirmed in Railway CRM | opt-in write |

### Enabling the staff checks

Add repository secrets `RAILWAY_PARITY_STAFF_USERNAME` and
`RAILWAY_PARITY_STAFF_PASSWORD` (an existing staff account). Values are
masked by GitHub and never printed by the script.

### Enabling the website lead check

Confirm the Railway website service's `CRM_PUBLIC_LEAD_ENDPOINT` is
`https://sunchaser-crm-private-smoke-production.up.railway.app/api/public/leads`
(not Render) and its `CRM_PUBLIC_LEAD_API_KEY` matches the Railway CRM
`PUBLIC_LEAD_API_KEY`. Then run the workflow manually with
`site_lead_write=true`. If the endpoint still points at Render, the synthetic
lead would be written to production Supabase.

Public lead creation also calls `triggerWhatsAppNotification`, which only
records a `whatsapp_logs` row (no message is sent).

## Evidence so far

- Railway parity run 3 (`9564cce`): **24 pass / 0 fail / 2 skip**
  (skips: staff secrets absent; lead write not enabled).
- Catalogue parity with production: production API 736, Railway 736,
  0 missing, 0 extra (matched by slug). Website `/shop` renders 736.
  Supabase has 768 `public_visible` rows; both APIs publish 736, so the
  difference is the API's own filtering, identical on both sides.
- Synthetic Railway customers are absent from production Supabase
  (0 matching users/customers; production users still 7) — Railway CRM
  writes do not reach Supabase.

## Data drift since the 03:40 UTC snapshot (production, aggregate only)

| Table | Railway snapshot | Production now |
|---|---|---|
| customers | 119 | 121 |
| leads (total / active) | 78 / 28 | 80 / 25 |
| activity_logs | 1,300 | 1,307 |
| users / invoices / mp_products / storage objects | 7 / 132 / 768 / 10 | unchanged |

Production rows with `created_at` after 03:40 UTC: customers 8, leads 8,
activity_logs 13, users 0. The import ran after 03:40, so some of these may
already be on Railway; exact per-ID reconciliation needs the Railway database.

**Gap:** `ops/railway-db/migrate-api-merge.py` (marketing repo) only inserts
missing rows (`on conflict do nothing`). Updates to rows that already exist
on Railway are not carried over. At least one pre-snapshot lead was
soft-deleted in production after the snapshot, and `leads`/`customers` have no
`updated_at`, so status edits cannot be detected incrementally.

**Required cutover approach:** put production in a short write freeze
(maintenance banner or Render read-only), take a fresh full re-import (or a
merge that also updates rows by primary key), verify aggregates, then switch.
The insert-only merge alone is not sufficient for parity.

## Remaining gates before DNS cutover

1. Staff login and staff module checks pass (needs secrets above).
2. Website → Railway CRM lead flow passes (needs endpoint confirmation).
3. Write-freeze + full re-import plan agreed; aggregates re-verified.
4. Synthetic Railway rows removed (`cleanup-test-data` phase; note it does not
   cover `whatsapp_logs`).
5. Rollback rehearsal: DNS TTL lowered in advance; Render/Vercel/Supabase kept
   running; documented steps to point `crm.` and `www.` back to Vercel and to
   export any Railway-only writes back to Supabase if rollback happens after
   traffic moved.
6. Meta/WhatsApp webhook callback URL change planned separately; no real
   customer messaging tests without explicit approval.
