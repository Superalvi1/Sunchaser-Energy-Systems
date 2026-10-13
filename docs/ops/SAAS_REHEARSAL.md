# SaaS tenant-migration rehearsal on a restored production copy

Separate from the release rehearsal (`MAC_RESTORE_REHEARSAL.md`). **Nothing here touches production.** It runs on the scratch server only and refuses a remote host or a database whose name looks like production. Status: the script is proven on a synthetic copy (`docs/saas/evidence/saas-rehearsal-synthetic.txt`, 0 failures); it has **not** been run on a real production backup (the owner has not returned the Mac rehearsal result, and no production access was used).

## When
After the release rehearsal has restored the backup into the scratch server (database `restore_rehearsal`) and the release migrations r1-r4 are applied there. Keep the release rehearsal's pinned commit rule: check out the same pinned commit, then the SaaS branch commit under test.

## Owner decision needed first
`FOUNDING_INVOICE_FLOOR`: the last invoice number ever issued this year (the reported cleared invoices were INV-2026-0007 and 0008; the true number is the owner's to confirm). The tenant migrations refuse to run for the founding company without it so Sunchaser never restarts at 0001.

## Run
```bash
RESTORE_PGHOST=<scratch socket dir or 127.0.0.1> RESTORE_PGPORT=<port> RESTORE_PGUSER=<superuser of the SCRATCH server> [RESTORE_PGPASSWORD=...] \
RESTORE_DB=restore_rehearsal REHEARSAL_DIR=$HOME/sunchaser-rehearsal-saas \
FOUNDING_INVOICE_FLOOR=<number> bash scripts/rehearsal/run-saas-rehearsal.sh
```
Exit status = number of FAIL lines. Return `$REHEARSAL_DIR/saas/` (preflight.txt, bills-report.txt, runner_*.txt, fp_diff.txt) with the console output.

## What it checks
Preflight without BLOCKER; the production-only table `bills` described (columns, keys, triggers, rows); a fingerprint (row count and content hash) of every public table before; migrations t1-t7 through the runner and `verify`; afterwards the same fingerprints on the original columns (nothing rewritten), every company-owned row belongs to `sunchaser`, the invoice counter is at or above the highest number in use, the tenant role sees the founding company's data only with its header; rollback to t1 returns every fingerprint and the schema snapshot to the before state; re-apply.

## What it cannot show
The application journeys (flag on and off) against the restored copy: run `scripts/rehearsal/run-journeys.sh` afterwards with the tenant key minted for the scratch server. Production data volume timing (lock times) is only as representative as the restored copy.

## `bills` and `invoices.created_by_user_id` (production-only objects)
`bills` is used by `verify-supabase.ts` but defined in no tracked SQL. Provisional class: `tenant`. On a synthetic `bills` the foundation migration adds `company_id`, the policy and the reference trigger, and the rehearsal confirms it; **its unique `bill_number` stays global** (two companies could collide), so before any second company uses bills the owner must show the real definition and a per-company unique key is added. `invoices.created_by_user_id` exists in production only; it is carried along unchanged (the fingerprints cover it) and is not a tenancy key.
