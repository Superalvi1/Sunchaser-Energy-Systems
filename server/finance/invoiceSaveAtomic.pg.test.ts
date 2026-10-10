import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Runs scripts/invoice-payments-integrity.sql and scripts/invoice-save-atomic.sql (+ rollback) for real against a SCRATCH PostgreSQL
 * server and exercises public.invoice_save_atomic: transactional replace of lines + header, stale-version refusal, foreign line ids,
 * header/lines consistency, ledger rules and concurrent edits. Skipped unless MIGRATION_TEST_PSQL is set; REQUIRE_DB_TESTS=1 (CI)
 * turns a missing database into a failure.
 *
 *   MIGRATION_TEST_PSQL="-h 127.0.0.1 -p 5432 -U postgres" PGPASSWORD=... REQUIRE_DB_TESTS=1 node --import tsx server/finance/invoiceSaveAtomic.pg.test.ts
 *
 * Disposable server only: the test creates and drops a database named inv_atomic_test_* and creates the roles anon, authenticated and
 * service_role when missing. It refuses anything but a local socket directory or 127.0.0.1/localhost.
 */
const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts");
const psqlArgs = (process.env.MIGRATION_TEST_PSQL || "").split(/\s+/).filter(Boolean);
const arg = (flag: string) => psqlArgs[psqlArgs.indexOf(flag) + 1];
const skipReason = !psqlArgs.length ? "MIGRATION_TEST_PSQL is not set" : "";
if (skipReason && process.env.REQUIRE_DB_TESTS === "1") throw new Error(`REQUIRE_DB_TESTS=1 but ${skipReason}`);
const host = arg("-h") || "";
if (psqlArgs.length && !(host.startsWith("/") || host === "127.0.0.1" || host === "localhost")) throw new Error("refusing a non-local server");

const DB = `inv_atomic_test_${process.pid}`;
const base = { host, port: Number(arg("-p") || 5432), user: arg("-U") || "postgres", password: process.env.PGPASSWORD };
const psql = (db: string, args: string[]) =>
  execFileSync("psql", [...psqlArgs, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", db, ...args], { env: process.env, stdio: ["ignore", "pipe", "pipe"] }).toString();
const file = (db: string, name: string) => psql(db, ["-f", path.join(scripts, name)]);
let pool: pg.Pool;
let n = 0;

before(() => {
  if (skipReason) return;
  psql("postgres", ["-c", `drop database if exists ${DB} with (force)`, "-c", `create database ${DB}`]);
  psql(DB, ["-c", `do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$; create table public.customers (id text primary key); create table public.bank_accounts (id text primary key, account_title text, is_active boolean, bank_name text, account_number text, iban text);`]);
  for (const f of ["invoice-module-schema.sql", "invoice-status-schema.sql", "invoice-archive-schema.sql", "invoice-vyapar-schema.sql"]) file(DB, f);
  file(DB, "invoice-payments-integrity.sql");
  file(DB, "invoice-save-atomic.sql");
  pool = new pg.Pool({ ...base, database: DB, max: 12 });
});
after(async () => {
  if (skipReason) return;
  await pool?.end();
  psql("postgres", ["-c", `drop database if exists ${DB} with (force)`]);
});

const item = (id: string, qty: number, rate: number, discount = 0) => ({ id, sort_order: 0, item_name: id, description: id, qty, unit: "job", rate, tax_percent: 0, discount_amount: discount, line_total: Math.max(0, qty * rate - discount), product_id: null, notes: null });
const header = (items: ReturnType<typeof item>[], discount = 0) => {
  const subtotal = items.reduce((s, x) => s + x.qty * x.rate, 0);
  return { subtotal, discount_amount: discount, tax_amount: 0, grand_total: Math.max(0, subtotal - discount), updated_by: "test" };
};
async function newInvoice(total = 100000) {
  const id = `inv-at-${++n}-${Date.now()}`;
  await pool.query(`insert into invoices (id, invoice_number, customer_name, subtotal, grand_total, balance_due) values ($1, $2, 'Synthetic', $3, $3, $3)`, [id, `AT-${n}-${Date.now()}`, total]);
  await pool.query(`insert into invoice_items (id, invoice_id, description, qty, rate, line_total) values ($1, $2, 'Base', 1, $3, $3)`, [`${id}-base`, id, total]);
  return id;
}
const save = (id: string, expected: string | null, patch: object, items: object[] | null) =>
  pool.query(`select invoice_save_atomic($1, $2, $3::jsonb, $4::jsonb) r`, [id, expected, JSON.stringify(patch), items === null ? null : JSON.stringify(items)]);
const state = async (id: string) => {
  const h = (await pool.query(`select subtotal::float s, grand_total::float g, updated_at::text u from invoices where id=$1`, [id])).rows[0];
  const l = (await pool.query(`select id, (qty*rate)::float amount from invoice_items where invoice_id=$1 order by id`, [id])).rows;
  return { ...h, lines: l, lineSum: l.reduce((s: number, x: any) => s + x.amount, 0) };
};
const t = (name: string, fn: () => Promise<void>) => test(name, { skip: skipReason || false }, fn);

t("replaces lines and header together and the stored lines reproduce the header", async () => {
  const id = await newInvoice();
  const items = [item(`${id}-a`, 2, 30000), item(`${id}-b`, 1, 5000)];
  await save(id, null, header(items, 1000), items);
  const s = await state(id);
  assert.equal(s.lines.length, 2);
  assert.equal(s.s, 65000);
  assert.equal(s.g, 64000);
  assert.equal(s.lineSum, s.s);
});

t("a stale expected version is refused (PT409) and nothing is written", async () => {
  const id = await newInvoice();
  const before = await state(id);
  const items = [item(`${id}-a`, 1, 1)];
  await save(id, null, header(items), items); // moves updated_at on
  const mid = await state(id);
  await assert.rejects(save(id, before.u, header([item(`${id}-z`, 1, 999)]), [item(`${id}-z`, 1, 999)]), (e: any) => e.code === "PT409" && /^invoice_conflict/.test(e.message));
  assert.deepEqual(await state(id), mid);
  await save(id, mid.u, header([item(`${id}-z`, 1, 999)]), [item(`${id}-z`, 1, 999)]); // current version is accepted
  assert.equal((await state(id)).s, 999);
});

t("a line id that belongs to another invoice is refused and not taken over", async () => {
  const a = await newInvoice();
  const b = await newInvoice();
  const steal = [item(`${a}-base`, 1, 1)];
  await assert.rejects(save(b, null, header(steal), steal), (e: any) => /^invoice_item_id_conflict/.test(e.message));
  assert.equal((await pool.query(`select invoice_id from invoice_items where id=$1`, [`${a}-base`])).rows[0].invoice_id, a);
});

t("a header that disagrees with its lines rolls the whole save back", async () => {
  const id = await newInvoice();
  const before = await state(id);
  await assert.rejects(save(id, null, { subtotal: 999, grand_total: 999, discount_amount: 0 }, [item(`${id}-x`, 1, 5)]), (e: any) => e.code === "PT422" && /^invoice_totals_inconsistent/.test(e.message));
  assert.deepEqual(await state(id), before);
});

t("the total cannot be lowered below recorded payments; the lines stay as they were", async () => {
  const id = await newInvoice(100000);
  await pool.query(`insert into invoice_payments (id, invoice_id, amount, payment_method) values ($1, $2, 60000, 'Cash')`, [`pay-${id}`, id]);
  const before = await state(id);
  const items = [item(`${id}-low`, 1, 50000)];
  await assert.rejects(save(id, null, header(items), items), (e: any) => /^invoice_total_below_payments/.test(e.message));
  assert.deepEqual(await state(id), before);
  const [paid] = (await pool.query(`select paid_amount::float p, balance_due::float b from invoices where id=$1`, [id])).rows;
  assert.deepEqual(paid, { p: 60000, b: 40000 });
});

t("concurrent edits from many connections serialise: no deadlock, and the final lines belong to exactly one edit", async () => {
  const id = await newInvoice();
  const sets = Array.from({ length: 10 }, (_, i) => {
    const items = [item(`${id}-s${i}-a`, 1 + (i % 3), 1000 * (i + 1)), item(`${id}-s${i}-b`, 1, 77 * (i + 1))];
    return { items, patch: header(items, i % 2 ? 100 : 0), marker: `s${i}` };
  });
  const results = await Promise.allSettled(sets.map((s) => save(id, null, s.patch, s.items)));
  assert.ok(results.every((r) => r.status === "fulfilled"), JSON.stringify(results.filter((r) => r.status === "rejected")));
  const s = await state(id);
  const markers = new Set(s.lines.map((l: any) => l.id.split("-")[l.id.split("-").length - 2]));
  assert.equal(markers.size, 1, `lines from several edits: ${[...markers]}`);
  assert.equal(s.lineSum, s.s);
  const winner = sets.find((x) => `${id}-${x.marker}-a` === s.lines.find((l: any) => l.id.endsWith("-a")).id)!;
  assert.equal(s.g, winner.patch.grand_total);
});

t("anon and authenticated cannot execute the function; service_role can; rollback removes it", async () => {
  const q = (role: string) => pool.query(`select has_function_privilege($1, 'public.invoice_save_atomic(text,timestamptz,jsonb,jsonb)', 'execute') ok`, [role]);
  assert.equal((await q("anon")).rows[0].ok, false);
  assert.equal((await q("authenticated")).rows[0].ok, false);
  assert.equal((await q("service_role")).rows[0].ok, true);
  file(DB, "invoice-save-atomic-rollback.sql");
  assert.equal((await pool.query(`select to_regprocedure('public.invoice_save_atomic(text,timestamptz,jsonb,jsonb)') is null ok`)).rows[0].ok, true);
  file(DB, "invoice-save-atomic.sql"); // re-apply is clean
  assert.equal((await q("service_role")).rows[0].ok, true);
});
