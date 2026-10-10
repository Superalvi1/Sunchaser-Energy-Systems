import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Tests for scripts/smart-quote-versions-{schema,rollback,restore}.sql.
 *
 * Part 1 reads the SQL text and always runs; it only guards the properties that were wrong in the first version (they are not proof
 * that the SQL works). Part 2 runs the scripts for real against a SCRATCH PostgreSQL server and is skipped unless
 * MIGRATION_TEST_PSQL is set - set REQUIRE_DB_TESTS=1 (as CI must) to make a missing database a failure instead of a skip.
 *
 *   MIGRATION_TEST_PSQL="-h /srv/e2e-x -p 55505 -U postgres" REQUIRE_DB_TESTS=1 node --import tsx server/publicLeads/smartQuoteVersionsMigration.test.ts
 *
 * The server must be a disposable one: the test creates and drops its own databases (named smq_mig_test_*), and creates the roles anon,
 * authenticated and service_role when they do not exist. It refuses anything but a local socket directory or 127.0.0.1/localhost.
 */
const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts");
const read = (name: string) => fs.readFileSync(path.join(scripts, name), "utf8");
const code = (sql: string) => sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

test("static: the migration cannot queue behind other writers or hide a table of the wrong shape", () => {
  const sql = code(read("smart-quote-versions-schema.sql"));
  assert.match(sql, /set local lock_timeout\s*=\s*'\d+s'/, "needs a lock_timeout so a waiting migration cannot freeze writers on leads/customers");
  assert.match(sql, /raise exception 'public\.smart_quote_versions already exists with a different shape/, "must fail when an older table of the same name exists");
  assert.ok(sql.indexOf("notify pgrst") > 0 && sql.indexOf("notify pgrst") < sql.lastIndexOf("commit;"), "NOTIFY belongs inside the transaction so it is only sent when the table is visible");
  assert.doesNotMatch(sql, /^\\/m, "no psql meta-commands: the file must also run from other SQL runners");
});

test("static: the rollback appends to its backup instead of skipping, locks the backup down, and verifies the copy", () => {
  const sql = code(read("smart-quote-versions-rollback.sql"));
  assert.doesNotMatch(sql, /create table if not exists[^;]*\bas\s+select/is, "CREATE TABLE IF NOT EXISTS ... AS SELECT silently skips the copy on a second rollback");
  assert.match(sql, /insert into public\.smart_quote_versions_rollback_backup/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on public\.smart_quote_versions_rollback_backup from public, anon, authenticated, service_role/i);
  assert.match(sql, /copied <> expected/);
  assert.match(sql, /set local lock_timeout/);
  assert.ok(sql.indexOf("insert into public.smart_quote_versions_rollback_backup") < sql.indexOf("drop table public.smart_quote_versions;"), "copy before drop");
});

test("static: a restore script exists so a re-applied (empty) table can get its history back", () => {
  const sql = code(read("smart-quote-versions-restore.sql"));
  assert.match(sql, /on conflict do nothing/i);
  assert.match(sql, /smart_quote_versions_rollback_backup/);
});

// ---------------------------------------------------------------------------------------------------------------------------------
const admin = (process.env.MIGRATION_TEST_PSQL || "").trim();
const required = process.env.REQUIRE_DB_TESTS === "1";
const dbTests = { skip: !admin && !required ? "set MIGRATION_TEST_PSQL (scratch PostgreSQL server) to run the live migration tests" : false };

function psql(args: string[], db: string, extra: string[] = []): string {
  return execFileSync("psql", [...admin.split(/\s+/).filter(Boolean), "-d", db, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...extra, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
const q = (db: string, sql: string) => psql(["-tA", "-c", sql], db).trim();
const file = (db: string, name: string) => psql(["-f", path.join(scripts, name)], db);
function expectFail(db: string, name: string, pattern: RegExp) {
  try { file(db, name); } catch (e: any) { assert.match(String(e.stderr), pattern); return; }
  assert.fail(`${name} should have failed`);
}
function makeDb(name: string) {
  psql(["-c", `drop database if exists ${name} with (force)`], "postgres");
  psql(["-c", `create database ${name}`], "postgres");
  psql([
    "-c", `do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
    end $$`,
    "-c", "create table public.customers (id text primary key, name text)",
    "-c", "create table public.leads (id text primary key, customer_id text references public.customers(id), name text, phone text, notes text, deleted_at timestamptz, created_at timestamptz default now())",
    "-c", "grant usage on schema public to service_role",
    "-c", "insert into public.customers values ('c1','One'),('c2','Two'); insert into public.leads (id, customer_id, name, phone) values ('l1','c1','One','923000000001'),('l2','c2','Two','923000000002')",
  ], name);
}
const insertVersion = (db: string, id: string, quote: string, lead: string, version: number) =>
  q(db, `insert into public.smart_quote_versions (id, quote_number, lead_id, version_number, client_name, client_phone, system_capacity_kw, panel, inverter, battery, structure, total_pkr, payload_sha256, generated_at)
         values ('${id}','${quote}','${lead}',${version},'S','923000000001',8,'p','i','b','s',1,'x',now())`);

test("live: the test server is a local scratch server", dbTests, () => {
  const host = /-h\s+(\S+)/.exec(admin)?.[1] ?? "";
  assert.ok(host.startsWith("/") || host === "127.0.0.1" || host === "localhost", `MIGRATION_TEST_PSQL must name a local socket directory or 127.0.0.1, got '${host}'`);
});

test("live: applying twice is idempotent and installs RLS, policy, trigger and grants", dbTests, () => {
  const db = "smq_mig_test_a"; makeDb(db);
  try {
    file(db, "smart-quote-versions-schema.sql"); file(db, "smart-quote-versions-schema.sql");
    assert.equal(q(db, "select (select count(*) from pg_policies where tablename='smart_quote_versions') || '/' || (select count(*) from pg_trigger where tgname='smart_quote_versions_immutable') || '/' || (select relrowsecurity::int from pg_class where relname='smart_quote_versions')"), "1/1/1");
    assert.equal(q(db, "select has_table_privilege('service_role','public.smart_quote_versions','INSERT') and not has_table_privilege('service_role','public.smart_quote_versions','DELETE') and not has_table_privilege('anon','public.smart_quote_versions','SELECT')"), "t");
    insertVersion(db, "v1", "SES-20261001-0001", "l1", 1);
    assert.throws(() => q(db, "update public.smart_quote_versions set total_pkr = 2"), /immutable/);
    assert.throws(() => insertVersion(db, "v2", "SES-20261001-0001", "l2", 1), /duplicate key/, "quote numbers are unique");
    assert.throws(() => q(db, "delete from public.leads where id = 'l1'"), /violates foreign key/, "a lead with versions cannot be hard-deleted");
  } finally { psql(["-c", `drop database if exists ${db} with (force)`], "postgres"); }
});

test("live: a pre-existing table of an older shape makes the migration fail instead of passing silently", dbTests, () => {
  const db = "smq_mig_test_b"; makeDb(db);
  try {
    q(db, `create table public.smart_quote_versions (id text primary key, quote_number text not null unique, lead_id text not null references public.leads(id) on delete restrict, customer_id text references public.customers(id) on delete set null,
           version_number integer not null, source text not null default 'Smart Quote', client_name text not null, client_phone text not null, client_city text, system_capacity_kw numeric not null, panel text not null, inverter text not null,
           battery text not null, structure text not null, lines jsonb, subtotal_pkr numeric, discount_pkr numeric, total_pkr numeric not null, payload_sha256 text not null, generated_at timestamptz not null,
           created_at timestamptz not null default now(), pdf_file_name text, pdf_file_url text, pdf_storage_path text, pdf_sha256 text, pdf_size_bytes integer, constraint smart_quote_versions_lead_version_key unique (lead_id, version_number))`);
    expectFail(db, "smart-quote-versions-schema.sql", /different shape.*pdf_saved_at/s);
  } finally { psql(["-c", `drop database if exists ${db} with (force)`], "postgres"); }
});

test("live: a migration that has to wait gives up after lock_timeout and changes nothing", dbTests, async () => {
  const db = "smq_mig_test_c"; makeDb(db);
  try {
    const blocker = spawn("psql", [...admin.split(/\s+/).filter(Boolean), "-d", db, "-X", "-qAt", "-c", "begin; update public.leads set notes = notes where id = 'l1'; select pg_sleep(12); commit;"], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 1200));
    const started = Date.now();
    expectFail(db, "smart-quote-versions-schema.sql", /lock timeout/);
    assert.ok(Date.now() - started < 9000, "must give up long before the blocking transaction ends");
    assert.equal(q(db, "select to_regclass('public.smart_quote_versions') is null"), "t");
    blocker.kill();
  } finally { psql(["-c", `drop database if exists ${db} with (force)`], "postgres"); }
});

test("live: rollback -> re-apply -> rollback keeps every version, never exposes the backup, and restore brings the history back", dbTests, () => {
  const db = "smq_mig_test_d"; makeDb(db);
  try {
    q(db, "alter default privileges in schema public grant select on tables to anon, authenticated, service_role");
    file(db, "smart-quote-versions-schema.sql");
    insertVersion(db, "v1", "SES-20261001-0001", "l1", 1); insertVersion(db, "v2", "SES-20261001-0002", "l1", 2);
    file(db, "smart-quote-versions-rollback.sql");
    assert.equal(q(db, "select to_regclass('public.smart_quote_versions') is null"), "t");
    file(db, "smart-quote-versions-schema.sql");
    insertVersion(db, "v3", "SES-20261002-0003", "l2", 1);
    file(db, "smart-quote-versions-rollback.sql");
    assert.equal(q(db, "select string_agg(distinct quote_number, ',' order by quote_number) from public.smart_quote_versions_rollback_backup"), "SES-20261001-0001,SES-20261001-0002,SES-20261002-0003");
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.throws(() => psql(["-c", `set role ${role}; select count(*) from public.smart_quote_versions_rollback_backup`], db), /permission denied/, `${role} must not read the backup`);
    }
    file(db, "smart-quote-versions-schema.sql");
    assert.equal(q(db, "select count(*) from public.smart_quote_versions"), "0", "re-apply starts empty");
    file(db, "smart-quote-versions-restore.sql"); file(db, "smart-quote-versions-restore.sql");
    assert.equal(q(db, "select string_agg(quote_number, ',' order by quote_number) from public.smart_quote_versions"), "SES-20261001-0001,SES-20261001-0002,SES-20261002-0003");
  } finally { psql(["-c", `drop database if exists ${db} with (force)`], "postgres"); }
});

test("live: rollback with nothing to roll back is a no-op, and an incomplete backup copy drops nothing", dbTests, () => {
  const db = "smq_mig_test_e"; makeDb(db);
  try {
    file(db, "smart-quote-versions-rollback.sql");
    assert.equal(q(db, "select to_regclass('public.smart_quote_versions_rollback_backup') is null"), "t");
    file(db, "smart-quote-versions-schema.sql");
    insertVersion(db, "v1", "SES-20261001-0001", "l1", 1); insertVersion(db, "v2", "SES-20261001-0002", "l2", 1);
    psql(["-c", `create table public.smart_quote_versions_rollback_backup (backed_up_at timestamptz not null, like public.smart_quote_versions);
      create function public.skip_one() returns trigger language plpgsql as $f$ begin if new.quote_number = 'SES-20261001-0002' then return null; end if; return new; end $f$;
      create trigger skip_one before insert on public.smart_quote_versions_rollback_backup for each row execute function public.skip_one()`], db);
    expectFail(db, "smart-quote-versions-rollback.sql", /rollback aborted: 2 versions in the live table but 1 copied/);
    assert.equal(q(db, "select count(*) from public.smart_quote_versions"), "2", "nothing was dropped");
  } finally { psql(["-c", `drop database if exists ${db} with (force)`], "postgres"); }
});
