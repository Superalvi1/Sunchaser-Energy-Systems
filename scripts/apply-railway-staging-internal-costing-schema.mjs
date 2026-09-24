import fs from "node:fs";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const connectionString = String(process.env.TARGET_DATABASE_URL || "").trim();
const mode = String(process.env.RAILWAY_INTERNAL_COSTING_SCHEMA_MODE || "validate").trim();

if (!connectionString) {
  throw new Error("TARGET_DATABASE_URL is required.");
}
if (!["validate", "apply"].includes(mode)) {
  throw new Error("RAILWAY_INTERNAL_COSTING_SCHEMA_MODE must be validate or apply.");
}

const dbUrl = new URL(connectionString);
if (!dbUrl.hostname.endsWith(".railway.internal")) {
  throw new Error("Refusing to run: target database is not on Railway private networking.");
}
if (
  mode === "apply" &&
  process.env.RAILWAY_INTERNAL_COSTING_SCHEMA_APPLY_CONFIRMED !== "true"
) {
  throw new Error(
    "Apply mode requires RAILWAY_INTERNAL_COSTING_SCHEMA_APPLY_CONFIRMED=true."
  );
}

const sqlPath = new URL("./railway-staging-internal-costing-schema.sql", import.meta.url);
const schemaSql = fs.readFileSync(sqlPath, "utf8");
const transactionalBody = schemaSql
  .replace(/^\s*begin;\s*$/gim, "")
  .replace(/^\s*commit;\s*$/gim, "");

const client = new Client({ connectionString });

async function tableCount() {
  const result = await client.query(
    "select count(*)::int as count from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'"
  );
  return Number(result.rows[0]?.count || 0);
}

async function targetState() {
  const tables = await client.query(`
    select
      to_regclass('public.internal_costing_sheets') is not null as sheets,
      to_regclass('public.investors') is not null as investors,
      to_regclass('public.inventory_purchases') is not null as purchases
  `);

  const ownerColumns = await client.query(`
    select
      exists(
        select 1 from information_schema.columns
        where table_schema='public'
          and table_name='internal_costing_sheets'
          and column_name='created_by_user_id'
      ) as sheets_owner,
      exists(
        select 1 from information_schema.columns
        where table_schema='public'
          and table_name='inventory_purchases'
          and column_name='created_by_user_id'
      ) as purchases_owner
  `);

  const security = await client.query(`
    select relname, relrowsecurity, relforcerowsecurity
    from pg_class
    where oid in (
      to_regclass('public.internal_costing_sheets'),
      to_regclass('public.investors'),
      to_regclass('public.inventory_purchases')
    )
    order by relname
  `);

  const serviceRole = await client.query(`
    select exists(select 1 from pg_roles where rolname='service_role') as exists,
           coalesce((select rolbypassrls from pg_roles where rolname='service_role'), false) as bypass_rls
  `);

  const privileges = await client.query(`
    select
      has_table_privilege('service_role','public.internal_costing_sheets','SELECT,INSERT,UPDATE,DELETE') as sheets,
      has_table_privilege('service_role','public.investors','SELECT,INSERT,UPDATE,DELETE') as investors,
      has_table_privilege('service_role','public.inventory_purchases','SELECT,INSERT,UPDATE,DELETE') as purchases
  `);

  return {
    tables: tables.rows[0],
    ownerColumns: ownerColumns.rows[0],
    security: security.rows,
    serviceRole: serviceRole.rows[0],
    privileges: privileges.rows[0],
  };
}

function assertReady(state) {
  if (!state.tables?.sheets || !state.tables?.investors || !state.tables?.purchases) {
    throw new Error("One or more internal-costing tables are missing after migration.");
  }
  if (!state.ownerColumns?.sheets_owner || !state.ownerColumns?.purchases_owner) {
    throw new Error("Durable finance ownership columns are missing.");
  }
  if (state.security.length !== 3) {
    throw new Error("Could not verify RLS state for all three internal-costing tables.");
  }
  for (const row of state.security) {
    if (!row.relrowsecurity || !row.relforcerowsecurity) {
      throw new Error(`RLS is not enabled+forced for ${row.relname}.`);
    }
  }
  if (!state.serviceRole?.exists || !state.serviceRole?.bypass_rls) {
    throw new Error("service_role is missing or does not bypass RLS.");
  }
  if (
    !state.privileges?.sheets ||
    !state.privileges?.investors ||
    !state.privileges?.purchases
  ) {
    throw new Error("service_role CRUD privileges are incomplete.");
  }
}

await client.connect();
try {
  const beforeCount = await tableCount();
  const before = await targetState().catch(() => null);

  if (mode === "validate") {
    await client.query("begin");
    try {
      await client.query(transactionalBody);
      const duringCount = await tableCount();
      const during = await targetState();
      assertReady(during);
      console.log(
        JSON.stringify({
          event: "RAILWAY_INTERNAL_COSTING_SCHEMA_VALIDATE_PASS",
          beforeTableCount: beforeCount,
          transactionTableCount: duringCount,
          targetTablesExistedBefore: before?.tables || null,
          targetTablesReadyInTransaction: during.tables,
          ownerColumnsReady: during.ownerColumns,
          rlsReady: during.security.every(
            (row) => row.relrowsecurity && row.relforcerowsecurity
          ),
          serviceRoleReady:
            !!during.serviceRole?.exists && !!during.serviceRole?.bypass_rls,
          privilegesReady: Object.values(during.privileges || {}).every(Boolean),
          committed: false,
        })
      );
    } finally {
      await client.query("rollback");
    }
    const afterRollbackCount = await tableCount();
    if (afterRollbackCount !== beforeCount) {
      throw new Error(
        `Validation rollback changed table count: ${beforeCount} -> ${afterRollbackCount}`
      );
    }
    console.log(
      JSON.stringify({
        event: "RAILWAY_INTERNAL_COSTING_SCHEMA_ROLLBACK_VERIFIED",
        tableCount: afterRollbackCount,
      })
    );
  } else {
    if (![142, 145].includes(beforeCount)) {
      throw new Error(
        `Unexpected Railway staging public table count before apply: ${beforeCount}`
      );
    }
    await client.query(schemaSql);
    const afterCount = await tableCount();
    const after = await targetState();
    assertReady(after);
    if (afterCount !== 145) {
      throw new Error(
        `Expected 145 public tables after apply, found ${afterCount}.`
      );
    }
    console.log(
      JSON.stringify({
        event: "RAILWAY_INTERNAL_COSTING_SCHEMA_APPLY_PASS",
        beforeTableCount: beforeCount,
        afterTableCount: afterCount,
        targetTablesReady: after.tables,
        ownerColumnsReady: after.ownerColumns,
        rlsReady: after.security.every(
          (row) => row.relrowsecurity && row.relforcerowsecurity
        ),
        serviceRoleReady:
          !!after.serviceRole?.exists && !!after.serviceRole?.bypass_rls,
        privilegesReady: Object.values(after.privileges || {}).every(Boolean),
        committed: true,
      })
    );
  }
} finally {
  await client.end();
}
