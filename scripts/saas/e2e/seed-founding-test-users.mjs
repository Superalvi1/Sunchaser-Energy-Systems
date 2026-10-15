// Inserts the synthetic founding-company test users (t_admin, t_sales, t_accounts, two portal clients) into a DISPOSABLE database, BEFORE the
// tenant migrations run (the company foundation then gives them their founding-company memberships). Same users the repair journeys use.
//   E2E_PSQL="-h 127.0.0.1 -p 5432 -U postgres -d t_ci_stack" TEST_PW=... node --import tsx scripts/saas/e2e/seed-founding-test-users.mjs
import pg from "pg";
import { hashPassword } from "../../../src/lib/passwordHash.ts";
const arg = (flag) => { const a = (process.env.E2E_PSQL || "").split(/\s+/); const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : undefined; };
const host = arg("-h"), port = Number(arg("-p") || 5432), user = arg("-U") || "postgres", database = arg("-d");
if (!host || !database || /railway|supabase|rlwy/i.test(`${host} ${database}`) || !process.env.TEST_PW) { console.error("Set E2E_PSQL (disposable local database) and TEST_PW."); process.exit(2); }
const db = new pg.Client({ host, port, user, database }); await db.connect();
const pw = await hashPassword(process.env.TEST_PW);
const rows = [["u-test-admin", "t_admin", "Test Super Admin", "Super Admin"], ["u-test-sales", "t_sales", "Test Sales Exec", "Sales Executive"], ["u-test-accounts", "t_accounts", "Test Accounts", "Accounts Manager"], ["u-test-portal-a", "t_portal_a", "Synthetic Portal Client", "Customer"], ["u-test-portal-b", "t_portal_b", "Synthetic Other Client", "Customer"]];
for (const [id, username, name, role] of rows) {
  await db.query("insert into public.users (id, username, password, name, email, role, account_status, email_verified, onboarding_completed) values ($1,$2,$3,$4,$5,$6,'Approved',true,true) on conflict (id) do update set password = excluded.password",
    [id, username, pw, name, `${username}@example.test`, role]);
}
console.log(`Seeded ${rows.length} synthetic founding-company users.`);
await db.end();
