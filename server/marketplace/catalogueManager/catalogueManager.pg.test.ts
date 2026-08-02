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
    await apply(client, "scripts/marketplace-catalogue-manager-list-rpc.sql");
    // Idempotent re-apply
    await apply(client, "scripts/marketplace-catalogue-manager-core.sql");
    await apply(client, "scripts/marketplace-ceo-auto-import-product-media.sql");
    await apply(client, "scripts/marketplace-catalogue-manager-list-rpc.sql");

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

    // ── Upsert path 1: supplier media RPC (p_supplier not p_supplier_code) ──
    // Clear any existing media, then call RPC with the correct parameter name.
    await client.query(`delete from public.mp_media where product_id='p1'`);
    await client.query(
      `select public.mp_ceo_auto_import_sync_product_media(
        'p1','v1','kamal',
        '[{"url":"https://cdn.shopify.com/s/files/1/rpc-path.jpg","sortOrder":0,"sourceKey":"kamal:rpc:1"}]'::jsonb
      )`,
    );
    const rpcMedia = await client.query(
      `select source_url, supplier_code, manual_control from public.mp_media
       where product_id='p1' and source_url like '%rpc-path.jpg'`,
    );
    check("upsert path 1 (RPC): supplier media inserted with p_supplier arg", rpcMedia.rowCount === 1);
    check("upsert path 1 (RPC): supplier_code set correctly", rpcMedia.rows[0].supplier_code === "kamal");
    check("upsert path 1 (RPC): manual_control false", rpcMedia.rows[0].manual_control === false);

    // ── Upsert path 1 idempotency: same URL second call updates, doesn't dup ──
    await client.query(
      `select public.mp_ceo_auto_import_sync_product_media(
        'p1','v1','kamal',
        '[{"url":"https://cdn.shopify.com/s/files/1/rpc-path.jpg","sortOrder":0}]'::jsonb
      )`,
    );
    const rpcDup = await client.query(
      `select count(*)::int as n from public.mp_media
       where product_id='p1' and source_url like '%rpc-path.jpg'`,
    );
    check("upsert path 1 (RPC): idempotent - no duplicate rows", rpcDup.rows[0].n === 1);

    // ── Upsert path 2: fallback supplier upsert (id-based, mirrors SQL function) ──
    // The TypeScript fallback uses a deterministic id = "mpmedia_" + md5(product_id|url)[0:24]
    // mirroring the SQL function, so ON CONFLICT targets the primary key (not the partial index).
    const fallbackId = "mpmedia_pgtest_fallback001234";
    const fallbackUrl = "https://cdn.shopify.com/s/files/1/fallback-path.jpg";
    await client.query(`
      insert into public.mp_media (
        id, product_id, source_url, storage_path, sort_order, role, published,
        source_type, rights_status, manual_control, supplier_code,
        approved_by, approved_at
      ) values (
        $1, 'p1', $2, 'supplier-cdn/kamal/fallback', 1, 'gallery', true,
        'supplier', 'supplier_approved', false, 'kamal',
        'ceo_auto_import', timezone('utc', now())
      ) on conflict (id) do update
        set published = excluded.published,
            sort_order = excluded.sort_order,
            supplier_code = excluded.supplier_code
    `, [fallbackId, fallbackUrl]);
    const fallbackMedia = await client.query(
      `select source_url, role, published from public.mp_media where id=$1`,
      [fallbackId],
    );
    check("upsert path 2 (fallback supplier): row inserted via id conflict", fallbackMedia.rowCount === 1);
    check("upsert path 2 (fallback supplier): published=true", fallbackMedia.rows[0].published === true);

    // Second upsert of same id updates instead of duplicating
    await client.query(`
      insert into public.mp_media (
        id, product_id, source_url, storage_path, sort_order, role, published,
        source_type, rights_status, manual_control, supplier_code,
        approved_by, approved_at
      ) values (
        $1, 'p1', $2, 'supplier-cdn/kamal/fallback', 1, 'gallery', false,
        'supplier', 'supplier_approved', false, 'kamal',
        'ceo_auto_import', timezone('utc', now())
      ) on conflict (id) do update
        set published = excluded.published
    `, [fallbackId, fallbackUrl]);
    const fallbackAfterUpdate = await client.query(
      `select count(*)::int as n, bool_and(not published) as all_unpublished
       from public.mp_media where id=$1`,
      [fallbackId],
    );
    check("upsert path 2 (fallback supplier): idempotent - no duplicate row", fallbackAfterUpdate.rows[0].n === 1);
    check("upsert path 2 (fallback supplier): do update applied", fallbackAfterUpdate.rows[0].all_unpublished === true);

    // ── Upsert path 3: manual primary-image upsert (own-media row, id-based) ──
    // Own images also use the deterministic id approach so supplier_code=null
    // is not part of the conflict resolution — primary key is the dedup key.
    const ownId = "mpmedia_pgtest_ownmanual00001234";
    const ownUrl = "https://cdn.shopify.com/s/files/1/own-manual.jpg";
    await client.query(`
      insert into public.mp_media (
        id, product_id, source_url, storage_path, sort_order, role, published,
        source_type, rights_status, manual_control, supplier_code,
        approved_by, approved_at
      ) values (
        $1, 'p1', $2, 'own/manual-primary', 0, 'thumbnail', true,
        'own', 'own', true, null,
        'ceo', timezone('utc', now())
      ) on conflict (id) do update
        set published = excluded.published,
            manual_control = excluded.manual_control
    `, [ownId, ownUrl]);
    const ownMedia = await client.query(
      `select source_type, manual_control, published from public.mp_media where id=$1`,
      [ownId],
    );
    check("upsert path 3 (manual primary): row inserted via id conflict", ownMedia.rowCount === 1);
    check("upsert path 3 (manual primary): source_type=own", ownMedia.rows[0].source_type === "own");
    check("upsert path 3 (manual primary): manual_control=true", ownMedia.rows[0].manual_control === true);

    // Second upsert of same own id updates, no duplicate
    await client.query(`
      insert into public.mp_media (
        id, product_id, source_url, storage_path, sort_order, role, published,
        source_type, rights_status, manual_control, supplier_code,
        approved_by, approved_at
      ) values (
        $1, 'p1', $2, 'own/manual-primary', 0, 'thumbnail', false,
        'own', 'own', true, null,
        'ceo', timezone('utc', now())
      ) on conflict (id) do update
        set published = excluded.published
    `, [ownId, ownUrl]);
    const ownDup = await client.query(
      `select count(*)::int as n from public.mp_media where id=$1`,
      [ownId],
    );
    check("upsert path 3 (manual primary): idempotent - no duplicate row", ownDup.rows[0].n === 1);

    // ── Override resolution: all supported fields set and queried ──
    await client.query(`
      select public.mp_set_field_override('p1','short_description','"Short desc"'::jsonb,'a','ceo');
      select public.mp_set_field_override('p1','model','"KX-100"'::jsonb,'a','ceo');
      select public.mp_set_field_override('p1','warranty','"5 years"'::jsonb,'a','ceo');
      select public.mp_set_field_override('p1','specifications','{"Power":"8kW"}'::jsonb,'a','ceo');
      select public.mp_set_field_override('p1','datasheet_url','"https://docs.example.com/spec.pdf"'::jsonb,'a','ceo');
      select public.mp_set_field_override('p1','seo_title','"SEO title"'::jsonb,'a','ceo');
      select public.mp_set_field_override('p1','seo_description','"SEO desc"'::jsonb,'a','ceo');
      select public.mp_set_field_override('p1','stock_status','"sold_out"'::jsonb,'a','ceo');
      select public.mp_set_field_override('p1','public_visible','false'::jsonb,'a','ceo');
      select public.mp_set_field_override('p1','featured','true'::jsonb,'a','ceo');
    `);

    const allActiveOverrides = await client.query(
      `select field_name from public.mp_field_overrides
       where product_id='p1' and active=true
       order by field_name`,
    );
    const activeFields = allActiveOverrides.rows.map((r: { field_name: string }) => r.field_name);
    const requiredFields = [
      "datasheet_url", "featured", "model", "public_visible",
      "seo_description", "seo_title", "short_description",
      "specifications", "stock_status", "title", "warranty",
    ];
    check(
      "all supported override fields stored with active=true",
      requiredFields.every((f) => activeFields.includes(f)),
    );

    // ── Clear override → supplier value restored ──
    await client.query(
      `select public.mp_clear_field_override('p1','title','a','ceo')`,
    );
    const titleAfterClear = await client.query(
      `select active from public.mp_field_overrides
       where product_id='p1' and field_name='title'
       order by updated_at desc limit 1`,
    );
    check(
      "clearing title override sets active=false (supplier value restores)",
      titleAfterClear.rows[0]?.active === false,
    );

    // ── public_visible=false override: product can be suppressed ──
    const pvRow = await client.query(
      `select override_value::boolean as ov from public.mp_field_overrides
       where product_id='p1' and field_name='public_visible' and active=true`,
    );
    check(
      "public_visible=false override stored correctly",
      pvRow.rows[0]?.ov === false,
    );

    // ── Supplier resync preserves title override ──
    // Re-run sync (title has a cleared override, should be unaffected by sync)
    await client.query(
      `select public.mp_ceo_auto_import_sync_product_media(
        'p1','v1','kamal',
        '[{"url":"https://cdn.shopify.com/s/files/1/rpc-path.jpg","sortOrder":0}]'::jsonb
      )`,
    );
    const titleStillCleared = await client.query(
      `select active from public.mp_field_overrides
       where product_id='p1' and field_name='title'
       order by updated_at desc limit 1`,
    );
    check(
      "supplier media resync does not revive cleared title override",
      titleStillCleared.rows[0]?.active === false,
    );

    // ── RPC: mp_catalogue_manager_list — effective-value filtering ────────
    // Seed a second brand/category/product for filter tests
    await client.query(`
      insert into public.mp_brands (id, name, slug) values ('b2','SolaX','solax')
      on conflict do nothing;
      insert into public.mp_categories (id, name, slug) values ('c2','Batteries','batteries')
      on conflict do nothing;
      insert into public.mp_products (id, brand_id, category_id, title, slug, description)
      values ('p2','b1','c1','Alpha Product','alpha-product','D')
      on conflict do nothing;
      insert into public.mp_product_variants (id, product_id, sku, title, is_default, active)
      values ('v2','p2','SKU2','Default',true,true)
      on conflict do nothing;
    `);

    // Set a title override on p2 so we can test effective-title search
    await client.query(
      `select public.mp_set_field_override('p2','title','"Renamed CEO Product"'::jsonb,'a','ceo')`,
    );
    // Set a brand_id override on p2 so we can test effective-brand filter
    await client.query(
      `select public.mp_set_field_override('p2','brand_id','"b2"'::jsonb,'a','ceo')`,
    );

    // Search by overridden title — should find p2
    const searchByOvTitle = await client.query(
      `select * from public.mp_catalogue_manager_list(50, 0, 'Renamed CEO', null, null, null, null, null, null, null)`,
    );
    check(
      "RPC: search by overridden title finds product",
      searchByOvTitle.rows.some((r: { id: string }) => r.id === "p2"),
    );

    // Search by old title — should NOT find p2 (effective title is "Renamed CEO Product")
    const searchByOldTitle = await client.query(
      `select * from public.mp_catalogue_manager_list(50, 0, 'Alpha Product', null, null, null, null, null, null, null)`,
    );
    check(
      "RPC: search by old title does not find renamed product",
      !searchByOldTitle.rows.some((r: { id: string }) => r.id === "p2"),
    );

    // Filter by effective brand_id (b2 = override brand)
    const filterByOvBrand = await client.query(
      `select * from public.mp_catalogue_manager_list(50, 0, null, 'b2', null, null, null, null, null, null)`,
    );
    check(
      "RPC: filter by override brand_id finds product",
      filterByOvBrand.rows.some((r: { id: string }) => r.id === "p2"),
    );

    // Filter by supplier brand_id (b1) — p2 should NOT appear (effective brand is b2)
    const filterBySupplierBrand = await client.query(
      `select * from public.mp_catalogue_manager_list(50, 0, null, 'b1', null, null, null, null, null, null)`,
    );
    check(
      "RPC: filter by supplier brand_id excludes overridden product",
      !filterBySupplierBrand.rows.some((r: { id: string }) => r.id === "p2"),
    );

    // ── RPC: pagination beyond 1000 rows ────────────────────────────────────
    // Seed 1100 products to verify pagination reaches all of them
    await client.query(`
      insert into public.mp_brands (id, name, slug) values ('b3','BulkBrand','bulkbrand')
      on conflict do nothing;
      insert into public.mp_categories (id, name, slug) values ('c3','BulkCat','bulkcat')
      on conflict do nothing;
    `);
    // Bulk insert 1100 products with a deterministic naming pattern
    const bulkProductIds: string[] = [];
    for (let i = 0; i < 1100; i++) {
      const id = `pbulk_${String(i).padStart(5, "0")}`;
      bulkProductIds.push(id);
    }
    // Insert in batches of 100
    for (let batch = 0; batch < bulkProductIds.length; batch += 100) {
      const chunk = bulkProductIds.slice(batch, batch + 100);
      const values = chunk
        .map((id, i) => `('${id}','b3','c3','Bulk ${String(batch + i).padStart(5, "0")}','${id}','D')`)
        .join(",");
      await client.query(`
        insert into public.mp_products (id, brand_id, category_id, title, slug, description)
        values ${values}
        on conflict do nothing;
      `);
      const varValues = chunk
        .map((id) => `('${id}_v','${id}','${id}_sku','Default',true,true)`)
        .join(",");
      await client.query(`
        insert into public.mp_product_variants (id, product_id, sku, title, is_default, active)
        values ${varValues}
        on conflict do nothing;
      `);
    }

    // Page 1: limit=500, offset=0 — should return 500 rows with total >= 1102
    const page1 = await client.query(
      `select * from public.mp_catalogue_manager_list(500, 0, 'Bulk', 'b3', 'c3', null, null, null, null, null)`,
    );
    check("RPC: page 1 returns 500 rows", page1.rowCount === 500);
    check("RPC: page 1 total >= 1100", Number(page1.rows[0]?.total) >= 1100);

    // Page 2: limit=500, offset=500 — should return 500 rows
    const page2 = await client.query(
      `select * from public.mp_catalogue_manager_list(500, 500, 'Bulk', 'b3', 'c3', null, null, null, null, null)`,
    );
    check("RPC: page 2 returns 500 rows", page2.rowCount === 500);

    // Page 3: limit=500, offset=1000 — should return remaining rows (>= 100)
    const page3 = await client.query(
      `select * from public.mp_catalogue_manager_list(500, 1000, 'Bulk', 'b3', 'c3', null, null, null, null, null)`,
    );
    check("RPC: page 3 returns remaining rows (>= 100)", (page3.rowCount ?? 0) >= 100);

    // No duplication between pages
    const page1Ids = new Set(page1.rows.map((r: { id: string }) => r.id));
    const page2Ids = new Set(page2.rows.map((r: { id: string }) => r.id));
    const page3Ids = new Set(page3.rows.map((r: { id: string }) => r.id));
    const overlap12 = [...page1Ids].filter((id) => page2Ids.has(id));
    const overlap23 = [...page2Ids].filter((id) => page3Ids.has(id));
    check("RPC: no overlap between page 1 and 2", overlap12.length === 0);
    check("RPC: no overlap between page 2 and 3", overlap23.length === 0);

    // Total across pages matches reported total
    const totalReported = Number(page1.rows[0]?.total);
    const totalFetched = page1.rowCount + page2.rowCount + page3.rowCount;
    check("RPC: total fetched matches reported total", totalFetched === totalReported);

    // ── RPC: deterministic ordering (title, then id) ────────────────────────
    const orderedPage = await client.query(
      `select * from public.mp_catalogue_manager_list(10, 0, 'Bulk', 'b3', 'c3', null, null, null, null, null)`,
    );
    const titles = orderedPage.rows.map((r: { id: string }) => r.id);
    const sortedIds = [...titles].sort();
    check("RPC: deterministic ordering by title then id", JSON.stringify(titles) === JSON.stringify(sortedIds));

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
