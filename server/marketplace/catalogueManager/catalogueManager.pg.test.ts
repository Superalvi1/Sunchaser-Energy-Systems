/**
 * Applies catalogue-manager-core + product-media SQL on disposable Postgres.
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/marketplace/catalogueManager/catalogueManager.pg.test.ts
 *
 * Uses local Docker CLI (same pattern as other marketplace *.pg.test.ts files).
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
const root = path.resolve(__dirname, "../../..");
const IMAGE = "postgres:16-alpine";
const CONTAINER = `mp-cm-core-${randomUUID().slice(0, 8)}`;
const PORT = 55700 + Math.floor(Math.random() * 200);
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

function dockerAvailable(): boolean {
  return spawnSync("docker", ["info"], { encoding: "utf8" }).status === 0;
}

async function waitForPg(attempts = 40): Promise<void> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    const client = new pg.Client({
      connectionString: DB_URL,
      connectionTimeoutMillis: 2000,
    });
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
        /* */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Postgres not ready: ${String(last)}`);
}

async function apply(client: pg.Client, rel: string): Promise<void> {
  const sql = readFileSync(path.join(root, rel), "utf8");
  await client.query(sql);
}

async function main(): Promise<void> {
  if (!dockerAvailable()) {
    console.log("SKIP - Docker unavailable for catalogueManager.pg.test.ts");
    return;
  }

  let client: pg.Client | null = null;
  try {
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
      { stdio: "pipe" },
    );
    await waitForPg();

    client = new pg.Client({ connectionString: DB_URL });
    await client.connect();

    for (const role of ["anon", "authenticated", "service_role"]) {
      await client.query(`do $$ begin
        create role ${role};
      exception when duplicate_object then null;
      end $$;`);
    }

    await apply(client, "scripts/marketplace-ws0-foundation-schema.sql");
    await apply(client, "scripts/marketplace-ws1-additive-schema.sql");
    await apply(client, "scripts/marketplace-catalogue-manager-core.sql");
    await apply(client, "scripts/marketplace-ceo-auto-import-product-media.sql");
    // Idempotent re-apply
    await apply(client, "scripts/marketplace-catalogue-manager-core.sql");
    await apply(client, "scripts/marketplace-ceo-auto-import-product-media.sql");

    const cols = await client.query(`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='mp_products'
        and column_name in (
          'short_description','model','seo_title','seo_description',
          'datasheet_url','public_visible','last_supplier_sync_at','last_manual_edit_at'
        )
      order by 1`);
    check("product columns added", cols.rowCount === 8);

    const parent = await client.query(`
      select 1 from information_schema.columns
      where table_schema='public' and table_name='mp_categories' and column_name='parent_id'`);
    check("category parent_id added", (parent.rowCount || 0) === 1);

    const compare = await client.query(`
      select 1 from information_schema.columns
      where table_schema='public' and table_name='mp_product_variants'
        and column_name='compare_at_price'`);
    check("compare_at_price on variants", (compare.rowCount || 0) === 1);

    const tables = await client.query(`
      select tablename from pg_tables
      where schemaname='public'
        and tablename in ('mp_field_overrides','mp_import_reject_ledger')`);
    check("override + reject ledger tables", (tables.rowCount || 0) === 2);

    const mediaCols = await client.query(`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='mp_media'
        and column_name in ('source_key','supplier_code','manual_control')`);
    check("media identity columns", (mediaCols.rowCount || 0) === 3);

    // Seed minimal brand/category/product for override + media tests
    await client.query(`
      insert into public.mp_brands (id, name, slug) values ('b1','Brand','brand')
      on conflict do nothing;
      insert into public.mp_categories (id, name, slug) values ('c1','Cat','cat')
      on conflict do nothing;
      insert into public.mp_products (id, brand_id, category_id, title, slug, description)
      values ('p1','b1','c1','T','t','D')
      on conflict do nothing;
      insert into public.mp_product_variants (
        id, product_id, sku, title, is_default, active
      ) values ('v1','p1','SKU1','Default', true, true)
      on conflict do nothing;
    `);

    const ovId = await client.query(
      `select public.mp_set_field_override('p1','title','"CEO"'::jsonb,'actor1','ceo') as id`,
    );
    check("set override returns id", typeof ovId.rows[0].id === "string");

    const has = await client.query(
      `select public.mp_has_active_field_override('p1','title') as locked`,
    );
    check("has active override", has.rows[0].locked === true);

    await client.query(
      `select public.mp_ceo_auto_import_sync_product_media(
        'p1','v1','kamal',
        '[{"url":"https://cdn.shopify.com/s/files/1/x.jpg","sortOrder":0,"sourceKey":"kamal:1:1"}]'::jsonb
      )`,
    );
    const mediaBefore = await client.query(
      `select count(*)::int as n from public.mp_media where product_id='p1' and published=true`,
    );
    check("supplier media inserted", mediaBefore.rows[0].n >= 1);

    // Lock media via override — sync should no-op further changes
    await client.query(
      `select public.mp_set_field_override('p1','primary_image','"https://cdn.shopify.com/s/files/1/y.jpg"'::jsonb,'actor1','ceo')`,
    );
    await client.query(
      `select public.mp_ceo_auto_import_sync_product_media(
        'p1','v1','kamal',
        '[{"url":"https://cdn.shopify.com/s/files/1/z.jpg","sortOrder":0}]'::jsonb
      )`,
    );
    const z = await client.query(
      `select count(*)::int as n from public.mp_media
       where product_id='p1' and source_url like '%/z.jpg'`,
    );
    check("media override blocks supplier sync insert", z.rows[0].n === 0);

    await client.query(
      `select public.mp_clear_field_override('p1','primary_image','actor1','ceo')`,
    );

    // Manual control row must not be unpublished
    await client.query(`
      insert into public.mp_media (
        id, product_id, variant_id, storage_path, role, sort_order,
        source_type, source_url, rights_status, approved_by, approved_at,
        published, manual_control
      ) values (
        'mpmedia_manual1','p1','v1','own/manual','thumbnail',0,
        'own','https://cdn.shopify.com/s/files/1/manual.jpg','own','ceo',timezone('utc', now()),
        true, true
      ) on conflict (id) do nothing;
    `);
    await client.query(
      `select public.mp_ceo_auto_import_sync_product_media(
        'p1','v1','kamal',
        '[{"url":"https://cdn.shopify.com/s/files/1/x.jpg","sortOrder":0}]'::jsonb
      )`,
    );
    const manual = await client.query(
      `select published from public.mp_media where id='mpmedia_manual1'`,
    );
    check("manual media remains published", manual.rows[0].published === true);

    const rej = await client.query(
      `select public.mp_record_import_reject(
        'run1','alladin','excluded_non_solar_retail','alladin:1:1','1',
        'https://alladin.pk/products/a','Blender',null,'normalize','{}'::jsonb
      ) as id`,
    );
    check("reject ledger write", typeof rej.rows[0].id === "string");

    const counts = await client.query(
      `select public.mp_catalogue_reconciliation_counts() as c`,
    );
    check(
      "reconciliation counts jsonb",
      counts.rows[0].c.crmProducts >= 1 &&
        counts.rows[0].c.rejectLedgerRows >= 1,
    );

    // Legacy default: public_visible true
    const vis = await client.query(
      `select public_visible from public.mp_products where id='p1'`,
    );
    check("legacy public_visible default true", vis.rows[0].public_visible === true);

    console.log("\nCatalogue Manager PG migration tests passed.");
  } finally {
    if (client) await client.end().catch(() => {});
    try {
      execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "pipe" });
    } catch {
      /* */
    }
  }
}

main().catch((err) => {
  console.error(err);
  try {
    execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "pipe" });
  } catch {
    /* */
  }
  process.exit(1);
});
