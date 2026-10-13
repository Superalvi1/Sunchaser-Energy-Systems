// Database-only proof of company export/restore (no object storage, no application): used by test-company-restore.sh on a DISPOSABLE database.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { companyFingerprint, exportCompany, restoreCompany, verifyArchive } from "../../../server/saas/companyBackup.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLASSIFICATION = path.join(here, "..", "table-classification.json");
const client = { host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER, database: process.env.PGDATABASE };
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}: ${name}${!ok && detail ? " - " + String(detail).slice(0, 300) : ""}`); };
const db = new pg.Client(client); await db.connect();
const q = (sql, p) => db.query(sql, p);
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "rdb-")); process.on("exit", () => fs.rmSync(WORK, { recursive: true, force: true }));

await q("insert into companies (id, slug, name) values ('co_a','co-a','Company A'),('co_b','co-b','Company B') on conflict do nothing");
async function seed(co, tag) {
  await q("set session_replication_role = replica");
  await q(`insert into customers (id, name, email, company_id) values ($1,$2,$3,$4)`, [`c-${tag}`, `Customer ${tag}`, `${tag}@x.test`, co]);
  await q(`insert into leads (id, customer_id, name, email, phone, address, company_id) values ($1,$2,$3,$4,'0300','addr',$5)`, [`l-${tag}`, `c-${tag}`, `Lead ${tag}`, `${tag}@x.test`, co]);
  await q(`insert into invoices (id, invoice_number, customer_id, customer_name, subtotal, grand_total, balance_due, company_id) values ($1,$2,$3,$4,1000,1000,700,$5)`, [`i-${tag}`, `INV-2026-000${tag === "a" ? 1 : 2}`, `c-${tag}`, `Customer ${tag}`, co]);
  await q(`insert into invoice_items (id, invoice_id, description, qty, rate, line_total, company_id) values ($1,$2,'panel',1,1000,1000,$3)`, [`it-${tag}`, `i-${tag}`, co]);
  await q(`insert into invoice_payments (id, invoice_id, amount, payment_method, company_id) values ($1,$2,300,'Cash',$3)`, [`p-${tag}`, `i-${tag}`, co]);
  await q(`insert into customer_documents (id, customer_id, document_type, title, file_url, uploaded_by, company_id) values ($1,$2,'other','doc','u','t',$3)`, [`d-${tag}`, `c-${tag}`, co]);
  await q(`insert into bank_accounts (id, bank_name, account_title, account_number, company_id) values ($1,'Bank','Title','123',$2)`, [`b-${tag}`, co]);
  await q(`insert into company_terms (id, term_text, sort_order, company_id) values ($1,'term',1,$2)`, [`t-${tag}`, co]);
  await q(`insert into settings (key, value, company_id) values ($1,'{"x":1}',$2)`, [`${co}:global`, co]);
  await q(`insert into document_counters (company_id, kind, period, last_value) values ($1,'invoice','2026',7) on conflict (company_id, kind, period) do update set last_value = 7`, [co]);
  await q("set session_replication_role = origin");
}
await seed("co_a", "a"); await seed("co_b", "b");
await q("insert into users (id, username, password, name, email, role) values ('u-a','ua','x','UA','ua@x.test','Admin') on conflict do nothing");
await q("insert into company_memberships (id, company_id, user_id, role, status) values ('m-a','co_a','u-a','Admin','active') on conflict do nothing");
const FP = (c) => companyFingerprint(client, c, CLASSIFICATION, { skipObjects: true });
const [a0, b0, s0] = [await FP("co_a"), await FP("co_b"), await FP("sunchaser")];
check("both companies are seeded", Object.values(a0.tables).some((v) => v.startsWith("1:")) && Object.values(b0.tables).some((v) => v.startsWith("1:")));

const OUT = path.join(WORK, "a");
const m = await exportCompany({ client, companyId: "co_a", outDir: OUT, classificationFile: CLASSIFICATION, skipObjects: true });
check("export: every seeded table is in the archive in dependency order", ["customers", "leads", "invoices", "invoice_items", "invoice_payments", "customer_documents", "bank_accounts", "company_terms", "settings", "document_counters"].every((n) => m.tables.find((t) => t.name === n)?.rows === 1) && m.tables.findIndex((t) => t.name === "invoices") < m.tables.findIndex((t) => t.name === "invoice_items"));
check("verify accepts the archive; it holds nothing of company B", !!verifyArchive(OUT) && !Object.values(m.files).some(() => false) && ![...fs.readdirSync(path.join(OUT, "data"))].some((f) => fs.readFileSync(path.join(OUT, "data", f), "utf8").includes("co_b")));

// damage A only
await q("set session_replication_role = replica");
await q("delete from invoice_payments where company_id='co_a'; delete from invoice_items where company_id='co_a'; delete from invoices where company_id='co_a'; update leads set name='HACKED' where company_id='co_a'; delete from bank_accounts where company_id='co_a'; update document_counters set last_value=0 where company_id='co_a'");
await q("set session_replication_role = origin");
check("alpha is damaged and B and the founding company are not", JSON.stringify((await FP("co_a")).tables) !== JSON.stringify(a0.tables) && JSON.stringify(await FP("co_b")) === JSON.stringify(b0) && JSON.stringify((await FP("sunchaser")).tables) === JSON.stringify(s0.tables));
const ro = { client, dir: OUT, companyId: "co_a", classificationFile: CLASSIFICATION, skipObjects: true };
const dry = await restoreCompany({ ...ro, apply: false });
check("dry run changes nothing and plans the replacement", !dry.applied && JSON.stringify((await FP("co_a")).tables) !== JSON.stringify(a0.tables) && dry.tables.find((t) => t.name === "invoices").inserted === 1);
let refused = "";
try { await restoreCompany({ ...ro, companyId: "co_b", apply: true }); } catch (e) { refused = e.message; }
check("the archive of A is refused for B", /belongs to company co_a/.test(refused), refused);
const t = path.join(WORK, "t"); fs.cpSync(OUT, t, { recursive: true }); fs.appendFileSync(path.join(t, "data/leads.jsonl"), "\n");
refused = ""; try { await restoreCompany({ ...ro, dir: t, apply: true }); } catch (e) { refused = e.message; }
check("a changed file is refused", /Checksum mismatch/.test(refused), refused);
check("refusals changed nothing", JSON.stringify(await FP("co_b")) === JSON.stringify(b0) && JSON.stringify((await FP("co_a")).tables) !== JSON.stringify(a0.tables));

const rep = await restoreCompany({ ...ro, apply: true });
check("restore applies", rep.applied && rep.memberships.restored === 1, JSON.stringify(rep.memberships));
const a1 = await FP("co_a");
check("A's tables equal the export (every digest)", JSON.stringify(a1.tables) === JSON.stringify(a0.tables), Object.keys(a0.tables).filter((k) => a0.tables[k] !== a1.tables[k]).join(", "));
check("B is byte-identical (every table)", JSON.stringify(await FP("co_b")) === JSON.stringify(b0));
check("the FOUNDING company is identical", JSON.stringify((await FP("sunchaser")).tables) === JSON.stringify(s0.tables));
check("the payment guard did not recompute anything: invoice paid/balance as exported", (await q("select paid_amount::float p, balance_due::float b from invoices where id='i-a'")).rows[0].b === 700);
check("the numbering counter is back at 7 (the next number continues from the history)", (await q("select last_value::int v from document_counters where company_id='co_a' and kind='invoice'")).rows[0].v === 7);
const rep2 = await restoreCompany({ ...ro, apply: true });
check("restoring twice is harmless", rep2.applied && JSON.stringify((await FP("co_a")).tables) === JSON.stringify(a0.tables) && JSON.stringify(await FP("co_b")) === JSON.stringify(b0));
await db.end();
console.log(`\ncompany restore (database only): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
