// Seeds two SYNTHETIC companies for the isolation journeys. Disposable database only.
//   E2E_PSQL="-h /srv/s -p 55432 -U postgres -d sunchaser_test" TEST_PW=... node scripts/saas/e2e/seed-two-companies.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hashPassword } from "../../../src/lib/passwordHash.ts";

const arg = (flag) => { const a = (process.env.E2E_PSQL || "").split(/\s+/); const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : undefined; };
const host = arg("-h"), port = Number(arg("-p") || 5432), user = arg("-U") || "postgres", database = arg("-d");
if (!host || !database || /railway|supabase|rlwy/i.test(`${host} ${database}`)) { console.error("Set E2E_PSQL to a disposable local database."); process.exit(2); }
if (!process.env.TEST_PW) { console.error("Set TEST_PW (synthetic password)."); process.exit(2); }

const db = new pg.Client({ host, port, user, database });
await db.connect();

if (process.argv.includes("--cleanup")) {
  // Remove everything the journeys created for the two synthetic companies (rows, memberships, users, companies).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const classes = JSON.parse(fs.readFileSync(path.join(here, "..", "table-classification.json"), "utf8")).tables;
  const tenant = Object.entries(classes).filter(([, v]) => ["tenant", "tenant_config", "tenant_existing_company_id"].includes(v.class)).map(([k]) => k);
  await db.query("set session_replication_role = replica");
  for (const t of tenant) {
    const has = await db.query("select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name='company_id'", [t]);
    if (has.rowCount) await db.query(`delete from public."${t}" where company_id in ('co_alpha','co_beta')`);
  }
  await db.query("delete from company_memberships where company_id in ('co_alpha','co_beta')");
  await db.query("delete from users where id like 'u-alpha%' or id like 'u-beta%' or id in ('u-both','u-nobody')");
  await db.query("delete from companies where id in ('co_alpha','co_beta')");
  await db.query("set session_replication_role = origin");
  console.log("Removed the synthetic companies, their users and rows.");
  await db.end();
  process.exit(0);
}
const pw = () => hashPassword(process.env.TEST_PW);
const COMPANIES = [["co_alpha", "alpha", "Alpha Solar"], ["co_beta", "beta", "Beta Energy"]];
for (const [id, slug, name] of COMPANIES) await db.query("insert into companies (id, slug, name, status) values ($1,$2,$3,'active') on conflict (id) do update set status='active'", [id, slug, name]);

// users: [id, username, name, role, companyMemberships[[company, role]], customerId]
const USERS = [
  ["u-alpha-admin", "alpha_admin", "Alpha Admin", "Admin", [["co_alpha", "Admin"]]],
  ["u-alpha-sales", "alpha_sales", "Alpha Sales", "Sales Executive", [["co_alpha", "Sales Executive"]]],
  ["u-beta-admin", "beta_admin", "Beta Admin", "Admin", [["co_beta", "Admin"]]],
  ["u-beta-sales", "beta_sales", "Beta Sales", "Sales Executive", [["co_beta", "Sales Executive"]]],
  ["u-both", "both_user", "Works For Both", "Admin", [["co_alpha", "Sales Manager"], ["co_beta", "Sales Executive"]]],
  ["u-nobody", "nobody", "No Company", "Super Admin", []],
];
for (const [id, username, name, role, mem] of USERS) {
  await db.query(
    `insert into users (id, username, password, name, email, role, account_status, email_verified, onboarding_completed)
     values ($1,$2,$3,$4,$5,$6,'Approved',true,true) on conflict (id) do update set password=excluded.password, role=excluded.role, account_status='Approved'`,
    [id, username, pw(), name, `${username}@example.test`, role]);
  await db.query("delete from company_memberships where user_id=$1", [id]);
  for (const [company, mrole] of mem) await db.query("insert into company_memberships (id, company_id, user_id, role, status) values ($1,$2,$3,$4,'active')", [`mem-${company}-${id}`, company, id, mrole]);
}
// Portal customers: one per company, linked to a customer row owned by that company.
for (const [company, tag] of [["co_alpha", "alpha"], ["co_beta", "beta"]]) {
  await db.query("insert into customers (id, name, email, company_id) values ($1,$2,$3,$4) on conflict (id) do nothing", [`cust-${tag}-portal`, `${tag} portal client`, `${tag}.portal@example.test`, company]);
  await db.query(
    `insert into users (id, username, password, name, email, role, account_status, email_verified, onboarding_completed, customer_id)
     values ($1,$2,$3,$4,$5,'Customer','Approved',true,true,$6) on conflict (id) do update set password=excluded.password, customer_id=excluded.customer_id`,
    [`u-${tag}-portal`, `${tag}_portal`, pw(), `${tag} portal client`, `${tag}.portal@example.test`, `cust-${tag}-portal`]);
}
console.log("Seeded companies co_alpha, co_beta with users:", USERS.map((u) => u[1]).join(", "), "+ alpha_portal, beta_portal");
await db.end();
