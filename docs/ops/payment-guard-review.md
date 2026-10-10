# Invoice payment guard: independent review (revision 2)

Scope: `scripts/invoice-payments-integrity.sql`, its rollback, the read-only preflight and the application code that cooperates with it
(`invoiceDb.ts`, `server/finance/*`, the invoice routes in `server.ts`). Reviewed against a disposable PostgreSQL 16.15 + PostgREST 12.2.3 stack
with synthetic data only. **Production was not touched and its schema was not available**; everything below is reasoned from the tracked SQL
(`invoice-module-schema.sql`, `invoice-status-schema.sql`, `invoice-archive-schema.sql`, `invoice-vyapar-schema.sql`, `party-ledger-*.sql`) and
from how the code reads and writes. The assumptions the owner must confirm are in section 7.

Nothing in this change has been applied to production. The migration stays a proposal until section 6 is satisfied.

## 1. Verdict

* **Revision 1 (the file at d6a4261) must not be applied.** It had eight defects, two of which lose or rewrite money data (section 3, F2, F3).
* **Revision 2 (this branch) can be applied, subject to the go / no-go conditions in section 6.** On the disposable stack it applied in 43 ms on
  100,000 invoices / 150,000 payments, changed no row, left every legacy invoice usable, and survived 2,430 mixed-operation rounds across 2 and 3 app
  instances plus direct SQL sessions with 0 deadlocks, 0 HTTP 5xx and 0 ledger / header violations.
* One finding is **not** fixed and is not caused by the guard: two staff editing the same invoice's lines at the same moment through different app
  instances can leave the lines and the total disagreeing (F10). A second unrelated finding: the invoice list endpoint returns 500 once there are
  roughly 3,000+ invoices (F13).

## 2. What changed

| Commit | Content |
| --- | --- |
| payment guard revision 2 | `invoice-payments-integrity.sql`, `-rollback.sql`, `-preflight.sql` rewritten, new `invoice-payments-verify.sql` |
| invoice routes and ledger | `invoiceDb.ts`, `server.ts`, `server/finance/paymentLedger.ts` (+ test): legacy opening-balance fix, retries, coded errors |
| review scripts | `scripts/e2e-crm-repair/j11-*` (reproducible evidence, section 8) |
| this document | `docs/ops/payment-guard-review.md` |

Revision 2 in one paragraph: the same five-trigger design, but (a) the header (`paid_amount`, `balance_due`, `payment_status`) is recomputed from the
ledger only when a write changes a money column or the ledger itself, never for archive / rename / PDF / customer-unlink; (b) the row lock is
`FOR NO KEY UPDATE` with a 10 s `lock_timeout` and a stable `invoice_busy` tag; (c) opening-balance rows (`pay-init-*`, `pay-backfill-*`) are accepted as the
first ledger row even for legacy overpaid invoices, and a first normal payment on a legacy invoice that has a paid amount but no ledger rows is refused
instead of silently erasing that amount; (d) deleting or editing a payment row re-syncs the header; (e) the escape hatch is ignored for the API login
roles; (f) every function has `EXECUTE` revoked from `PUBLIC`, `anon`, `authenticated` and `service_role` and a pinned `search_path`; (g) the migration and the
rollback set `lock_timeout = 5s` so they abort cleanly instead of queueing behind a long transaction.

## 3. Findings

Severity: High = money lost, rewritten or users locked out; Medium = wrong behaviour or operational hazard; Low = hygiene.
"Evidence" names the script that reproduces it (all under `scripts/e2e-crm-repair/`, all executed on the disposable stack by the reviewer).

| # | Sev | Finding | Evidence | Fixed |
| --- | --- | --- | --- | --- |
| F1 | High | **Pre-existing app bug (independent of the guard).** Editing the lines of, or sending `paidAmount` for, an invoice that has a paid amount but no ledger rows (legacy opening balance, or any invoice edited with `paidAmount`) re-summed the empty ledger and wrote `paid_amount = 0`, while the opening row written right after carried the real amount: header 0 / Unpaid, ledger 50,000. | `j11-legacy-data.mjs`, control run, cases d05, d19, d20: `paid 50000 -> 0`, `150000 -> 0`, `0 -> 0 with ledger 1234`. | Yes, `invoiceDb.ts` (stale re-sum only when the ledger has rows). After the fix, control and guard runs agree on all 248 case/op pairs. |
| F2 | High | Rev 1 recomputed the header on **every** update of an invoice that has ledger rows, so archiving, editing a phone number, attaching a PDF or even deleting a linked customer (FK `ON DELETE SET NULL`) silently rewrote `paid_amount`: d02 80,000 -> 30,000, d03 0 -> 40,000, and a manually forced `Overdue` on a fully paid invoice flipped to `Paid`. | `j11-rev1-regressions.mjs` probes c and j; `j11-legacy-data.mjs` (rev 1 differed from the control on 7 of 229 pairs for this reason). | Yes: recompute only on money-column writes; probes show header unchanged. |
| F3 | High | Rev 1 refused the opening-balance row of a legacy invoice whose header already exceeds the total (`pay-backfill-*`; `scripts/backfill-invoice-payments.sql` would fail as a whole), and its payment sync dropped the opening amount when a payment was inserted directly on a ledger-less legacy invoice (probe b: header 50,000 -> 10,000). | `j11-rev1-regressions.mjs` probes a, b. | Yes: opening rows accepted as first row only; a normal first payment on such an invoice is refused with `invoice_opening_balance_missing`. `backfill-invoice-payments.sql` verified inside a rolled-back transaction. |
| F4 | Medium | Rev 1 trusted a GUC for the escape hatch, so `ALTER ROLE authenticator SET app.skip_payment_guard = 'on'` (or any role-level setting) silently switched the guard off for every API request. | probe e: overpayment accepted in rev 1, `PT422` in rev 2. | Yes: honoured only when `session_user` is not `authenticator`, `anon`, `authenticated`, `service_role`. Preflight blocks on a role / database level setting. |
| F5 | Medium | Rev 1 used `FOR UPDATE`, which blocks adding invoice lines (FK `KEY SHARE`) while a payment transaction is open, and had no `lock_timeout`, so a stuck session made payments hang indefinitely. | probes f, g (`55P03` blocked; 12.5 s wait). | Yes: `FOR NO KEY UPDATE`, 10 s function-level `lock_timeout`, `invoice_busy`, app maps to `503 INVOICE_BUSY` after 3 attempts. |
| F6 | Medium | Deleting the only payment row left the header at the old paid amount with no ledger rows. | probe d. | Yes: sync on payment insert / update / delete. |
| F7 | Medium | `invoice_ledger_status` was callable by `anon` over `/rpc` (Supabase default privileges grant EXECUTE on new public functions). | probe h: 200 in rev 1, 401 in rev 2; `j11-security.mjs`. | Yes: `EXECUTE` revoked; `SECURITY DEFINER` with `search_path = pg_catalog, public, pg_temp`. |
| F8 | Low | Rev 1 compared the new total with the **unrounded** ledger: a 0.004 sub-paisa surplus refused an edit the app accepts. | `j11-legacy-data.mjs`, d18. | Yes (rounded comparison). |
| F9 | Low | Payment rows could be raised above the balance or moved to another invoice by a direct `UPDATE` (no guard on `invoice_payments` UPDATE). | `j11-db-level.sql`. | Yes: section D trigger. |
| F10 | Medium | **Not fixed, not caused by the guard.** Two full edits of the same invoice from different app instances interleave `invoice_items` replacement (several PostgREST calls) and the header update, leaving lines 90,000 vs total 70,000. The ledger is unaffected. Seen once in 450 three-instance rounds; not seen with two instances in 1,980 rounds. | `j11-guard-stress.mjs` (3 instances). | No. Needs one transactional RPC for "replace lines + update header" or an optimistic version check; see residual risks. |
| F11 | Low | Error mapping: PATCH / archive / delete answered without machine-readable codes, and several 500 paths returned raw PostgREST text (`err.message`, item-write errors, bulk delete, header refresh). | `j11-security.mjs`: forced `permission denied` returns a generic body with `code`. | Yes: codes `PAYMENT_INVALID`, `INVOICE_NOT_FOUND`, `INVOICE_HAS_PAYMENTS`, `TOTAL_BELOW_PAYMENTS`, `PAID_EXCEEDS_TOTAL`, `INVOICE_BUSY`, `OPENING_BALANCE_MISSING`, `INVOICE_WRITE_FAILED`, `INVOICE_ITEMS_WRITE_FAILED`, `BALANCE_REFRESH_FAILED`; no database text in any body. |
| F12 | Info | `confirmDuplicate` has **no UI caller**. The Party Ledger modal, `InvoiceStaff` and the Vyapar importer all send a `clientRequestId`, so the 2-minute duplicate guard never applies to them; it only protects older API clients. | `j11-duplicates.mjs`; `grep` of `src/`. | n/a (documented). |
| F13 | Medium | **Unrelated to the guard.** `GET /api/admin/invoices` returns 500 `Bad Request` once the list is large: `hydrateInvoiceRows` puts every invoice id in one `.in()` query string. 350 invoices fine, 3,292 fail (identical with the guard removed). | `j11-run-all.sh` step 2 (`list` row, HTTP 500). | No; needs paging or a join (separate task). |

Not findings (checked and fine): no deadlock under any pairing of payment / edit / delete / archive / void / items replacement; PostgREST runs the guard and the
header sync in the insert's own transaction (same `xmin`); retries of a stored payment id reach the primary key; identical-value payments are never merged
or rejected; legacy overpaid invoices can still be viewed, printed, archived, edited and fixed by raising the total.

## 4. Evidence by checklist item

### 4.1 Concurrency
* Design: one row lock per invoice (`SELECT ... FOR NO KEY UPDATE` inside the BEFORE INSERT trigger; the UPDATE/DELETE executor already holds the row lock before
  the BEFORE ROW triggers run). No other lock is taken after it, so there is no lock-order cycle between payment insert, invoice update, delete, archive and
  `invoice_items` replacement. A cycle needs one transaction holding two invoices; the only way is a hand-written multi-statement operator transaction, which
  reproduces `40P01` (exactly one victim, `j11-txn.mjs`) and which the app never does.
* Stress (`j11-guard-stress.mjs`): scenarios pay/pay (6 parallel across instances), 8 retries of one request id, pay vs lowering edit, pay vs delete, pay vs
  archive, pay vs void set by SQL, edit/edit/pay, an operator SQL session holding the row, direct SQL payment vs app payments. Lock monitor samples
  `pg_stat_activity` every 40 ms and `pg_stat_database.deadlocks`.

| Run | Rounds | Instances | Deadlocks | HTTP 5xx | Invariant violations | Peak waiters / longest wait |
| --- | --- | --- | --- | --- | --- | --- |
| rev 2, first | 240 | 2 | 0 | 0 | 0 | 2 / 0.37 s |
| rev 2, long | 1,500 | 2 | 0 | 0 | 0 | 2 / 0.28 s |
| rev 2, three instances | 450 | 3 | 0 | 0 | 1 (F10, lines vs total, ledger fine) | 2 / 0.28 s |
| rev 2, final all-in-one | 240 | 2 | 0 | 0 | 0 | 2 / 0.28 s |
| **no guard**, same load | 240 | 2 | 0 | 0 | **46** (ledger > total in 11 rounds, header != ledger in 26, 9 rounds accepted more than 3 of 6 payments) | 2 / 0.28 s |

  Invariants checked after every round: ledger = `paid_amount`, `balance_due` = max(0, total - paid), never negative, never above the total, status consistent, lines =
  total, accepted payments = stored rows, no acknowledged payment lost with a deleted invoice. Baseline (no guard) with the old two-instance script: 4 of 15 rounds overpaid.
* Transactions (`j11-txn.mjs`): a PostgREST payment insert and the header update carry the same `xmin`; a refused insert changes nothing; a bulk insert is judged as a whole;
  a held row makes a waiting payment give up at 10.0 s with `invoice_busy` (HTTP 409 from PostgREST), the app turns a persistent hold into `503 INVOICE_BUSY` after 3 attempts
  (31 s, nothing stored). PostgREST callers run READ COMMITTED, so serialization failures cannot occur for them; an operator `REPEATABLE READ` session gets `40001`, and the app
  retries `40001` / `40P01` / `55P03` / `invoice_busy` because payment ids are deterministic (a retry of a committed insert ends in the duplicate-id replay).

### 4.2 Legitimate duplicate-value payments (`j11-duplicates.mjs`, 18 checks pass)
* Two and then three more payments with identical amount / date / method / reference / notes and different request ids, sequential and in parallel from two instances: all recorded.
* The 2-minute guard applies **only** to clients that send no request id (409 `DUPLICATE_PAYMENT_SUSPECTED`); `confirmDuplicate:true` records the second payment through the HTTP route.
  A client that sends a request id is never stopped, with or without `confirmDuplicate`. The Party Ledger modal flow (new id per amount change, same id on retry: 200 replay,
  409 `PAYMENT_REQUEST_CONFLICT` if details changed) and the Vyapar importer flow (fresh id per receipt; the importer's own `findMissingPayments` multiset; two identical receipts both imported, a
  re-import adds nothing) were driven through the real route with the real helper.
* The trigger itself never compares payments: two rows with identical values and different ids are accepted at SQL level.
* Boundaries: exact remaining balance accepted (Paid, balance 0), +0.01 refused; raising the total makes the remainder payable; lowering below the ledger is `422 TOTAL_BELOW_PAYMENTS`;
  zero / negative / 0.004 / text / exponent / hex / thousands separators / booleans refused with a 4xx; paisa rounding (0.10 + 0.20 + 100.01 + 1.01 + 0.01 = 101.33); a PKR 9 trillion invoice is exact to the paisa;
  1e15, 1e21, 1e300, `Number.MAX_VALUE` are `422`, never stored, never a 5xx.

### 4.3 Existing data (`j11-dirty-dataset.sql`, `j11-legacy-data.mjs`)
Dataset (all synthetic, 19 invoices + an orphan payment): legacy overpaid (d01), header > ledger (d02), header < ledger (d03), opening balance without ledger (d05), void / duplicate / archived / test
invoices with payments (d06-d09), refund row (d10), duplicate rows (d11), zero row (d12), total 0 with a payment (d13), overdue (d14), forced Overdue while paid (d15), lines != total (d16),
clean controls (d17, d18, d20), header-only overpayment (d19), orphan payment. Run through the real HTTP routes: view, PDF, edit phone, edit lines (same total / raise / lower to ledger / lower below ledger / fix overpaid),
stale `paidAmount`, archive, pay remaining, pay one rupee, delete, each on a throw-away clone, header compared before / after.
* Apply: 43 ms; fingerprints (md5 of every row of `invoices`, `invoice_items`, `invoice_payments` that existed before) identical before and after (`j11-rollback.sh`).
* First write per kind with rev 2 and the fixed app: **0 differing outcomes** against the same operations with no guard (248 case/op pairs, no 5xx on any write). Legacy overpaid invoices: view / PDF / archive / rename / items edit
  work, new payments are refused with `PAYMENT_EXCEEDS_BALANCE`, raising the total to what was received (`edit_fix_overpaid`) works for every kind including void / duplicate / test / archived. Drifted invoices (d02, d03) keep
  their header on archive / rename and are re-based on the ledger only when a payment or total is written (this is also what the app already did on a total edit). Opening-balance invoices get one `pay-init-<id>` row on the next
  edit or payment and keep their paid amount. Void / duplicate / test invoices stay readable; payments are refused (409), as the app already did.

### 4.4 Rollback (`j11-rollback.sh`, 16 checks pass)
Apply (47 ms) then apply again; schema diff versus pre-guard is exactly the 8 functions, 5 triggers and the REVOKEs; app workload passes (7 checks); rollback (32 ms) twice; **`pg_dump -s` after rollback is byte-identical
to the pre-guard dump**; every invoice / line / payment row that existed before is byte-identical; rows the app wrote while the guard was on remain; `j8-payment-concurrency.mjs` passes with no guard; re-apply gives a
schema byte-identical to the first apply and the workload passes again. The rollback also removes revision 1 objects.

### 4.5 Error mapping
`j11-security.mjs`: overpayment 422 `PAYMENT_EXCEEDS_BALANCE`, invalid amount 400 `PAYMENT_INVALID`, unknown invoice 404 `INVOICE_NOT_FOUND`, void invoice 409 `INVOICE_NOT_COLLECTIBLE`, delete with payments 409 `INVOICE_HAS_PAYMENTS`,
lowering below payments 422 `TOTAL_BELOW_PAYMENTS`, lock 503 `INVOICE_BUSY`; an induced database failure (`INSERT` revoked from `service_role`) answers `500 INVOICE_WRITE_FAILED` with a generic message. The raw PostgREST body for a guard
rejection contains only the tag, the amounts of that same invoice and `PT4xx`; the app never forwards it.

### 4.6 Escape hatch
`set local app.skip_payment_guard = 'on'` cannot be reached from PostgREST: eight attempts (custom header, `x-` header, `Prefer`, query string, two JWT claim shapes, profile headers) all returned `422`; `/rpc/set_config` is 404.
A session logged in as `authenticator` (even `SET ROLE service_role`) with the GUC set is still refused; the same GUC in an operator session (`postgres`) works (`j11-security.mjs`, `j11-db-level.sql`).

### 4.7 Security
Trigger functions: `SECURITY DEFINER`, `search_path = pg_catalog, public, pg_temp` (helpers: `pg_catalog, pg_temp`), ACL owner-only; not exposed by PostgREST (404 / 401). Shadowing `round()`, `invoices` and `invoice_payments` in `pg_temp` and
`public` does not change the outcome. With RLS enabled and `service_role`-only policies, and with `FORCE ROW LEVEL SECURITY`, the app and the guard still work (the definer is the table owner); an over-granted `authenticated` role is stopped by RLS (403).
`SECURITY DEFINER` is required: with `SECURITY INVOKER` and RLS a non-bypass caller would see no rows, so the lock and the balance check would silently pass.

### 4.8 Operations (`j11-scale.mjs`, 100,000 invoices / 150,000 payments, 25 MB + 23 MB)

| Measure | Result |
| --- | --- |
| Apply / second apply / rollback / re-apply | 43 / 57 / 48 / 53 ms |
| Concurrent writer (1 small update every ~4 ms) during apply | max 3.7 ms (quiet p99 4.1 ms, max 9.9 ms): no visible stall |
| Per-write cost, guard off -> on | payment insert 0.58 -> 1.06 ms; non-money invoice update 0.40 -> 0.51 ms; money update 0.42 -> 0.64 ms |
| Apply while another session holds a write lock on `invoices` for 9 s | gives up after 5.04 s (`lock_timeout`), 0 triggers installed, retry later succeeds |

`CREATE TRIGGER` needs a `SHARE ROW EXCLUSIVE` lock; while it waits for a long transaction it also queues later writers, hence the 5 s cap and the preflight check for idle-in-transaction sessions.
No table is scanned or rewritten. Expected downtime: none. Recommended window: any quiet moment, 10 minutes, with someone watching `pg_stat_activity`.

## 5. Preflight thresholds (`scripts/invoice-payments-preflight.sql`, read-only)

| Row | Level | Output that blocks |
| --- | --- | --- |
| prerequisite tables / columns | BLOCK | count > 0 |
| no foreign key `invoice_payments.invoice_id -> invoices` | BLOCK | 1 (a payment racing a delete could orphan) |
| triggers already on the two tables | BLOCK | count > 0 (read section 6 of the output first) |
| `app.skip_payment_guard` set at role / database level | BLOCK | count > 0 |
| sessions idle in transaction > 1 minute | BLOCK | count > 0 (the migration would abort after 5 s) |
| header != ledger / ledger > total / paid > total with no rows / orphan payments / ledger < 0 | REVIEW | any: the owner decides per row (lists in sections 2-3); none blocks the apply |
| opening balances, non-collectible with payments, zero / negative rows, > 2 decimals, identical groups, sizes | INFO | context only |

On the dirty synthetic data the verdict shows 1 REVIEW orphan, 44 header / ledger disagreements, 44 overpaid ledgers, 9 header-only overpayments, 18 opening balances and `0` blocks.

## 6. Go / no-go for production

GO only when all of these hold:
1. The application commit from this branch is deployed **first** (new app + old database is the tested "no guard" state; old app + rev 2 was not tested and would lack the F1 fix and the new error codes).
2. A restored copy of production has been through `invoice-payments-preflight.sql` (zero BLOCK rows), `invoice-payments-integrity.sql` twice, `invoice-payments-verify.sql` (every row `ok`, the self-test as described) and `scripts/e2e-crm-repair/j11-db-level.sql` (all PASS), and the rollback restored the identical schema.
3. The owner has read the REVIEW lists and accepted that "ledger wins" for each disagreeing invoice (or corrected them first); nothing needs to be corrected for the apply to succeed.
4. The assumptions in section 7 are confirmed with the read-only queries.
5. A backup / PITR point exists, the window is quiet, and the rollback file is open in a second terminal. After the apply run `invoice-payments-verify.sql`, then make one test payment and one over-payment attempt on a throw-away invoice (the verify script's rolled-back self-test does exactly this).

NO-GO if any BLOCK row is non-zero, if a trigger already exists on either table, if the PostgREST login role is not one of `authenticator`, `anon`, `authenticated`, `service_role` **and** other tools can set GUCs for it,
or if another system writes `invoice_payments` / `invoices.paid_amount` directly and has not been told that payments above the balance and deletes of paid invoices are now refused (use the escape hatch deliberately, in an operator session, for repairs).

## 7. Assumptions the owner must confirm (all answerable with the preflight)

1. `invoice_payments.invoice_id` references `invoices(id)` (cascade); `invoices` has `invoice_status`, `balance_due`, `due_date`, `archived_at` (tracked scripts say yes; preflight BLOCK rows 1 and 3).
2. No other triggers on the two tables (preflight section 6).
3. The migration runs as the owner of `invoices` / `invoice_payments` (a superuser or `postgres`): the definer functions then bypass RLS. Preflight section 7 shows owner, RLS flags, size, approximate rows.
4. PostgREST connects with a login role that is in the exclusion list (`authenticator` on the test stack and on Supabase); preflight section 7 lists the sessions' roles. PostgREST >= 9 (custom `PTnnn` status codes; tested 12.2.3). Postgres >= 13 (tested 16).
5. The default isolation level is READ COMMITTED, and any pooler (PgBouncer) is in transaction mode or has no `SET` leakage: the guard uses only transaction-local settings.
6. `payment_method` allows `Unknown` (needed by `backfill-invoice-payments.sql`, which `party-ledger-phase2-schema.sql` enables).
7. `invoice_status` only holds the values in `invoice-archive-schema.sql` (`void`, `duplicate`, `test` refuse payments; anything else collects).
8. Overdue is evaluated at write time with the database clock (`current_date`, UTC on Supabase / Railway) while the app uses the server's local date; a status can differ by a day around midnight.
9. Nobody relies on a paid amount that disagrees with the ledger: for the listed invoices the first payment or total edit re-bases the header on the ledger. The application already did that on any total edit.

## 8. Reproduce

```bash
export E2E_STACK_DIR=/srv/e2e-guard E2E_PG_PORT=55803 E2E_PGRST_PORT=54803 E2E_S3_PORT=9803 E2E_APP_PORT=3803 TEST_PW='<synthetic>' POSTGREST_BIN=/path/to/postgrest
setsid timeout 400 bash scripts/e2e-crm-repair/isolated-stack.sh > stack.log 2>&1 < /dev/null
source $E2E_STACK_DIR/env.sh
npx esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs
node dist/server.cjs &                      # instance 1 (port 3803)
PORT=3804 node dist/server.cjs &            # instance 2
E2E_BASE_URL_2=http://127.0.0.1:3804 bash scripts/e2e-crm-repair/j11-run-all.sh
```

Individual scripts (all disposable-stack only): `j11-dirty-dataset.sql`, `j11-legacy-data.mjs` (`--compare a.json b.json`), `j11-db-level.sql`, `j11-duplicates.mjs` (needs `node --import tsx`), `j11-txn.mjs` (`SLOW=1` adds the 31 s app-level busy test),
`j11-security.mjs`, `j11-guard-stress.mjs` (`ROUNDS=`, optional `E2E_BASE_URL_3`), `j11-rev1-regressions.mjs` (frozen rev 1 in `j11-rev1-*.sql`), `j11-rollback.sh`, `j11-scale.mjs` (builds its own `scale_guard` database from the tracked schema scripts).

## 9. Residual risks

* F10: concurrent full edits of one invoice from different instances can leave lines != total. Rare (needs two staff editing the same invoice in the same few milliseconds). Fix belongs in a single transactional RPC or an `updated_at` check; not in this migration.
* F13: the invoice list endpoint breaks at several thousand invoices (request line carries every id). Independent of the guard, but the guard's test data exposed it; check the production invoice count.
* Rev 2 was never run against the real production schema; the assumptions in section 7 stand in for that.
* The guard is per invoice. It does not stop someone raising an invoice total to cover an overpayment (that is a legitimate fix) and it does not cover `TRUNCATE` or sessions that switch triggers off (`session_replication_role`, superuser only).
* A drifted legacy invoice keeps a header that disagrees with its ledger until money is written; reports that read `paid_amount` directly still show the old number for it (the preflight lists them).
* `confirmDuplicate` is dead code for the shipped UI. If a future client omits `clientRequestId`, two genuine identical payments within 2 minutes need the confirmation round trip.
* The in-process `withInvoiceLock` still fails open after 45 s; the database lock (10 s) is now the authority across instances.
* Tested on PostgreSQL 16.15 / PostgREST 12.2.3 only.
