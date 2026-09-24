import process from "node:process";
import pg from "pg";

const { Client } = pg;
const connectionString = String(process.env.TARGET_DATABASE_URL || "").trim();
const mode = String(process.env.RAILWAY_SYNTHETIC_CLEANUP_MODE || "validate").trim();
const SMART_QUOTE_LEAD_ID = "lead-6542a187-36a2-4e36-8367-9b7d7639b1ba";

const EXPECTED_BEFORE = {
  customers: 123,
  leads: 82,
  users: 10,
  invoices: 132,
  activity_logs: 1305,
};
const EXPECTED_AFTER = {
  customers: 119,
  leads: 78,
  users: 7,
  invoices: 132,
  activity_logs: 1300,
};
const EXPECTED_CANDIDATES = {
  users: 3,
  customers: 4,
  leads: 4,
  activity_logs: 5,
};

if (!connectionString) throw new Error("TARGET_DATABASE_URL is required.");
if (!["validate", "apply"].includes(mode)) {
  throw new Error("RAILWAY_SYNTHETIC_CLEANUP_MODE must be validate or apply.");
}
const dbUrl = new URL(connectionString);
if (!dbUrl.hostname.endsWith(".railway.internal")) {
  throw new Error("Refusing to run: target database is not on Railway private networking.");
}
if (
  mode === "apply" &&
  process.env.RAILWAY_SYNTHETIC_CLEANUP_APPLY_CONFIRMED !== "true"
) {
  throw new Error(
    "Apply mode requires RAILWAY_SYNTHETIC_CLEANUP_APPLY_CONFIRMED=true."
  );
}

const client = new Client({ connectionString });

async function totals() {
  const result = await client.query(`
    select
      (select count(*)::int from public.customers) as customers,
      (select count(*)::int from public.leads) as leads,
      (select count(*)::int from public.users) as users,
      (select count(*)::int from public.invoices) as invoices,
      (select count(*)::int from public.activity_logs) as activity_logs
  `);
  return result.rows[0];
}

function assertTotals(actual, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    if (Number(actual?.[key]) !== value) {
      throw new Error(
        `${label}: expected ${key}=${value}, found ${actual?.[key]}`
      );
    }
  }
}

async function createCandidateTables() {
  await client.query(`
    create temp table railway_cleanup_users on commit drop as
    select id, customer_id
    from public.users
    where username like 'railwayverify%'
      and email = username || '@example.com'
      and name = 'Railway Migration Verification'
      and role = 'Customer';

    create temp table railway_cleanup_customers on commit drop as
    select distinct id
    from (
      select c.id
      from public.customers c
      where c.user_id in (select id from railway_cleanup_users)
         or c.id in (
           select customer_id
           from railway_cleanup_users
           where customer_id is not null
         )
      union
      select l.customer_id
      from public.leads l
      where l.id = $1
        and l.customer_id is not null
    ) candidates
    where id is not null;

    create temp table railway_cleanup_leads on commit drop as
    select distinct id
    from public.leads
    where customer_id in (select id from railway_cleanup_customers)
       or id = $1;

    create temp table railway_cleanup_activity on commit drop as
    select distinct a.id
    from public.activity_logs a
    where
      a.user_id in (select id from railway_cleanup_users)
      or (
        a.user_name = 'Railway Migration Verification'
        and a.timestamp >= timestamptz '2026-09-24 09:50:00+00'
        and a.timestamp < timestamptz '2026-09-24 10:00:00+00'
      )
      or (
        a.user_id = 'public-gateway'
        and a.action = 'Lead Created'
        and a.details = 'Registered via public marketing lead gateway.'
        and a.user_name = (
          select l.name from public.leads l where l.id = $1
        )
        and a.timestamp >= timestamptz '2026-09-24 09:53:00+00'
        and a.timestamp < timestamptz '2026-09-24 09:54:00+00'
      );
  `, [SMART_QUOTE_LEAD_ID]);
}

async function candidateCounts() {
  const result = await client.query(`
    select
      (select count(*)::int from railway_cleanup_users) as users,
      (select count(*)::int from railway_cleanup_customers) as customers,
      (select count(*)::int from railway_cleanup_leads) as leads,
      (select count(*)::int from railway_cleanup_activity) as activity_logs
  `);
  return result.rows[0];
}

async function deleteCandidates() {
  await client.query(`
    delete from public.activity_logs
    where id in (select id from railway_cleanup_activity);

    delete from public.leads
    where id in (select id from railway_cleanup_leads);

    delete from public.customers
    where id in (select id from railway_cleanup_customers);

    delete from public.users
    where id in (select id from railway_cleanup_users);
  `);
}

await client.connect();
try {
  const before = await totals();
  assertTotals(before, EXPECTED_BEFORE, "Pre-cleanup guard");

  await client.query("begin");
  try {
    await createCandidateTables();
    const candidates = await candidateCounts();
    assertTotals(candidates, EXPECTED_CANDIDATES, "Candidate guard");

    await deleteCandidates();
    const projected = await totals();
    assertTotals(projected, EXPECTED_AFTER, "Projected cleanup parity");

    console.log(
      JSON.stringify({
        event:
          mode === "validate"
            ? "RAILWAY_SYNTHETIC_CLEANUP_VALIDATE_PASS"
            : "RAILWAY_SYNTHETIC_CLEANUP_PRECOMMIT_PASS",
        before,
        candidates,
        projected,
        committed: mode === "apply",
      })
    );

    if (mode === "apply") {
      await client.query("commit");
    } else {
      await client.query("rollback");
    }
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {}
    throw error;
  }

  const final = await totals();
  if (mode === "validate") {
    assertTotals(final, EXPECTED_BEFORE, "Validation rollback");
    console.log(
      JSON.stringify({
        event: "RAILWAY_SYNTHETIC_CLEANUP_ROLLBACK_VERIFIED",
        final,
      })
    );
  } else {
    assertTotals(final, EXPECTED_AFTER, "Committed cleanup parity");
    console.log(
      JSON.stringify({
        event: "RAILWAY_SYNTHETIC_CLEANUP_APPLY_PASS",
        final,
        committed: true,
      })
    );
  }
} finally {
  await client.end();
}
