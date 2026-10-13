#!/usr/bin/env bash
# Offline self-test of the backup tooling's guard rails (no database needed except where noted). Prints PASS/FAIL, exits non-zero on any FAIL.
#   bash scripts/backup/selftest.sh            # pure-function checks
#   PGHOST=... PGPORT=... PGUSER=... PGDATABASE=... bash scripts/backup/selftest.sh --with-db   # also exercises pg-backup.sh refusals against a (scratch) server
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"
FAILS=0
ok() { echo "PASS: $1"; }
bad() { echo "FAIL: $1"; FAILS=$((FAILS + 1)); }
expect_eq() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (got '$2', want '$3')"; fi; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# --- version parsing and the client >= server guard ---
expect_eq "num_major 170002" "$(num_major 170002)" 17
expect_eq "num_major 160015" "$(num_major 160015)" 16
mkdir -p "$TMP/bin"; printf '#!/bin/sh\necho "pg_dump (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)"\n' > "$TMP/bin/pg_dump16"; chmod +x "$TMP/bin/pg_dump16"
expect_eq "tool_major parses a PostgreSQL 16 client" "$(tool_major "$TMP/bin/pg_dump16")" 16
printf '#!/bin/sh\necho "pg_dump (PostgreSQL) 17.2 (Debian 17.2-1.pgdg120+1)"\n' > "$TMP/bin/pg_dump17"; chmod +x "$TMP/bin/pg_dump17"
expect_eq "tool_major parses a PostgreSQL 17 client" "$(tool_major "$TMP/bin/pg_dump17")" 17
if (assert_client_at_least_server "$TMP/bin/pg_dump16" 17) >/dev/null 2>&1; then bad "PG16 client must be refused for a PG17 server"; else ok "PG16 client is refused for a PG17 server (simulated versions; exit 5)"; fi
if (assert_client_at_least_server "$TMP/bin/pg_dump17" 17) >/dev/null 2>&1; then ok "PG17 client accepted for a PG17 server"; else bad "PG17 client wrongly refused"; fi
if (assert_client_at_least_server "$TMP/bin/pg_dump17" 16) >/dev/null 2>&1; then ok "newer client accepted for an older server"; else bad "newer client wrongly refused"; fi

# --- URL parsing: credentials end up in PG* variables, not on any command line ---
(
  export SELFTEST_URL='postgresql://app_user:p%40ss%2Fw0rd@db.internal:5433/crm?sslmode=require'
  load_url_into_pgenv SELFTEST_URL
  [ "$PGUSER|$PGHOST|$PGPORT|$PGDATABASE|$PGSSLMODE" = "app_user|db.internal|5433|crm|require" ] && [ "$PGPASSWORD" = 'p@ss/w0rd' ]
) && ok "URL parsing (percent-decoded password, port, sslmode)" || bad "URL parsing"
( export SELFTEST_URL='mysql://x'; load_url_into_pgenv SELFTEST_URL ) >/dev/null 2>&1 && bad "non-postgres URL must be rejected" || ok "non-postgres URL rejected without echoing it"

# --- public-key-only guard ---
printf 'AGE-SECRET-%s\n' 'KEY-1NOT-A-REAL-KEY-TEST-STRING' > "$TMP/priv.txt"
if (BACKUP_AGE_RECIPIENTS_FILE="$TMP/priv.txt" make_recipients_file "$TMP/r.txt") >/dev/null 2>&1; then bad "a private key must not be accepted as a recipient"; else ok "a private age key is refused as a recipient"; fi
(BACKUP_AGE_RECIPIENTS="age1abc,age1def" make_recipients_file "$TMP/r.txt") && [ "$(wc -l < "$TMP/r.txt")" = 2 ] && ok "recipients list split on commas" || bad "recipients split"

# --- retention (GFS) ---
mkdir -p "$TMP/ret"
for d in $(seq 0 44); do day="$(date -u -d "2026-10-09 -$d day" +%Y%m%d)"; mkdir "$TMP/ret/${day}T030000Z"; done
for ym in 2025-11 2025-12 2026-01 2026-02 2026-03 2026-04 2026-05 2026-06 2026-07 2026-08; do mkdir -p "$TMP/ret/${ym//-/}15T030000Z"; done
VICT="$(retention_victims "$TMP/ret" 7 4 3)"
KEPT="$(for n in $(ls "$TMP/ret"); do grep -qx "$n" <<<"$VICT" || echo "$n"; done | sort -r)"
NEWEST="$(ls "$TMP/ret" | sort -r | head -1)"
grep -qx "$NEWEST" <<<"$KEPT" && ok "retention never removes the newest backup" || bad "retention removed the newest backup"
expect_eq "retention keeps the newest 7 days" "$(for i in $(seq 0 6); do d="$(date -u -d "2026-10-09 -$i day" +%Y%m%d)T030000Z"; grep -qx "$d" <<<"$KEPT" && echo y; done | wc -l)" 7
[ "$(grep -c . <<<"$VICT")" -gt 0 ] && ok "retention selects old backups for removal ($(grep -c . <<<"$VICT") of $(ls "$TMP/ret" | wc -l))" || bad "retention removed nothing"
mkdir -p "$TMP/ret2/20261009T030000Z"; expect_eq "a single backup is never pruned" "$(retention_victims "$TMP/ret2" 1 1 1)" ""

# --- manifest comparison ---
printf 'info\tserver_version\t16.1\ntable\tpublic.a\t3\tabc\nseq\tpublic.a_seq\t5\ttrue\ndefs\tpolicies\t2\tfff\n' > "$TMP/s.tsv"
printf 'info\tserver_version\t17.0\ntable\tpublic.a\t3\tabc\nseq\tpublic.a_seq\t7\ttrue\ndefs\tpolicies\t2\tfff\n' > "$TMP/d_ok.tsv"
manifest_compare "$TMP/s.tsv" "$TMP/d_ok.tsv" >/dev/null 2>&1 && ok "identical manifests (info ignored, sequence ahead allowed)" || bad "identical manifests rejected"
printf 'table\tpublic.a\t2\tabc\nseq\tpublic.a_seq\t5\ttrue\ndefs\tpolicies\t2\tfff\n' > "$TMP/d_rows.tsv"
manifest_compare "$TMP/s.tsv" "$TMP/d_rows.tsv" >/dev/null 2>&1 && bad "missing row not detected" || ok "a missing row is detected"
printf 'table\tpublic.a\t3\tabd\nseq\tpublic.a_seq\t5\ttrue\ndefs\tpolicies\t2\tfff\n' > "$TMP/d_hash.tsv"
manifest_compare "$TMP/s.tsv" "$TMP/d_hash.tsv" >/dev/null 2>&1 && bad "changed value not detected" || ok "a changed value (same count) is detected"
printf 'table\tpublic.a\t3\tabc\nseq\tpublic.a_seq\t4\ttrue\ndefs\tpolicies\t2\tfff\n' > "$TMP/d_seq.tsv"
manifest_compare "$TMP/s.tsv" "$TMP/d_seq.tsv" >/dev/null 2>&1 && bad "sequence regression not detected" || ok "a sequence that went backwards is detected"
printf 'table\tpublic.a\t3\tabc\ndefs\tpolicies\t2\tfff\n' > "$TMP/d_noseq.tsv"
manifest_compare "$TMP/s.tsv" "$TMP/d_noseq.tsv" >/dev/null 2>&1 && bad "missing sequence not detected" || ok "a missing sequence is detected"
printf 'table\tpublic.a\t3\tabc\nseq\tpublic.a_seq\t5\ttrue\ndefs\tpolicies\t1\tfff\n' > "$TMP/d_pol.tsv"
manifest_compare "$TMP/s.tsv" "$TMP/d_pol.tsv" >/dev/null 2>&1 && bad "dropped policy not detected" || ok "a dropped policy is detected"

# --- guard rails of pg-backup.sh (need a reachable scratch server) ---
if [ "${1:-}" = "--with-db" ]; then
  out="$TMP/out"
  if (BACKUP_AGE_RECIPIENTS="" BACKUP_AGE_RECIPIENTS_FILE="" bash "$HERE/pg-backup.sh" --out-dir "$out" --no-upload) >"$TMP/o.txt" 2>&1; then bad "backup without recipients must fail"; else grep -q "Refusing to write an unencrypted dump" "$TMP/o.txt" && ok "backup without encryption recipients is refused" || bad "wrong refusal message: $(tail -1 "$TMP/o.txt")"; fi
  if (BACKUP_ALLOW_UNENCRYPTED=1 bash "$HERE/pg-backup.sh" --out-dir "$HERE/../../backups-out" --no-upload) >"$TMP/o.txt" 2>&1; then bad "output inside the repository must be refused"; else grep -q "inside the git checkout" "$TMP/o.txt" && ok "output directory inside the repository is refused" || bad "wrong refusal: $(tail -1 "$TMP/o.txt")"; fi
  rmdir "$HERE/../../backups-out" 2>/dev/null || true
  # a client older than the server (simulated with a shim that reports PostgreSQL 15) must stop the run before any dump
  mkdir -p "$TMP/shim"; printf '#!/bin/sh\necho "pg_dump (PostgreSQL) 15.4"\n' > "$TMP/shim/pg_dump"; chmod +x "$TMP/shim/pg_dump"
  if (PATH="$TMP/shim:$PATH" BACKUP_ALLOW_UNENCRYPTED=1 bash "$HERE/pg-backup.sh" --out-dir "$out" --no-upload) >"$TMP/o.txt" 2>&1; then bad "older pg_dump must be refused"; else grep -q "cannot produce a restorable dump" "$TMP/o.txt" && ok "pg_dump older than the server is refused before any dump is attempted" || bad "wrong refusal: $(tail -1 "$TMP/o.txt")"; fi
  [ ! -d "$out" ] || [ -z "$(ls -A "$out" 2>/dev/null | grep -v '^\.' )" ] && ok "no backup files left behind by refused runs" || bad "files left behind in $out"
fi
echo "---"; [ "$FAILS" = 0 ] && { echo "ALL PASSED"; exit 0; } || { echo "$FAILS FAILED"; exit 1; }
