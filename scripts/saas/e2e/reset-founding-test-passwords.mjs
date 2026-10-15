// Sets the password of the stack's synthetic founding-company test users (t_admin, t_sales, ...) to TEST_PW. Disposable database only.
import pg from "pg";
import { hashPassword } from "../../../src/lib/passwordHash.ts";
const arg = (flag) => { const a = (process.env.E2E_PSQL || "").split(/\s+/); const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : undefined; };
const host = arg("-h"), port = Number(arg("-p") || 5432), user = arg("-U") || "postgres", database = arg("-d");
if (!host || !database || /railway|supabase|rlwy/i.test(`${host} ${database}`) || !process.env.TEST_PW) { console.error("Set E2E_PSQL (disposable local database) and TEST_PW."); process.exit(2); }
const db = new pg.Client({ host, port, user, database }); await db.connect();
const r = await db.query("update users set password=$1 where id like 'u-test-%'", [await hashPassword(process.env.TEST_PW)]);
console.log(`Reset ${r.rowCount} synthetic test users.`); await db.end();
