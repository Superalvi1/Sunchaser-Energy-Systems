# The restore journey's unexplained one-row deficit (round 4, run 8) - investigation

The original evidence is kept unchanged in `docs/saas/evidence/round4/restore-repeat/` (15 runs; runs 7 and 9 failed; run 8 passed all 45 checks but beta ended with 25 rows instead of 26, and the application log held no matching error).

## What was wrong with the verification
The restore journey compared per-table digests of a company before and after the restore. Those comparisons were sound (run 8's beta was identical before and after). What nothing checked was the **fill** - that the two companies, filled with identical data, ended up with the same rows. A row lost during the fill produced no failed check. The new verification (`companyRowSnapshot` / `diffRowSnapshots`) records every table's primary keys and a hash of every row's full content, plus every object, and:
* asserts the two identically-filled companies hold the same number of rows in every table (a difference names the table and the rows),
* asserts the fill's content (invoice lines, totals, payment, lead, quotation, documents, contract log row, project row),
* compares before the damage / after the damage / after the restore, row by row, and fails on any missing, added or changed row (alpha, beta, founding), with negative controls proving a changed, a deleted and an added row are each found by name.

## Cause found and reproduced (class of cause; run 8 itself is not proven)
Three inserts that run as a side effect of normal actions built their primary key from the clock alone (`log-<ms>`, `project-<ms>`, `doc-<ms>`) and **ignored the database's answer** (the client returns the refusal instead of throwing). When two requests built the same id in the same millisecond the second row was dropped with HTTP 200 and no log line. A lost project row also loses the `payments` row that references it.

* `BEFORE-fix.concurrent-contracts.{1,2,3}.log`: 72 simultaneous contracts, 3 runs: 5, 4+4 and 1+6 of 72 activity-log / project rows silently lost; `BEFORE-fix.app-log-vault-duplicates.txt`: 14 lost invoice-vault document rows (logged only as a warning).
* `BEFORE-fix.fill-parity-30-rounds.log`: 30 rounds of two simultaneous identical fills on the previous build: **10 mismatches** - payments 3, projects 3 (always together), activity_logs 2, customer_documents 2 (each company lost exactly one such row at random).
* After the fix (unique ids, the answer checked and logged): `AFTER-fix.concurrent-contracts.{1..5}.log` 5 runs x 72 contracts, nothing lost, 0 duplicate/not-saved lines in the application log; `AFTER-fix.fill-parity-40-rounds.log`: 40 rounds, **0 mismatches** (706 / 706 rows).

## What this does and does not establish
* Established: a mechanism that loses exactly one row (activity log or vault document) or two (project + payments) under the fill's concurrency, with no error line, at a rate that matches the observed 1-in-15 frequency of run 8's kind.
* **Not established: that run 8's single missing row was one of these.** Its per-table counts were not recorded, so which table lacked the row cannot be known. Stated as: explained by a reproduced mechanism, not proven for that run.
* The previous round's single "document upload did not return an id" failure is still not shown to be any of these.
* Other ids built from the clock alone remain (listed in the checklist, CG15). They are in modules outside the pilot's enabled flow or are staff-run one at a time; they were not changed.
