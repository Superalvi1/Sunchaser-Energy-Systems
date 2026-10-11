# Restore rehearsal of the latest production backup, on your Mac

Takes about 10-15 minutes. **Do not paste any credential into chat or into this document.** None is ever typed: you sign in to Railway in your browser, and the Railway CLI hands the
bucket credentials to one download process, which neither prints nor stores them.

## What this does and does not do

| It does | It never does |
|---|---|
| Downloads the **newest** `database-backups/<stamp>/sunchaser-postgres.tar.gz` made by the existing daily job (one read-only LIST and one GET with your own Railway login) | Write to Railway, the production database, the production bucket or any production service |
| Starts a **throw-away PostgreSQL 17** on a private unix socket in a temporary folder (no network port) and restores the backup into it | Connect to the production database |
| Checks that the restore is complete, that **schema `crm_recovery` is present and its tables keep the same rows after every migration step**, and that the accounting tables are still empty (so nothing from `crm_recovery` has come back into `public`) | Copy, read back or restore any `crm_recovery` record anywhere except into the throw-away copy it is checked in |
| Applies the four release migrations to the copy, verifies, rolls back in reverse order, re-applies, and compares every table before and after | Apply anything to production |
| Writes a short RETURN file (PASS/FAIL lines and counts, no customer values), then deletes the downloaded backup, the restored copy and the logs | Print a credential or put one in a file |

## 1. One-time setup (Terminal)

```bash
xcode-select --install 2>/dev/null; brew install postgresql@17 railway
railway login
```
`railway login` opens your browser; sign in there. (`xcode-select` may say it is already installed; that is fine.)

## 2. The one command

```bash
cd ~ && rm -rf sunchaser-rehearsal-src && git clone --quiet --branch claude/fervent-goodall-jz9g7m --single-branch https://github.com/Superalvi1/Sunchaser-Energy-Systems.git sunchaser-rehearsal-src && cd sunchaser-rehearsal-src && git log -1 --format='commit %H' && bash scripts/rehearsal/mac-run.sh
```

Compare the printed `commit` with the commit I give you in the chat message that sent you here; if it differs, stop and tell me.

If you have no Railway CLI or the download step fails, use the fallback (section 6) instead of the last command.

## 3. What you should see

```
== 0. prerequisites          tools: psql (PostgreSQL) 17.x | pg_restore (PostgreSQL) 17.x | curl ...
== 1. get the newest production backup (read-only)
newest backup: database-backups/<stamp>/sunchaser-postgres.tar.gz (<bytes> bytes ...)   <- the stamp should be from the last day or so
== 2. throw-away PostgreSQL 17 server ...
== 3. restore rehearsal      ... many PASS lines ...   == summary: 0 FAIL
== 4. RETURN file            written: ~/sunchaser-rehearsal-RETURN-<time>.txt   (34 PASS, 0 FAIL)
== cleanup                  deleted /private/tmp/sunchaser-rehearsal.XXXXXX
```
About 34 PASS lines are expected (the number can differ slightly). The checks that matter most:

| Line (starts with PASS or FAIL) | Means |
|---|---|
| `pg_restore into the scratch PostgreSQL 17 finished` | the production backup can be restored |
| `schema crm_recovery is present in the backup and was restored` | the recovery copies are in the backup |
| `accounting tables in the backup are empty, as after the 9 Oct reset` | the backup is post-reset and nothing came back into `public` |
| `none of the migration or rollback scripts mentions crm_recovery` | the release cannot touch those records |
| `preflight ... on the restored copy` (three lines) | no blocker for M1-M3 on your real data |
| `apply ...`, `verify ...`, `rollback ...`, `re-apply ...` | the four migrations work on your real data and can be undone |
| `rows and row hashes of all pre-existing tables unchanged` | the migrations change no existing data |
| `crm_recovery tables (rows and hashes) are identical after all migrations, rollbacks and re-applies` | the recovery copies stay untouched |

## 4. What to send back

Run `pbcopy < ~/sunchaser-rehearsal-RETURN-*.txt` and paste the clipboard into the chat. Exactly this block, nothing else:

* the header (date, repository commit, tool and server versions, backup key/size/**SHA-256 of the archive**),
* **every `PASS` / `FAIL` / `NOTE` line verbatim** (they contain only counts, timings and object names),
* the invoice-payments **preflight verdict table** (counts only),
* the `crm_recovery` table names with row counts,
* the line `N PASS, M FAIL`.

If there is any `FAIL`, send the block anyway and do not re-run in a loop. The block contains no customer names, phone numbers, amounts or credentials; read it once before you paste it.

## 5. Cleanup

The script deletes its temporary folder (downloaded backup, restored database, logs) and stops its PostgreSQL by itself, even on error. Then, by hand:

```bash
rm -rf ~/sunchaser-rehearsal-src
ls /private/tmp | grep sunchaser-rehearsal || echo "no leftover folder"
pgrep -fl "postgres.*sunchaser-rehearsal" || echo "no scratch server running"
# after you have sent the block:
rm -f ~/sunchaser-rehearsal-RETURN-*.txt
# optional, if you do not use the Railway CLI otherwise:
railway logout
```
If you ever ran with `KEEP_WORK=1`, the folder named in the output holds customer data: delete it with the `rm -rf` line it prints. `/private/tmp` is not included in Time Machine backups by default. No secret was typed, so
nothing sensitive is in your shell history.

## 6. Fallback: download in the dashboard

Railway dashboard -> project "Sunchaser Railway Staging" -> the storage bucket -> `database-backups/` -> the newest folder -> `sunchaser-postgres.tar.gz` -> Download. Then:

```bash
cd ~/sunchaser-rehearsal-src && bash scripts/rehearsal/mac-run.sh --tarball ~/Downloads/sunchaser-postgres.tar.gz
rm -f ~/Downloads/sunchaser-postgres.tar.gz
```
(If the dashboard does not list the bucket's files, use the CLI path above.)

## 7. If it stops

| Message | Cause / next step |
|---|---|
| `PostgreSQL 17 tools not found` | `brew install postgresql@17` (the tools live in a keg-only folder; the script finds them) |
| `Not logged in to Railway` | `railway login` |
| `could not list the bucket` | the Railway account lacks access to that service, or the service name changed; use the fallback |
| `no database-backups/...` | the daily job has not produced a file; send me the message |
| `pg_restore failed` | send the block; this is exactly what the rehearsal is for |
| `refusing: the scratch server must be a local unix socket...` | a safety stop; do not override it |

## 8. How well this procedure itself is tested

* EXECUTED on Linux against a stub of the Railway CLI and a signature-verifying S3 stand-in, with a backup archive in the production job's exact format: picks the newest object, falls back from virtual-hosted to path addressing, downloads, restores, runs all checks, produces the RETURN file, leaves no credential in any output, and deletes its folder. A deliberately wrong archive (accounting rows present) produced the expected FAIL.
* **NOT tested:** macOS itself (the scripts avoid GNU-only options and use `perl`, `curl` >= 7.75, `tar`, `psql`, but bash 3.2 and BSD tools were not exercised), the real Railway CLI, the real bucket's addressing style, and the real backup file.
  If a step fails for a Mac-specific reason, the message above it will say which; send it to me and I will correct the script.
