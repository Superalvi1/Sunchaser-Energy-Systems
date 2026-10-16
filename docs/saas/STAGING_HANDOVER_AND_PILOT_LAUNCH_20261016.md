# Sunchaser Sync: staging evidence and pilot launch brief

Status: IN PROGRESS — not approved for paid customer onboarding.
Date: 16 October 2026.
Candidate inspected: af359f05b0af12309d138448246965b9d57274e9 (PR #113 remains draft and unmerged).
This document records actions performed by Codex, separately from Claude's synthetic test reports.

## Verified work

- Created a private Railway project, **Sunchaser Sync SaaS Rehearsal**, with a separate rehearsal environment and object-store bucket.
- Provisioned PostgreSQL 17.11 with a separate 1 GB persistent disk and fresh database credentials. No public database endpoint was created.
- Copied the existing nightly backup recorded at 2026-10-15 20:01:51 UTC into the rehearsal bucket.
- Transfer size: 9,212,386 bytes. SHA-256: e49fc483ed52bd4165a3f693ec56f5bbedd337deff4cc01ec349c3fc68348b05.
- The copier used GET on that one existing backup; it did not connect to the production database. It was deleted after the copy.
- The restore job checked the archive checksum, required an empty rehearsal database and used pg_restore --no-owner --no-privileges --exit-on-error --single-transaction.
- Restore deployment d70bfaeb-d626-472c-b8db-1fa809b90ced reported RESTORE_COMMITTED and REHEARSAL_BACKUP_RESTORE_COMPLETE.
- Restored schema inventory: 179 tables, including 166 public and 9 crm_recovery tables. public.bills is absent. delivery_challans.created_by_user_id is absent.
- The temporary transfer receiver and its public domain were deleted after the restore.
- Fresh staging application/API credentials have been configured. WhatsApp conversations and AI replies, learning, marketplace and direct unified messaging are disabled. No production integration credentials were copied to the test application.
- Staging invoice floor: 100000, explicitly chosen for this rehearsal after the owner delegated the choice. It is not the historical maximum and has not been applied to live numbering.

## Not yet verified

The original backup has no row-count manifest. The archive transfer checksum and successful restore do not prove equality with a point-in-time source row manifest.
The post-restore baseline job has not reported a completed fingerprint capture. Do not claim it passed.
No repair or tenant migration has been reported as executed by this rehearsal.
No production-sized migration, barrier, real-storage quota, cross-company or browser acceptance result is claimed.
The staging application is not a customer-ready demo. Its first repair-build startup failed because it required a WhatsApp encryption key even with conversations disabled. A fresh staging-only key was supplied; startup must be checked again.
PostgREST has fresh configuration prepared but no successful deployment is recorded here.
The real restore does not resolve the historical synthetic restore-deficit incident.

## Current deployment approval

Railway cancelled accept-deploy for rehearsal-audit-once with: "Cancelled — the user did not approve this action. No changes were made."

The pending patch is d6e5a074-bd20-4052-ad0f-3f9d18937772 in the rehearsal environment. It creates only rehearsal-audit-once and its six variables. It is not a production CRM release.
The helper validates the rehearsal project and database host, captures existing table counts/digests into a private rehearsal_audit schema, and prepares the fresh authenticator/service roles for the isolated API. Its source is reviewable in Railway's staged changes. No production database credentials are present.
Do not submit the same deployment through an alternate route while approval is pending.

## Resume sequence

1. Review and approve only the staged rehearsal-audit-once patch; check for unrelated changes first.
2. Confirm its completion, save counts/digests without customer details, and investigate any earlier baseline-job state before proceeding.
3. Start PostgREST at the pinned reference in POSTGREST_PIN.md and confirm the fresh authenticator works.
4. Finish repair-release startup and smoke checks; apply r1-r4 individually using the versioned runner.
5. Follow STAGING_REHEARSAL_RUNBOOK.md for preflight, tenant migrations, barrier verification, quota/storage checks, failure drills and recovery. Preserve the founding and recovery rows; any unplanned change stops the run.
6. Build a separate synthetic-only demo before sharing access outside the owner/team. Do not share an administrator login to the restored customer-data environment.
7. Keep PR #111/#113 and the production release separate from this staging approval.

## Minimum sellable pilot

Audience: 2-3 solar installation companies with a real need to track quotations, follow-up and customer balances.
Positioning: "From enquiry to quotation, invoice and payment record in one company workspace."

Include:
- Operator-led company setup, company branding, staff roles and company-owned manual prices/terms.
- Leads and customers; manual quotations and PDFs; invoices, partial/final payments and customer documents.
- Customer portal, manual subscription records and defined storage limits.
- A documented backup/recovery process and support contact.

Defer:
- AI-generated customer replies and automated quote sending.
- AutoSizer/shared equipment catalogue, design tools, marketplace and learning modules.
- Delivery, warranty and handover workflows until the schema and complete journeys are proven.
- Per-company Android builds and broad self-service signup.

Do not advertise autonomous AI, complete accounting/tax compliance, unlimited storage, guaranteed uptime or a finished Android commercial release.

## Demo and onboarding

A ten-minute demo should show one synthetic enquiry becoming a customer, a branded quotation, an invoice, a partial payment, the remaining balance and a customer document download.
Then demonstrate two companies viewing their own records.

Onboarding collects the company's name/logo, contacts, staff list and roles, prices, payment terms, bank details and agreed numbering policy. Start with a small clean sample. Review imported balances with the company before using them.

Commercial pilot terms are still a proposal, not published prices:
- One setup fee and a monthly subscription quoted after the workflow demo.
- Explicit staff/storage limits, supported modules, support hours and data-export arrangements.
- Written acceptance of pilot limitations; no automatic annual commitment.
- A named person at each pilot company responsible for weekly use and feedback.

## Commercial validation

Before paid ads, invite a small set of solar-company owners to individual demos. No outreach has been sent.
Track demos booked, companies completing onboarding, weekly quotations/invoices/payments, support time and renewal decisions.
The decisive proof is sustained use and paid renewal. CI passing alone is not commercial validation.

## Release conditions

All staging gates must pass, credential/signing-key exposure must be handled, customer terms and data responsibilities must be settled, and the remaining offboarding limitation must have an agreed solution before paid onboarding.
Production deployment remains a distinct release decision based on the recorded evidence.
