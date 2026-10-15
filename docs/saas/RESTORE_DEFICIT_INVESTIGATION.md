# The unexplained one-row deficit of restore-journey run 8: investigation and release implication

**Verdict: UNRESOLVED (narrowed, not proven).** The cause of that run's single missing row cannot be established from the evidence that exists, and it cannot be reproduced on demand because the code that produced it has been changed. This document says what the preserved evidence does and does not show, what it excludes, and what follows for the release.

Evidence used (all preserved unchanged): `docs/saas/evidence/round4/restore-repeat/` (the 15 original runs, the application log lines, the pre-fix reproduction) and `docs/saas/evidence/round5/row-loss/` (the pre-fix and post-fix measurements).

## What happened
Round 4 ran the restore journey 15 times on one scratch stack. Runs 7 and 9 failed; run 8 passed all 45 checks, yet its second company ("beta") held **25 rows where the identically filled first company ("alpha") held 26**, with the same 16 stored objects each. The application log of that stack held two server errors (the duplicate invoice and line-item ids that explain runs 7 and 9) and **nothing for run 8**.

## What the preserved evidence establishes
| Question | Answer | Evidence |
|---|---|---|
| Was the row lost by the **restore**? | **No.** The totals (alpha 26, beta 25) are the fingerprints taken *before* the journey damaged or restored anything; beta was byte-identical before and after its own non-restore. The deficit existed before the restore ran | `company-restore.8.log`, line 3 ("fingerprints taken (alpha 26 rows / 16 objects, beta 25 / 16 ...)") |
| Was it a lost **object**? | No: both companies held 16 objects | same |
| Which tables can lose exactly **one** row silently? | `activity_logs` (id `log-<ms>`) and `customer_documents` (vault id `doc-<ms>`). The third silent class, `projects` (`project-<ms>`), loses **two** rows, because the payment that references the project is lost with it. Run 8's deficit is one | `row-loss/README.md`, `BEFORE-fix.*` |
| So, narrowed to | **one missing activity-log row or one missing document row** | by elimination above |
| Is the mechanism real? | Yes, reproduced: two requests building the same clock-only id in the same millisecond; the second insert is refused by the database and the client **returns** the refusal instead of throwing, so the request answers 200 and nothing is logged. 30 rounds of two simultaneous identical fills on the pre-fix build: 10 mismatches (activity logs 2, documents 2, payments 3 + projects 3) | `BEFORE-fix.fill-parity-30-rounds.log` |
| Does it match the frequency? | Of 10 mismatching pre-fix rounds, 4 were a single-row loss in `activity_logs` or `customer_documents`; run 8 is one such event among 15 runs (3 deficits, 2 of them explained by logged errors). Consistent, not diagnostic | same |
| Is it still happening on the pilot code? | No, in the paths exercised: 40 rounds of fill parity, 0 mismatches over 706 rows per company; 5 x 72 simultaneous contracts, nothing lost, 0 duplicate lines in the log | `AFTER-fix.*` |

## What cannot be established, and why
* **Which table** lacked the row in run 8: the journey recorded only totals for beta, and the stack is gone. A per-table, per-key snapshot (`companyRowSnapshot`) was added afterwards precisely so that the next occurrence names the table and the row.
* **Whether run 8 was this mechanism at all.** It is the only mechanism found that fits (one row, no log line, same objects), but no run was ever caught in the act. "Fits and is reproducible" is not "was".
* The earlier round's single "document upload did not return an id" failure is still not shown to be related.

## A related finding made while checking (not a proof of anything about run 8)
A static scan (a heuristic, not a proof) of the data modules found about **60 `insert` / `upsert` call sites whose answer is not captured at the call** (`dbManager.ts` 45, `server.ts` 9, `projectDeliveryDb.ts` 5, `warrantyProvisionDb.ts` 2, `roleManagementDb.ts` 1). Many are batch syncs that may check later; none was individually reviewed. Together with the clock-only ids still listed in checklist CG15, this means **the class "silent loss on an id collision" is not closed everywhere in the code**. It is closed for the three proven tables (`activity_logs`, `projects`, vault documents), for invoices, their lines and customers, and for customer codes. Payment ids (`pay-<ms>`) and the others in CG15 are still clock-based and were not exercised by the pilot flows.

## Release implication
1. **The pilot code is not exposed to the proven mechanism** on the paths the pilot uses (measured above). The pilot is therefore **not blocked by run 8**.
2. **The production code of the founding company still is**, at a low rate, until the same fixes reach production: the backport PRs prepared so far (#114 invoice ids, #115 customer code) do **not** include the activity-log, project and vault-document ids. Whether to backport those three is an owner decision (O8); the cost of not doing it is a silent, unlogged loss of an activity-log or document row when two writes land in the same millisecond. This is a production-code risk that exists today and is independent of the SaaS release.
3. **Restore is not certified by this investigation.** Row-level verification now fails on any missing, changed or extra row, and was exercised with negative controls; but the restore of a *real* backup is untested until the staging rehearsal (`docs/ops/STAGING_REHEARSAL_RUNBOOK.md`, steps R6 and R7). **Gate:** the pilot must not start until that rehearsal's restore verification and fill-parity runs are clean on the restored backup.
4. **Wording rule for every report:** "run 8: unresolved; narrowed to one activity-log or document row lost to a clock-id collision; mechanism reproduced and fixed on the pilot paths; not proven for that run". Never "fixed" or "explained" without that qualification.
5. **Monitoring:** the fixed code logs every refused insert (`[... not saved]` lines). During the rehearsal and the pilot, any such line, and any fill-parity or restore-verification mismatch, is a stop condition (runbook section 9).
