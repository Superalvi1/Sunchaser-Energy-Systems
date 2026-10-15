#!/usr/bin/env node
// Versioned migration runner: ordered migrations from scripts/migrations/manifest.json, a SHA-256 checksum for every file, an
// insert-only execution ledger (ops.migration_ledger, hash-chained) and one runner at a time (advisory lock).
//
//   PGHOST=/srv/x PGPORT=5432 PGUSER=postgres PGDATABASE=db node scripts/migrations/run.mjs <command> [options]
//
//   status                 what is applied, what is pending, checksum drift, ledger integrity            (read-only)
//   plan [--to ID]         what `apply` would run, in order, with dependencies and gates                   (read-only)
//   apply [--to ID] --yes  run pending migrations in order, one at a time, each recorded in the ledger
//   rollback --to ID --yes undo applied migrations in reverse order down to and including ID
//   baseline --through ID --yes
//                          record migrations that were applied by hand BEFORE this runner existed, after checking each one's probe
//   verify                 checksums of applied files vs files on disk, probes, ledger chain                (read-only; exit 1 on a problem)
//   checksums              print the SHA-256 of every file in the manifest                                   (no database)
//
// Safety: refuses any server that is not a local socket / 127.0.0.1 / localhost unless --allow-remote AND MIGRATE_CONFIRM_HOST equals
// the host; `apply`, `rollback` and `baseline` do nothing without --yes; a checksum that changed after it was applied stops everything
// (add a new migration instead of editing an applied one); two runners cannot run at once; a failed migration is recorded as failed and
// never as applied. The ledger cannot be updated or deleted by SQL (trigger) and each row carries a hash of the previous one.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RUNNER_VERSION = "1.0.0";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const VALUE_OPTS = new Set(["--root", "--manifest", "--to", "--through"]);
const cmd = (() => { for (let i = 0; i < argv.length; i++) { if (VALUE_OPTS.has(argv[i])) { i++; continue; } if (!argv[i].startsWith("--")) return argv[i]; } return undefined; })();
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const ROOT = path.resolve(opt("root") || path.join(HERE, "..", ".."));
const MANIFEST = path.join(ROOT, opt("manifest") || "scripts/migrations/manifest.json");
const ID_RX = /^[a-z0-9][a-z0-9-]{1,60}$/;

function loadManifest() {
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const seen = new Set();
  for (const x of m.migrations) {
    if (!ID_RX.test(x.id)) throw new Error(`bad migration id "${x.id}"`);
    if (seen.has(x.id)) throw new Error(`duplicate migration id ${x.id}`);
    for (const r of x.requires || []) if (!seen.has(r)) throw new Error(`${x.id} requires ${r}, which must be listed before it`);
    seen.add(x.id);
    x.abs = path.join(ROOT, x.file);
    x.rollbackAbs = path.join(ROOT, x.rollback);
    for (const f of [x.abs, x.rollbackAbs]) if (!fs.existsSync(f)) throw new Error(`${x.id}: missing file ${path.relative(ROOT, f)}`);
    x.checksum = sha256File(x.abs);
    x.rollbackChecksum = sha256File(x.rollbackAbs);
  }
  return m.migrations;
}
function sha256File(f) { return createHash("sha256").update(fs.readFileSync(f)).digest("hex"); }
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

if (cmd === "checksums") {
  for (const x of loadManifest()) console.log(`${x.checksum}  ${x.file}\n${x.rollbackChecksum}  ${x.rollback}`);
  process.exit(0);
}
if (!["status", "plan", "apply", "rollback", "baseline", "verify"].includes(cmd)) {
  console.error(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 18).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(2);
}

// ---------------------------------------------------------------- connection and guards
const host = process.env.PGHOST || "";
const local = host.startsWith("/") || host === "127.0.0.1" || host === "localhost" || host === "::1";
if (!local) {
  if (!flag("allow-remote") || process.env.MIGRATE_CONFIRM_HOST !== host || !host) {
    console.error(`Refusing: PGHOST="${host}" is not a local socket or localhost. To run against another server pass --allow-remote and set MIGRATE_CONFIRM_HOST to exactly that host. (Production needs the owner's approval first: docs/ops/DEPLOYMENT_PLAN.md.)`);
    process.exit(2);
  }
}
const mutating = ["apply", "rollback", "baseline"].includes(cmd);
if (mutating && !flag("yes")) console.log("Dry run: nothing will be changed. Add --yes to execute.\n");
const doIt = mutating && flag("yes");

const client = new pg.Client({ application_name: "sunchaser-migrate" });
await client.connect();
const q = (sql, p) => client.query(sql, p).then((r) => r.rows);

const LEDGER_DDL = `
create schema if not exists ops;
revoke all on schema ops from public;
create table if not exists ops.migration_ledger (
  seq bigserial primary key,
  migration_id text not null,
  action text not null check (action in ('apply','rollback','baseline')),
  status text not null check (status in ('ok','failed')),
  checksum text not null,
  rollback_checksum text,
  applied_by text not null,
  host text not null,
  runner_version text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  duration_ms integer not null,
  error text,
  prev_hash text not null,
  row_hash text not null);
create index if not exists migration_ledger_id_idx on ops.migration_ledger (migration_id, seq);
create or replace function ops.migration_ledger_immutable() returns trigger language plpgsql as $f$
begin raise exception 'ops.migration_ledger is insert-only'; end $f$;
drop trigger if exists migration_ledger_no_change on ops.migration_ledger;
create trigger migration_ledger_no_change before update or delete or truncate on ops.migration_ledger
  for each statement execute function ops.migration_ledger_immutable();
revoke all on ops.migration_ledger from public;`;

async function ensureLedger() {
  if (!doIt) {
    const exists = (await q("select to_regclass('ops.migration_ledger') is not null as e"))[0].e;
    return exists;
  }
  await client.query(LEDGER_DDL);
  return true;
}
function rowHash(prev, r) {
  return sha256([prev, r.migration_id, r.action, r.status, r.checksum, r.rollback_checksum || "", r.applied_by, r.host, r.runner_version, r.duration_ms, r.error || ""].join("\u0001"));
}
async function readLedger(has) {
  return has ? q("select * from ops.migration_ledger order by seq") : [];
}
function chainProblems(rows) {
  const problems = [];
  let prev = "genesis";
  for (const r of rows) {
    if (r.prev_hash !== prev) problems.push(`ledger row ${r.seq}: previous-hash does not match (a row was removed or inserted)`);
    if (r.row_hash !== rowHash(r.prev_hash, r)) problems.push(`ledger row ${r.seq}: contents do not match their hash (row was changed)`);
    prev = r.row_hash;
  }
  return problems;
}
// Current state: the latest OK row per migration decides (apply/baseline = applied, rollback = not applied). Failed rows never count.
function stateOf(rows) {
  const st = new Map();
  for (const r of rows) {
    if (r.status !== "ok") continue;
    if (r.action === "rollback") st.delete(r.migration_id);
    else st.set(r.migration_id, { checksum: r.checksum, at: r.finished_at, by: r.applied_by, action: r.action });
  }
  return st;
}
async function record(m, action, status, startedAt, error) {
  const last = (await q("select row_hash from ops.migration_ledger order by seq desc limit 1"))[0];
  const prev = last ? last.row_hash : "genesis";
  const r = {
    migration_id: m.id, action, status, checksum: m.checksum, rollback_checksum: m.rollbackChecksum,
    applied_by: `${os.userInfo().username}@${os.hostname()} as ${(await q("select current_user u"))[0].u}`,
    host: host || "(libpq default)", runner_version: RUNNER_VERSION, duration_ms: Date.now() - startedAt, error: error ? String(error).slice(0, 1500) : null,
  };
  await client.query(
    `insert into ops.migration_ledger (migration_id, action, status, checksum, rollback_checksum, applied_by, host, runner_version, started_at, duration_ms, error, prev_hash, row_hash)
     values ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9::double precision / 1000.0),$10,$11,$12,$13)`,
    [r.migration_id, r.action, r.status, r.checksum, r.rollback_checksum, r.applied_by, r.host, r.runner_version, startedAt, r.duration_ms, r.error, prev, rowHash(prev, r)]);
}
function runPsql(file) {
  return new Promise((resolve) => {
    execFile("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", file], { env: process.env, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || ""), err: String(stderr || "").trim() });
    });
  });
}
async function probe(m) { try { const r = await q(m.probe); return Object.values(r[0] || {})[0] === true; } catch { return false; } }

// ---------------------------------------------------------------- main
let exitCode = 0;
const lockKey = 7391002;
try {
  const migrations = loadManifest();
  const byId = new Map(migrations.map((m) => [m.id, m]));
  const wanted = (id, what) => { if (id && !byId.has(id)) { console.error(`Unknown migration ${id} (${what}).`); process.exit(2); } };
  wanted(opt("to"), "--to"); wanted(opt("through"), "--through");

  if (mutating && doIt) {
    const got = (await q("select pg_try_advisory_lock($1) as ok", [lockKey]))[0].ok;
    if (!got) { console.error("Another migration runner holds the lock on this database. Nothing was changed."); process.exit(3); }
  }
  const hasLedger = await ensureLedger();
  const rows = await readLedger(hasLedger);
  const state = stateOf(rows);
  const chain = chainProblems(rows);
  const drift = [...state].filter(([id, s]) => byId.has(id) && byId.get(id).checksum !== s.checksum).map(([id]) => id);
  const unknownApplied = [...state.keys()].filter((id) => !byId.has(id));
  const pending = migrations.filter((m) => !state.has(m.id));

  const print = () => {
    for (const m of migrations) {
      const s = state.get(m.id);
      const tag = s ? (drift.includes(m.id) ? "DRIFT  " : "applied") : "pending";
      console.log(`  ${tag}  ${m.id.padEnd(34)} ${m.gate.padEnd(6)} ${s ? `${s.action} ${new Date(s.at).toISOString()} by ${s.by}` : ""}`);
    }
  };
  const problems = [...chain, ...drift.map((id) => `${id}: the file changed after it was applied (checksum differs from the ledger)`),
                    ...unknownApplied.map((id) => `${id}: recorded in the ledger but not in the manifest`)];

  if (cmd === "status" || cmd === "plan") {
    console.log(hasLedger ? `Ledger: ${rows.length} row(s), ${state.size} applied.` : "Ledger: not created yet (nothing recorded; `apply --yes` or `baseline --yes` creates it).");
    print();
    if (problems.length) { console.log("\nProblems:"); problems.forEach((p) => console.log("  - " + p)); exitCode = 1; }
  }
  if (cmd === "plan") {
    const upto = opt("to");
    const list = [];
    for (const m of pending) { list.push(m); if (m.id === upto) break; }
    if (upto && state.has(upto)) list.length = 0;
    console.log(list.length ? "\nWould apply, in this order:" : "\nNothing to apply.");
    for (const m of list) {
      const missing = (m.requires || []).filter((r) => !state.has(r) && !list.some((x) => x.id === r));
      console.log(`  ${m.id}   ${m.file}   requires: ${(m.requires || []).join(", ") || "-"}${missing.length ? `   (NOT SATISFIED: ${missing.join(", ")})` : ""}\n      ${m.note}`);
    }
  }

  if (cmd === "verify") {
    console.log(hasLedger ? `Ledger: ${rows.length} row(s).` : "No ledger.");
    const bad = [...problems];
    for (const [id] of state) {
      const m = byId.get(id);
      if (m && !(await probe(m))) bad.push(`${id}: recorded as applied but its probe fails (the database does not look as if it was applied)`);
    }
    for (const m of pending) if (await probe(m)) bad.push(`${m.id}: not in the ledger but its probe says it is present (applied by hand? use baseline)`);
    if (bad.length) { console.log("PROBLEMS:"); bad.forEach((p) => console.log("  - " + p)); exitCode = 1; } else console.log("OK: checksums, ledger chain and probes agree.");
  }

  if (cmd === "apply") {
    if (problems.length) { console.error("Refusing to apply while the ledger has problems:\n  - " + problems.join("\n  - ")); process.exit(1); }
    const upto = opt("to");
    const list = [];
    for (const m of pending) { list.push(m); if (m.id === upto) break; }
    if (upto && state.has(upto)) list.length = 0;
    if (upto && !list.some((m) => m.id === upto) && !state.has(upto)) { console.error(`${upto} is not pending.`); process.exit(2); }
    if (!list.length) console.log("Nothing to apply.");
    for (const m of list) {
      const missing = (m.requires || []).filter((r) => !state.has(r));
      if (missing.length) { console.error(`${m.id} needs ${missing.join(", ")} first.`); exitCode = 1; break; }
      console.log(`${doIt ? "Applying" : "Would apply"} ${m.id}  (${m.file})  gate ${m.gate}`);
      if (!doIt) { state.set(m.id, { checksum: m.checksum, at: new Date(), by: "dry-run", action: "apply" }); continue; }
      const started = Date.now();
      const r = await runPsql(m.abs);
      if (!r.ok) {
        await record(m, "apply", "failed", started, r.err);
        console.error(`FAILED ${m.id}:\n${r.err.split("\n").slice(0, 8).join("\n")}\nRecorded as failed; it is not marked applied. Fix the cause and run apply again.`);
        exitCode = 1; break;
      }
      if (!(await probe(m))) {
        await record(m, "apply", "failed", started, "script ran without error but the probe says the migration is not present");
        console.error(`FAILED ${m.id}: the script ran but its probe fails.`); exitCode = 1; break;
      }
      await record(m, "apply", "ok", started, null);
      state.set(m.id, { checksum: m.checksum, at: new Date(), by: "me", action: "apply" });
      console.log(`  ok (${Date.now() - started} ms)`);
    }
  }

  if (cmd === "rollback") {
    const to = opt("to");
    if (!to) { console.error("rollback needs --to ID (the oldest migration to undo)."); process.exit(2); }
    if (problems.length) { console.error("Refusing to roll back while the ledger has problems:\n  - " + problems.join("\n  - ")); process.exit(1); }
    const order = [...migrations].reverse().filter((m) => state.has(m.id));
    const idx = order.findIndex((m) => m.id === to);
    if (idx < 0) { console.error(`${to} is not applied.`); process.exit(2); }
    for (const m of order.slice(0, idx + 1)) {
      const dependents = migrations.filter((x) => state.has(x.id) && (x.requires || []).includes(m.id) && !order.slice(0, idx + 1).some((y) => y.id === x.id));
      if (dependents.length) { console.error(`Cannot roll back ${m.id}: ${dependents.map((d) => d.id).join(", ")} depends on it.`); exitCode = 1; break; }
      console.log(`${doIt ? "Rolling back" : "Would roll back"} ${m.id}  (${m.rollback})`);
      if (!doIt) continue;
      const started = Date.now();
      const r = await runPsql(m.rollbackAbs);
      if (!r.ok) { await record(m, "rollback", "failed", started, r.err); console.error(`FAILED rollback of ${m.id}:\n${r.err.split("\n").slice(0, 8).join("\n")}`); exitCode = 1; break; }
      await record(m, "rollback", "ok", started, null);
      state.delete(m.id);
      console.log(`  ok (${Date.now() - started} ms)`);
    }
  }

  if (cmd === "baseline") {
    const through = opt("through");
    if (!through) { console.error("baseline needs --through ID."); process.exit(2); }
    if (problems.length) { console.error("Refusing while the ledger has problems:\n  - " + problems.join("\n  - ")); process.exit(1); }
    const list = [];
    for (const m of migrations) { list.push(m); if (m.id === through) break; }
    for (const m of list) {
      if (state.has(m.id)) continue;
      const present = await probe(m);
      console.log(`${m.id}: probe ${present ? "present" : "ABSENT"}`);
      if (!present) { console.error(`Cannot baseline ${m.id}: its effect is not in this database. Apply it instead.`); exitCode = 1; break; }
      if (doIt) { await record(m, "baseline", "ok", Date.now(), null); state.set(m.id, { checksum: m.checksum }); console.log("  recorded as baseline (the file was NOT executed)"); }
    }
  }
} catch (e) {
  console.error("Runner error:", e.message);
  exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
process.exit(exitCode);
