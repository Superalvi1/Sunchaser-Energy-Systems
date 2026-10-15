// Operator scripts that connect to PostgreSQL DIRECTLY (a connection string, no PostgREST) bypass the database barrier of t1b-tenancy-barrier, so they check the
// persistent tenancy marker themselves and refuse to run against a database that holds, or is marked to hold, more than one company.
//   import { assertSingleCompanyDatabase } from "./lib/assertSingleCompanyDatabase.mjs";   await assertSingleCompanyDatabase(client)   // client: a connected pg client
export async function assertSingleCompanyDatabase(client) {
  let mode = "single";
  try {
    const r = await client.query("select value from app.config where key = 'tenancy.mode'");
    mode = r.rows?.[0]?.value || "single";
  } catch (e) {
    if (!/does not exist|undefined_table|42P01|3F000/i.test(`${e?.code || ""} ${e?.message || ""}`)) throw e;   // no app.config at all: a database that never had the tenant migrations
  }
  let others = 0;
  try { others = Number((await client.query("select count(*) as n from public.companies where id <> 'sunchaser'")).rows?.[0]?.n || 0); }
  catch (e) { if (!/does not exist|42P01/i.test(`${e?.code || ""} ${e?.message || ""}`)) throw e; }
  if (mode === "multi" || others > 0) {
    throw new Error(`Refused: this database is marked multi-company (marker ${mode}, ${others} other company row(s)). This script does not know about companies and must not run here.`);
  }
}
