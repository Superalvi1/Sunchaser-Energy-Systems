# Restore rehearsal of the latest production backup, on your Mac

Takes about 10-15 minutes. **Do not paste any credential into chat or into this document.** None is ever typed: you sign in to Railway in your browser, and the Railway CLI hands the
bucket credentials to one download process, which neither prints nor stores them.

## What this does and does not do

| It does | It never does |
|---|---|
| Downloads the **newest** `database-backups/<stamp>/sunchaser-postgres.tar.gz` made by the existing daily job (one read-only LIST and one GET with your own Railway login) | Write to Railway, the production database, the production bucket or any production service |
| Starts a **throw-away PostgreSQL 17** on a private unix socket in a temporary folder (no network port) and restores the backup into it | Connect to the production database |
| Checks the **six cleared accounting tables** (invoices, invoice_items, invoice_payments, payments, quotations, party_ledger_archives) against their recovery copies in `crm_recovery`: no recovered record is back in `public`; **records created legitimately since the reset are kept and must stay byte-for-byte unchanged** through every migration step | Copy, read back or restore any `crm_recovery` record anywhere except into the throw-away copy it is checked in |
| Checks that schema `crm_recovery` is present and that its tables keep identical rows and hashes after every migration, rollback and re-apply | Delete anything automatically |
| Applies the four release migrations to the copy, verifies, rolls back in reverse order, re-applies, and compares every table before and after | Apply anything to production |
| Writes a short RETURN file with a **fixed name** (PASS/FAIL lines and counts, no customer values) | Print a credential or put one in a file |
| **Keeps** the downloaded backup and the restored copy in a temporary folder until you have reviewed the result and run the cleanup command (section 5) | |

## 1. One-time setup (Terminal)

```bash
xcode-select --install 2>/dev/null; brew install postgresql@17 railway
railway login
```
`railway login` opens your browser; sign in there. (`xcode-select` may say it is already installed; that is fine.)

## 2. The commands

The tested commit is given in the chat message that sent you here. It is a full 40-character commit id; put it in the first line. Every run uses a **new** temporary checkout
(nothing is deleted or reused) and the script refuses to start if the checkout is not exactly that commit.

```bash
SHA=PASTE_THE_40_CHARACTER_COMMIT_FROM_THE_CHAT_MESSAGE
SRC="$(mktemp -d /private/tmp/sunchaser-src.XXXXXX)" && git clone --quiet --no-checkout https://github.com/Superalvi1/Sunchaser-Energy-Systems.git "$SRC" \
  && cd "$SRC" && git checkout --quiet --detach "$SHA" && [ "$(git rev-parse HEAD)" = "$SHA" ] && echo "checkout is exactly $SHA" \
  && EXPECTED_COMMIT="$SHA" bash scripts/rehearsal/mac-run.sh
```

If `git checkout` says the commit does not exist, stop and tell me; do not substitute a branch name.
If you have no Railway CLI or the download step fails, use the fallback (section 7) instead of the last line.

## 3. What you should see

```
== 0. prerequisites          tools: psql (PostgreSQL) 17.x | pg_restore (PostgreSQL) 17.x | curl ...      repository commit: <the SHA above>
== 1. get the newest production backup (read-only)
newest backup: database-backups/<stamp>/sunchaser-postgres.tar.gz (<bytes> bytes ...)   <- the stamp should be from the last day or so
== 2. throw-away PostgreSQL 17 server ...
== 3. restore rehearsal      ... PASS lines ...   == summary: 0 FAIL
== 4. RETURN file            written: /Users/<you>/sunchaser-rehearsal-RETURN.txt   (about 40 PASS, 0 FAIL)
== stop (nothing is deleted automatically)     <- prints the work folder, the RETURN file and the cleanup command
```
About 40 PASS lines are expected (the number can differ slightly). The checks that matter most:

| Line (starts with PASS or FAIL) | Means |
|---|---|
| `pg_restore into the scratch PostgreSQL 17 finished` | the production backup can be restored |
| `schema crm_recovery is present in the backup and was restored` | the recovery copies are in the backup |
| `crm_recovery holds six non-empty accounts_reset_20261009_* tables with the row counts you reported (...)` | the six recovery tables exist with the counts you reported (1, 2, 2, 3, 13, 27); if the numbers differ the run says FAIL - tell me, it is not by itself proof of data loss |
| `public.<table>: no recovered record is back (...)` (six lines) | nothing from `crm_recovery` has returned into the live tables |
| `NOTE ... records created since the reset` | **expected if you have created invoices/payments/quotations since 9 Oct**: they are counted and preserved, not a problem |
| `the cleared accounting tables, including any records created since the reset, are identical (rows and hashes) after all migrations, rollbacks and re-applies - 6 table(s) compared` | the release does not touch your newer records |
| `crm_recovery tables (rows and hashes) are identical after all migrations, rollbacks and re-applies - 6 table(s) compared` | the recovery copies stay untouched |
| `none of the migration or rollback scripts mentions crm_recovery` | the release cannot touch those records |
| `preflight ...` (three lines) | no blocker for M1-M3 on your real data |
| `apply ...`, `verify ...`, `rollback ...`, `re-apply ...` | the four migrations work on your real data and can be undone |
| `rows and row hashes of all pre-existing tables unchanged` | the migrations change no existing data |

## 4. What to send back

The RETURN file always has the same name: **`~/sunchaser-rehearsal-RETURN.txt`** (an older one is first moved to `~/sunchaser-rehearsal-RETURN.previous.txt`).

```bash
pbcopy < ~/sunchaser-rehearsal-RETURN.txt
```
Paste the clipboard into the chat. It contains exactly:

* the header (date, repository commit, tool and server versions, backup key/size/**SHA-256 of the archive**),
* **every `PASS` / `FAIL` / `NOTE` line verbatim** (they contain only counts, timings and object names),
* the invoice-payments **preflight verdict table** (counts only),
* the `crm_recovery` table names with row counts,
* the six cleared tables: name, rows recovered, rows in `public` now, recovered rows back in `public` (must be 0),
* the line `N PASS, M FAIL`.

If there is any `FAIL`, send the block anyway and do not re-run in a loop. The block contains no customer names, phone numbers, amounts or credentials; read it once before you paste it.

## 5. Keep the backup until the result is reviewed, then clean up

Nothing is deleted automatically. The work folder (printed at the end of the run, `/private/tmp/sunchaser-rehearsal.XXXXXX`) holds the **downloaded backup and the restored copy = customer data**;
keep it until I have reviewed your RETURN block and said the result is accepted (so a question about the result can be answered from the same copy).
To look at the restored copy in the meantime, the run prints a `pg_ctl ... start && psql ...` command; stop it again with `pg_ctl -D <work folder>/pgdata -m fast stop`.

**After I have confirmed the result**, remove everything with the command the run printed, which has this form (it refuses any path that is not a `sunchaser-rehearsal.*` / `sunchaser-src.*` folder directly under the temporary directory,
refuses while the scratch server is still running, lists what it will delete, and asks you to type `yes`):

```bash
bash "$SRC/scripts/rehearsal/cleanup-rehearsal.sh" /private/tmp/sunchaser-rehearsal.XXXXXX "$SRC"
```
(`$SRC` is the checkout folder from section 2; if you opened a new Terminal window use the full path `/private/tmp/sunchaser-src.XXXXXX` that `ls -d /private/tmp/sunchaser-*` shows.)

Then, by hand:
```bash
ls -d /private/tmp/sunchaser-* 2>/dev/null || echo "no leftover folder"     # a failed start can leave an empty rehearsal folder: remove it with the same cleanup command
pgrep -fl "postgres.*sunchaser-rehearsal" || echo "no scratch server running"
rm -f ~/sunchaser-rehearsal-RETURN.txt ~/sunchaser-rehearsal-RETURN.previous.txt   # after you have sent it (counts only, but no reason to keep it)
railway logout                                                                      # optional, if you do not use the Railway CLI otherwise
```
`/private/tmp` is not included in Time Machine backups by default. No secret was typed, so nothing sensitive is in your shell history.
If you downloaded the backup by hand (section 7), delete that file too: `rm -f ~/Downloads/sunchaser-postgres.tar.gz` - only after the result has been accepted.

## 6. If it stops

| Message | Cause / next step |
|---|---|
| `PostgreSQL 17 tools not found` | `brew install postgresql@17` (the tools live in a keg-only folder; the script finds them) |
| `STOP: this checkout is ... but the tested commit is ...` | the checkout is not the tested commit; nothing was downloaded; tell me |
| `Not logged in to Railway` | `railway login` |
| `could not list the bucket` | the Railway account lacks access to that service, or the service name changed; use the fallback |
| `no database-backups/...` | the daily job has not produced a file; send me the message |
| `pg_restore failed` | send the block; this is exactly what the rehearsal is for |
| `refusing: the scratch server must be a local unix socket...` | a safety stop; do not override it |

## 7. Fallback: download in the dashboard

Railway dashboard -> project "Sunchaser Railway Staging" -> the storage bucket -> `database-backups/` -> the newest folder -> `sunchaser-postgres.tar.gz` -> Download. Then, from the checkout of section 2:

```bash
cd "$SRC" && EXPECTED_COMMIT="$SHA" bash scripts/rehearsal/mac-run.sh --tarball ~/Downloads/sunchaser-postgres.tar.gz
```
(If the dashboard does not list the bucket's files, use the CLI path above.)

## 8. How well this procedure itself is tested

* EXECUTED on Linux (12 Oct 2026) against a stub of the Railway CLI and a signature-verifying S3 stand-in, with a synthetic backup archive in the production job's exact format (`database.dump` + `globals.sql`) shaped like your description of the post-reset state (six empty accounting tables, six recovery tables with 2/13/2/3/27/1 rows):
  picks the newest object, falls back from virtual-hosted to path addressing, downloads, restores, runs all checks (41 PASS, 0 FAIL), writes `sunchaser-rehearsal-RETURN.txt`, leaves no credential in any output, **keeps** the work folder and the downloaded backup, and the cleanup command then refuses `/`, the temporary directory itself, the checkout, a sub-folder and a running scratch server, cancels on anything but `yes`, and deletes exactly the two folders on `yes`.
* EXECUTED separately on PostgreSQL 17.11 with three source variants: post-reset state (preserved + unchanged), post-reset state **with legitimate new records** (a new invoice and item are counted, preserved and verified unchanged through apply/rollback/re-apply), and a deliberately wrong archive (a recovered record put back into `public`, which produces the expected FAIL).
* **NOT tested:** macOS itself (the scripts avoid GNU-only options and use `perl`, `curl` >= 7.75, `tar`, `psql`, but bash 3.2 and BSD tools were not exercised), the real Railway CLI, the real bucket's addressing style, and the real backup file.
  If a step fails for a Mac-specific reason, the message above it will say which; send it to me and I will correct the script.
