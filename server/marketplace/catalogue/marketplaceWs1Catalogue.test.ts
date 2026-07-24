/**
 * WS1 catalogue seed + schema regression tests.
 * Spins ephemeral Postgres 16, applies WS0 + WS1 additive + seed (twice),
 * asserts frozen slug/SKU/price/spec parity, then verifies scoped rollback.
 *
 * Requires Docker. Skips with exit 2 if Docker is unavailable.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  WS1_SEED_BRAND_IDS,
  WS1_SEED_CATEGORY_IDS,
  WS1_SEED_CATEGORY_SLUGS,
  WS1_SEED_PRODUCTS,
  WS1_SEED_PRODUCT_IDS,
  WS1_SEED_SKUS,
  WS1_SEED_SLUGS,
  WS1_SEED_VARIANT_IDS,
} from "./catalogueSeedData.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const WS0_SCHEMA = path.join(ROOT, "scripts/marketplace-ws0-foundation-schema.sql");
const WS1_ADDITIVE = path.join(ROOT, "scripts/marketplace-ws1-additive-schema.sql");
const WS1_SEED = path.join(ROOT, "scripts/marketplace-ws1-catalogue-seed.sql");
const WS1_ROLLBACK = path.join(ROOT, "scripts/marketplace-ws1-catalogue-rollback.sql");
const IMAGE = "postgres:16-alpine";
const CONTAINER = `mp-ws1-test-${randomUUID().slice(0, 8)}`;
const PORT = 55632 + Math.floor(Math.random() * 200);
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

function dockerAvailable(): boolean {
  const r = spawnSync("docker", ["info"], { encoding: "utf8" });
  return r.status === 0;
}

async function waitForPg(clientFactory: () => pg.Client, attempts = 40): Promise<void> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    const client = clientFactory();
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      return;
    } catch (err) {
      last = err;
      try {
        await client.end();
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Postgres not ready: ${String(last)}`);
}

async function ensureRoles(client: pg.Client): Promise<void> {
  await client.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      end if;
    end $$;
  `);
}

async function applySqlFile(client: pg.Client, filePath: string): Promise<void> {
  await client.query(readFileSync(filePath, "utf8"));
}

/** Apply SQL expected to fail; clears aborted transaction state afterward. */
async function applySqlFileExpectReject(
  client: pg.Client,
  filePath: string,
): Promise<boolean> {
  try {
    await client.query(readFileSync(filePath, "utf8"));
    return false;
  } catch {
    try {
      await client.query("rollback");
    } catch {
      /* ignore */
    }
    return true;
  }
}

async function main(): Promise<void> {
  if (!dockerAvailable()) {
    console.error("BLOCKED: Docker unavailable — cannot run WS1 catalogue schema tests");
    process.exit(2);
  }

  check("frozen slug count is 30", WS1_SEED_SLUGS.length === 30);
  check("frozen SKU count is 30", WS1_SEED_SKUS.length === 30);
  check(
    "frozen SKUs are unique",
    new Set(WS1_SEED_SKUS).size === WS1_SEED_SKUS.length,
  );
  check(
    "frozen slugs are unique",
    new Set(WS1_SEED_SLUGS).size === WS1_SEED_SLUGS.length,
  );
  check("six categories frozen", WS1_SEED_CATEGORY_SLUGS.length === 6);

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
    { stdio: "ignore" },
  );

  const admin = new pg.Client({ connectionString: DB_URL });
  try {
    await waitForPg(() => new pg.Client({ connectionString: DB_URL }));
    await admin.connect();
    await ensureRoles(admin);
    await admin.query("grant usage on schema public to anon, authenticated, service_role");

    await applySqlFile(admin, WS0_SCHEMA);
    await applySqlFile(admin, WS1_ADDITIVE);
    await applySqlFile(admin, WS1_ADDITIVE); // repeatable
    await applySqlFile(admin, WS1_SEED);
    await applySqlFile(admin, WS1_SEED); // repeatable, no dupes

    const productCount = await admin.query(
      `select count(*)::int as n from public.mp_products where id = any($1::text[])`,
      [WS1_SEED_PRODUCT_IDS],
    );
    check("exactly 30 seeded products", productCount.rows[0].n === 30);

    const variantCount = await admin.query(
      `select count(*)::int as n from public.mp_product_variants
       where id = any($1::text[]) and is_default = true`,
      [WS1_SEED_VARIANT_IDS],
    );
    check("exactly 30 default variants", variantCount.rows[0].n === 30);

    const defaultsPerProduct = await admin.query(
      `select product_id, count(*)::int as n
       from public.mp_product_variants
       where id = any($1::text[]) and is_default and active
       group by product_id`,
      [WS1_SEED_VARIANT_IDS],
    );
    check(
      "one default variant per seeded product",
      defaultsPerProduct.rows.length === 30 &&
        defaultsPerProduct.rows.every((r) => r.n === 1),
    );

    const skuRows = await admin.query(
      `select sku from public.mp_product_variants where id = any($1::text[])`,
      [WS1_SEED_VARIANT_IDS],
    );
    const dbSkus = skuRows.rows.map((r) => r.sku).sort();
    check(
      "all 30 approved SKUs present and unique",
      dbSkus.length === 30 &&
        new Set(dbSkus).size === 30 &&
        JSON.stringify(dbSkus) === JSON.stringify([...WS1_SEED_SKUS].sort()),
    );

    const slugRows = await admin.query(
      `select slug from public.mp_products where id = any($1::text[])`,
      [WS1_SEED_PRODUCT_IDS],
    );
    const dbSlugs = slugRows.rows.map((r) => r.slug).sort();
    check(
      "exactly 30 expected slugs exist",
      JSON.stringify(dbSlugs) === JSON.stringify([...WS1_SEED_SLUGS].sort()),
    );

    for (const expected of WS1_SEED_PRODUCTS) {
      const row = await admin.query(
        `select p.slug, p.specifications, p.warranty, p.featured,
                v.sku, v.website_price::numeric as website_price,
                v.website_price_source, v.website_price_state, v.stock_status, v.is_default
         from public.mp_products p
         join public.mp_product_variants v on v.product_id = p.id and v.is_default
         where p.id = $1`,
        [expected.productId],
      );
      const r = row.rows[0];
      check(
        `price matches products.ts for ${expected.slug}`,
        Number(r.website_price) === expected.websitePrice,
      );
      if (expected.originalPrice != null) {
        check(
          `originalPrice not seeded as website_price for ${expected.slug}`,
          Number(r.website_price) !== expected.originalPrice,
        );
      }
      check(
        `source=seed for ${expected.slug}`,
        r.website_price_source === "seed",
      );
      check(
        `state=priced_auto for ${expected.slug}`,
        r.website_price_state === "priced_auto",
      );
      check(`stock=unknown for ${expected.slug}`, r.stock_status === "unknown");
      check(`default variant for ${expected.slug}`, r.is_default === true);
      check(`sku frozen for ${expected.slug}`, r.sku === expected.sku);
      const dbSpecs = r.specifications as Record<string, string>;
      const expectedKeys = Object.keys(expected.specifications).sort();
      const dbKeys = Object.keys(dbSpecs || {}).sort();
      check(
        `specs key-for-key for ${expected.slug}`,
        JSON.stringify(dbKeys) === JSON.stringify(expectedKeys) &&
          expectedKeys.every((k) => dbSpecs[k] === expected.specifications[k]),
      );
      check(
        `warranty preserved for ${expected.slug}`,
        r.warranty === expected.warranty,
      );
    }

    const catRows = await admin.query(
      `select slug from public.mp_categories where id = any($1::text[]) order by sort_order`,
      [WS1_SEED_CATEGORY_IDS],
    );
    check(
      "all six categories preserved",
      catRows.rows.map((r) => r.slug).join(",") ===
        [...WS1_SEED_CATEGORY_SLUGS].join(","),
    );

    const costCount = await admin.query(
      `select count(*)::int as n from public.mp_product_costs`,
    );
    check("no purchase costs seeded", costCount.rows[0].n === 0);

    const mediaCount = await admin.query(
      `select count(*)::int as n from public.mp_media`,
    );
    check("no media rows seeded", mediaCount.rows[0].n === 0);

    // Operational price must survive re-seed
    const eco = WS1_SEED_PRODUCTS.find(
      (p) => p.slug === "knox-krypton-eco-6-2kw-hybrid",
    )!;
    await admin.query("begin");
    await admin.query(`select set_config('mp.allow_price_write', 'on', true)`);
    await admin.query(
      `update public.mp_product_variants
       set website_price = 999999,
           website_price_source = 'override',
           website_price_state = 'priced_override'
       where id = $1`,
      [eco.variantId],
    );
    await admin.query("commit");
    await applySqlFile(admin, WS1_SEED);
    const after = await admin.query(
      `select website_price::numeric as website_price, website_price_source
       from public.mp_product_variants where id = $1`,
      [eco.variantId],
    );
    check(
      "re-seed does not overwrite operational price",
      Number(after.rows[0].website_price) === 999999 &&
        after.rows[0].website_price_source === "override",
    );

    // -------------------------------------------------------------------------
    // Cascade-safe rollback fixtures
    // -------------------------------------------------------------------------
    const longi = WS1_SEED_PRODUCTS.find((p) => p.slug === "longi-himo6-580w-mono")!;
    const pylon = WS1_SEED_PRODUCTS.find((p) => p.slug === "pylontech-us5000-4-8kwh")!;
    const mc4 = WS1_SEED_PRODUCTS.find((p) => p.slug === "mc4-solar-connectors-pair")!;
    const unusedBrandVictim = WS1_SEED_PRODUCTS.find(
      (p) => p.brandId !== longi.brandId && p.brandId !== pylon.brandId && p.brandId !== eco.brandId,
    )!;

    // Non-seeded sibling variant on a seeded product
    await admin.query(
      `insert into public.mp_product_variants
         (id, product_id, sku, title, is_default, stock_status, website_price,
          website_price_state, website_price_source, active)
       values
         ('mpvar_ops_longi_extra', $1, 'SKU-OPS-LONGI-EXTRA', 'Ops Extra', false,
          'unknown', 100, 'confirm_price', null, true)`,
      [longi.productId],
    );

    // Operational dependent attached to a seeded default variant (cascade FK)
    await admin.query(
      `insert into public.mp_price_overrides
         (id, product_id, variant_id, override_price, status, mode, reason, created_by)
       values
         ('mpovr_ops_pylon', $1, $2, 270000, 'active', 'permanent',
          'ops retention fixture', 'test')`,
      [pylon.productId, pylon.variantId],
    );

    // Non-seed product referencing a seed brand (brand retention)
    await admin.query(
      `insert into public.mp_products
         (id, brand_id, category_id, title, slug, description, specifications)
       values
         ('mpprod_ops_keep', $1, $2, 'Ops Keep', 'ops-keep-product', '', '{}'::jsonb)`,
      [eco.brandId, eco.categoryId],
    );

    await applySqlFile(admin, WS1_ROLLBACK);

    const opsVariantLeft = await admin.query(
      `select count(*)::int as n from public.mp_product_variants where id = 'mpvar_ops_longi_extra'`,
    );
    check(
      "non-seeded variant on seeded product survives rollback",
      opsVariantLeft.rows[0].n === 1,
    );

    const longiProductLeft = await admin.query(
      `select count(*)::int as n from public.mp_products where id = $1`,
      [longi.productId],
    );
    check(
      "seeded parent product survives when non-seeded variant remains",
      longiProductLeft.rows[0].n === 1,
    );

    const longiSeedVariantLeft = await admin.query(
      `select count(*)::int as n from public.mp_product_variants where id = $1`,
      [longi.variantId],
    );
    check(
      "seeded default variant without dependents is removed",
      longiSeedVariantLeft.rows[0].n === 0,
    );

    const overrideLeft = await admin.query(
      `select count(*)::int as n from public.mp_price_overrides where id = 'mpovr_ops_pylon'`,
    );
    check(
      "operational dependent on seeded variant survives rollback",
      overrideLeft.rows[0].n === 1,
    );

    const pylonVariantLeft = await admin.query(
      `select count(*)::int as n from public.mp_product_variants where id = $1`,
      [pylon.variantId],
    );
    const pylonProductLeft = await admin.query(
      `select count(*)::int as n from public.mp_products where id = $1`,
      [pylon.productId],
    );
    check(
      "seeded variant parent survives when operational dependent exists",
      pylonVariantLeft.rows[0].n === 1,
    );
    check(
      "seeded product parent survives when operational dependent exists",
      pylonProductLeft.rows[0].n === 1,
    );

    const mc4Left = await admin.query(
      `select count(*)::int as n from public.mp_products where id = $1`,
      [mc4.productId],
    );
    const mc4VarLeft = await admin.query(
      `select count(*)::int as n from public.mp_product_variants where id = $1`,
      [mc4.variantId],
    );
    check("seed-only product removed by rollback", mc4Left.rows[0].n === 0);
    check("seed-only variant removed by rollback", mc4VarLeft.rows[0].n === 0);

    const opsProductLeft = await admin.query(
      `select count(*)::int as n from public.mp_products where id = 'mpprod_ops_keep'`,
    );
    check("non-seed product survives rollback", opsProductLeft.rows[0].n === 1);

    const longiBrandLeft = await admin.query(
      `select count(*)::int as n from public.mp_brands where id = $1`,
      [longi.brandId],
    );
    const pylonBrandLeft = await admin.query(
      `select count(*)::int as n from public.mp_brands where id = $1`,
      [pylon.brandId],
    );
    const ecoBrandLeft = await admin.query(
      `select count(*)::int as n from public.mp_brands where id = $1`,
      [eco.brandId],
    );
    check(
      "brands referenced by retained products survive",
      longiBrandLeft.rows[0].n === 1 &&
        pylonBrandLeft.rows[0].n === 1 &&
        ecoBrandLeft.rows[0].n === 1,
    );

    const orphanBrandLeft = await admin.query(
      `select count(*)::int as n from public.mp_brands where id = $1`,
      [unusedBrandVictim.brandId],
    );
    check(
      "unused seed brand removed when no retained products reference it",
      orphanBrandLeft.rows[0].n === 0,
    );

    // -------------------------------------------------------------------------
    // Bidirectional ownership guards
    // -------------------------------------------------------------------------
    // Restore a clean seed for collision tests
    await applySqlFile(admin, WS1_SEED);

    const brandVictim = WS1_SEED_PRODUCTS[0]!;
    const beforeBrand = await admin.query(
      `select slug, name from public.mp_brands where id = $1`,
      [brandVictim.brandId],
    );
    const beforePrice = await admin.query(
      `select website_price::numeric as website_price, website_price_state, website_price_source
       from public.mp_product_variants where id = $1`,
      [brandVictim.variantId],
    );

    await admin.query(
      `update public.mp_brands set slug = 'foreign-hijacked-slug' where id = $1`,
      [brandVictim.brandId],
    );

    const brandCollisionRejected = await applySqlFileExpectReject(admin, WS1_SEED);
    check(
      "deterministic brand ID with foreign slug is rejected",
      brandCollisionRejected,
    );

    const afterBrand = await admin.query(
      `select slug from public.mp_brands where id = $1`,
      [brandVictim.brandId],
    );
    check(
      "rejected brand collision leaves foreign slug unchanged",
      afterBrand.rows[0].slug === "foreign-hijacked-slug",
    );

    const afterPriceBrand = await admin.query(
      `select website_price::numeric as website_price, website_price_state, website_price_source
       from public.mp_product_variants where id = $1`,
      [brandVictim.variantId],
    );
    check(
      "rejected brand collision does not alter published price/state",
      Number(afterPriceBrand.rows[0].website_price) ===
        Number(beforePrice.rows[0].website_price) &&
        afterPriceBrand.rows[0].website_price_state ===
          beforePrice.rows[0].website_price_state &&
        afterPriceBrand.rows[0].website_price_source ===
          beforePrice.rows[0].website_price_source,
    );

    // Restore brand ownership, then test variant ID / SKU mismatch
    await admin.query(
      `update public.mp_brands set slug = $2, name = $3 where id = $1`,
      [brandVictim.brandId, beforeBrand.rows[0].slug, beforeBrand.rows[0].name],
    );

    const variantVictim = WS1_SEED_PRODUCTS[1]!;
    const beforeVar = await admin.query(
      `select sku, product_id, website_price::numeric as website_price,
              website_price_state, website_price_source
       from public.mp_product_variants where id = $1`,
      [variantVictim.variantId],
    );

    await admin.query("begin");
    await admin.query(`select set_config('mp.allow_price_write', 'on', true)`);
    await admin.query(
      `update public.mp_product_variants
         set sku = 'FOREIGN-SKU-COLLISION', website_price = 123456,
             website_price_state = 'priced_override', website_price_source = 'override'
       where id = $1`,
      [variantVictim.variantId],
    );
    await admin.query("commit");

    const variantCollisionRejected = await applySqlFileExpectReject(
      admin,
      WS1_SEED,
    );
    check(
      "deterministic variant ID with foreign SKU is rejected",
      variantCollisionRejected,
    );

    const afterVar = await admin.query(
      `select sku, product_id, website_price::numeric as website_price,
              website_price_state, website_price_source
       from public.mp_product_variants where id = $1`,
      [variantVictim.variantId],
    );
    check(
      "rejected variant collision leaves foreign SKU/product_id unchanged",
      afterVar.rows[0].sku === "FOREIGN-SKU-COLLISION" &&
        afterVar.rows[0].product_id === beforeVar.rows[0].product_id,
    );
    check(
      "rejected variant collision does not alter published price/state",
      Number(afterVar.rows[0].website_price) === 123456 &&
        afterVar.rows[0].website_price_state === "priced_override" &&
        afterVar.rows[0].website_price_source === "override",
    );

    // product_id mismatch on deterministic variant id
    // Clear default flag first so the unique one-default-per-product index allows the move.
    await admin.query(
      `update public.mp_product_variants
         set sku = $2, is_default = false
       where id = $1`,
      [variantVictim.variantId, beforeVar.rows[0].sku],
    );
    const otherProduct = WS1_SEED_PRODUCTS.find(
      (p) => p.productId !== variantVictim.productId,
    )!;
    await admin.query(
      `update public.mp_product_variants set product_id = $2 where id = $1`,
      [variantVictim.variantId, otherProduct.productId],
    );
    const productIdCollisionRejected = await applySqlFileExpectReject(
      admin,
      WS1_SEED,
    );
    check(
      "deterministic variant ID with foreign product_id is rejected",
      productIdCollisionRejected,
    );
    const afterProductId = await admin.query(
      `select product_id from public.mp_product_variants where id = $1`,
      [variantVictim.variantId],
    );
    check(
      "rejected product_id collision leaves pre-existing row unchanged",
      afterProductId.rows[0].product_id === otherProduct.productId,
    );

    // Restore correct ownership and prove normal seed remains repeatable
    await admin.query(
      `update public.mp_product_variants
         set product_id = $2, sku = $3, is_default = true
       where id = $1`,
      [variantVictim.variantId, variantVictim.productId, variantVictim.sku],
    );
    await admin.query("begin");
    await admin.query(`select set_config('mp.allow_price_write', 'on', true)`);
    await admin.query(
      `update public.mp_product_variants
         set website_price = $2, website_price_state = 'priced_auto',
             website_price_source = 'seed'
       where id = $1`,
      [variantVictim.variantId, variantVictim.websitePrice],
    );
    await admin.query("commit");

    await applySqlFile(admin, WS1_SEED);
    await applySqlFile(admin, WS1_SEED);
    const repeatCount = await admin.query(
      `select count(*)::int as n from public.mp_products where id = any($1::text[])`,
      [WS1_SEED_PRODUCT_IDS],
    );
    check("normal seed remains repeatable at 30 products", repeatCount.rows[0].n === 30);

    // Privilege: anon cannot select mp_products
    await admin.query("set role anon");
    let anonBlocked = false;
    try {
      await admin.query("select 1 from public.mp_products limit 1");
    } catch {
      anonBlocked = true;
    }
    await admin.query("reset role");
    check("anon cannot select mp_products", anonBlocked);

    // specifications object constraint
    let badSpecBlocked = false;
    try {
      await admin.query(
        `insert into public.mp_products
           (id, brand_id, category_id, title, slug, specifications)
         values
           ('mpprod_bad_spec', $1, $2, 'Bad', 'bad-spec', '[]'::jsonb)`,
        [eco.brandId, eco.categoryId],
      );
    } catch {
      badSpecBlocked = true;
    }
    check("specifications must be JSON object", badSpecBlocked);

    console.log("marketplaceWs1Catalogue.test.ts: all checks passed");
  } finally {
    try {
      await admin.end();
    } catch {
      /* ignore */
    }
    try {
      execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(err);
  try {
    execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
