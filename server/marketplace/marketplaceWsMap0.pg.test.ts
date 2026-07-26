/**
 * WS-MAP-0 PostgreSQL guard tests (disposable Docker Postgres only).
 * Run: npm run test:marketplace-ws-map-0
 *
 * Does NOT apply SQL to any hosted database.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const WS0 = path.join(ROOT, "scripts/marketplace-ws0-foundation-schema.sql");
const WS1 = path.join(ROOT, "scripts/marketplace-ws1-additive-schema.sql");
const WS3 = path.join(ROOT, "scripts/marketplace-ws3-pricing-engine.sql");
const GUARD = path.join(ROOT, "scripts/marketplace-ws-map-0-legacy-guard.sql");
const IMAGE = "postgres:16-alpine";
const CONTAINER = `mp-ws-map-0-test-${randomUUID().slice(0, 8)}`;
const PORT = 55800 + Math.floor(Math.random() * 200);
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;
const SCOPE = "admin:super:u-sa";

function check(name: string, ok: boolean): void {
  assert.equal(ok, true, name);
  console.log(`ok - ${name}`);
}

function dockerAvailable(): boolean {
  return spawnSync("docker", ["info"], { encoding: "utf8" }).status === 0;
}

async function waitForPg(attempts = 40): Promise<void> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    const c = new pg.Client({
      connectionString: DB_URL,
      connectionTimeoutMillis: 2000,
    });
    try {
      await c.connect();
      await c.query("select 1");
      await c.end();
      return;
    } catch (err) {
      last = err;
      try {
        await c.end();
      } catch {
        /* */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Postgres not ready: ${String(last)}`);
}

async function ensureRoles(client: pg.Client): Promise<void> {
  await client.query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$;
  `);
}

async function apply(client: pg.Client, file: string): Promise<void> {
  await client.query(readFileSync(file, "utf8"));
}

async function main(): Promise<void> {
  if (!dockerAvailable()) {
    console.error("WS-MAP-0 PG BLOCKED: Docker unavailable");
    process.exit(2);
  }

  console.log(`Starting ${IMAGE} as ${CONTAINER} on :${PORT}`);
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      CONTAINER,
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-p",
      `${PORT}:5432`,
      IMAGE,
    ],
    { stdio: "inherit" },
  );

  const admin = new pg.Client({ connectionString: DB_URL });
  try {
    await waitForPg();
    await admin.connect();
    await ensureRoles(admin);
    await apply(admin, WS0);
    await apply(admin, WS1);
    await apply(admin, WS3);

    await admin.query(`
      insert into public.mp_brands (id, name, slug)
        values ('mpbrand_map0', 'Map0', 'map0') on conflict do nothing;
      insert into public.mp_categories (id, name, slug)
        values ('mpcat_map0', 'Map0 Cat', 'map0-cat') on conflict do nothing;
      insert into public.mp_products (id, brand_id, category_id, title, slug)
        values ('mpprod_map0', 'mpbrand_map0', 'mpcat_map0', 'Map0 Product', 'map0-product')
        on conflict do nothing;
      insert into public.mp_product_variants (id, product_id, sku, title, is_default, active, website_price)
        values ('mpvar_map0', 'mpprod_map0', 'SC-MAP0', 'Default', true, true, 123456)
        on conflict do nothing;
      insert into public.mp_supplier_products (
        id, supplier_id, product_id, variant_id, supplier_product_id,
        normalized_exact_model, match_confidence, match_locked, active
      ) values (
        'mpsp_map0_existing', 'mpsup_kamal', 'mpprod_map0', 'mpvar_map0',
        'EXISTING-SP', 'existing-model', 'exact', false, true
      ) on conflict do nothing;
    `);

    const before = await admin.query(
      `select id, supplier_product_id, match_confidence, match_locked, active,
              md5(row(id, supplier_product_id, match_confidence, match_locked, active, updated_at)::text) as fp
         from public.mp_supplier_products where id = 'mpsp_map0_existing'`,
    );
    check("seed mapping exists", before.rowCount === 1);

    const priceBefore = await admin.query(
      `select website_price from public.mp_product_variants where id = 'mpvar_map0'`,
    );
    check(
      "website_price baseline",
      Number(priceBefore.rows[0].website_price) === 123456,
    );

    // Apply guard twice (idempotent)
    await apply(admin, GUARD);
    await apply(admin, GUARD);
    check("guard migration reapplies safely", true);

    const after = await admin.query(
      `select id, supplier_product_id, match_confidence, match_locked, active,
              md5(row(id, supplier_product_id, match_confidence, match_locked, active, updated_at)::text) as fp
         from public.mp_supplier_products where id = 'mpsp_map0_existing'`,
    );
    check(
      "existing mapping rows unchanged",
      after.rows[0].fp === before.rows[0].fp &&
        after.rows[0].supplier_product_id === "EXISTING-SP",
    );

    // Owner/superuser callable path is fail-closed (raises sanitized error)
    let raised = false;
    let msg = "";
    try {
      await admin.query(
        `select public.mp_admin_upsert_supplier_mapping(
          $1,'kamal','mpprod_map0','mpvar_map0','NEW-SP',null,null,'NEW-MODEL','exact',false,true,null
        )`,
        [SCOPE],
      );
    } catch (err: any) {
      raised = true;
      msg = String(err?.message || err);
    }
    check(
      "RPC raises LEGACY_MAPPING_DISABLED",
      raised && msg.includes("LEGACY_MAPPING_DISABLED"),
    );

    const countAfter = await admin.query(
      `select count(*)::int as n from public.mp_supplier_products`,
    );
    check(
      "RPC did not create/modify mappings",
      countAfter.rows[0].n === 1 &&
        (
          await admin.query(
            `select supplier_product_id from public.mp_supplier_products where id='mpsp_map0_existing'`,
          )
        ).rows[0].supplier_product_id === "EXISTING-SP",
    );

    // Revoked roles cannot execute
    for (const role of ["anon", "authenticated", "service_role"] as const) {
      let denied = false;
      await admin.query("begin");
      try {
        await admin.query(`set local role ${role}`);
        await admin.query(
          `select public.mp_admin_upsert_supplier_mapping(
            $1,'kamal','mpprod_map0','mpvar_map0','ROLE-SP',null,null,'M','exact',false,true,null
          )`,
          [SCOPE],
        );
      } catch {
        denied = true;
      } finally {
        try {
          await admin.query("rollback");
        } catch {
          /* */
        }
      }
      check(`EXECUTE denied for ${role}`, denied);
    }

    const priceAfter = await admin.query(
      `select website_price from public.mp_product_variants where id = 'mpvar_map0'`,
    );
    check(
      "no website_price change",
      Number(priceAfter.rows[0].website_price) === 123456,
    );

    // Guard must not create controlled-mapping tables or alter publication flags
    const weirdTables = await admin.query(`
      select tablename from pg_tables
      where schemaname = 'public'
        and tablename like '%controlled_mapping%'
    `);
    check("no controlled-mapping tables created", weirdTables.rowCount === 0);

    // mp_publish_price still exists but was not invoked by this migration
    const pubFn = await admin.query(`
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'mp_publish_price'
    `);
    check("mp_publish_price still present (untouched by guard)", pubFn.rowCount === 1);

    console.log("\nWS-MAP-0 PostgreSQL guard tests passed.");
  } finally {
    try {
      await admin.end();
    } catch {
      /* */
    }
    try {
      execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
    } catch {
      /* */
    }
  }
}

main().catch((err) => {
  console.error(err);
  try {
    execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  } catch {
    /* */
  }
  process.exit(1);
});
