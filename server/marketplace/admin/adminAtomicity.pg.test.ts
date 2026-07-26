/**
 * WS2C2 PostgreSQL-backed admin write atomicity tests.
 * Disposable local Postgres via Docker only — never touches remote Supabase.
 *
 * Run: npm run test:marketplace-ws2-atomicity
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const WS0 = path.join(ROOT, "scripts/marketplace-ws0-foundation-schema.sql");
const WS1 = path.join(ROOT, "scripts/marketplace-ws1-additive-schema.sql");
const WS2 = path.join(ROOT, "scripts/marketplace-ws2-admin-atomicity.sql");
const IMAGE = "postgres:16-alpine";
const CONTAINER = `mp-ws2c2-test-${randomUUID().slice(0, 8)}`;
const PORT = 55600 + Math.floor(Math.random() * 200);
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;

const ACTOR = {
  id: "u-adm",
  username: "admin",
  role: "Admin",
};

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

async function applySql(client: pg.Client, filePath: string): Promise<void> {
  await client.query(readFileSync(filePath, "utf8"));
}

async function seedTaxonomy(client: pg.Client): Promise<{
  brandId: string;
  categoryId: string;
}> {
  const brandId = "mpbrand_ws2c2";
  const categoryId = "mpcat_ws2c2";
  await client.query(
    `insert into public.mp_brands (id, name, slug, active)
     values ($1, 'WS2 Brand', 'ws2-brand', true)
     on conflict do nothing`,
    [brandId],
  );
  await client.query(
    `insert into public.mp_categories (id, name, slug, active, sort_order)
     values ($1, 'WS2 Cat', 'ws2-cat', true, 1)
     on conflict do nothing`,
    [categoryId],
  );
  return { brandId, categoryId };
}

async function createProduct(
  client: pg.Client,
  args: {
    brandId: string;
    categoryId: string;
    title: string;
    slug: string;
    sku: string;
  },
) {
  const { rows } = await client.query(
    `select public.mp_admin_create_product(
      $1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11,$12,$13,$14
    ) as result`,
    [
      ACTOR.id,
      ACTOR.username,
      ACTOR.role,
      args.brandId,
      args.categoryId,
      args.title,
      args.slug,
      "desc",
      ["tag"],
      true,
      false,
      args.sku,
      "Default",
      true,
    ],
  );
  return rows[0].result as { productId: string; variantId: string };
}

async function defaultCount(
  client: pg.Client,
  productId: string,
): Promise<number> {
  const { rows } = await client.query(
    `select count(*)::int as n
     from public.mp_product_variants
     where product_id = $1 and is_default and active`,
    [productId],
  );
  return Number(rows[0].n);
}

async function commercialSnapshot(
  client: pg.Client,
  variantId: string,
): Promise<Record<string, unknown>> {
  const { rows } = await client.query(
    `select website_price, website_price_state, website_price_source,
            price_published_at, stock_status
     from public.mp_product_variants where id = $1`,
    [variantId],
  );
  return rows[0];
}

async function main(): Promise<void> {
  if (!dockerAvailable()) {
    console.error(
      "WS2C2 BLOCKED: Docker unavailable — cannot run PostgreSQL atomicity tests",
    );
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
    await applySql(admin, WS0);
    await applySql(admin, WS1);
    await applySql(admin, WS2);
    await applySql(admin, WS2); // idempotent re-apply
    const { brandId, categoryId } = await seedTaxonomy(admin);

    // 1. Successful create → product + default variant + both audits
    const created = await createProduct(admin, {
      brandId,
      categoryId,
      title: "Atomic Product",
      slug: "atomic-product",
      sku: "SC-ATOMIC_1",
    });
    const productCount = await admin.query(
      `select count(*)::int as n from public.mp_products where id = $1`,
      [created.productId],
    );
    const variantCount = await admin.query(
      `select count(*)::int as n from public.mp_product_variants where product_id = $1`,
      [created.productId],
    );
    const audits = await admin.query(
      `select action from public.mp_audit_events
       where entity_id in ($1, $2)
       order by action`,
      [created.productId, created.variantId],
    );
    check("1. product row created", productCount.rows[0].n === 1);
    check("1. default variant created", variantCount.rows[0].n === 1);
    check(
      "1. both audits present",
      audits.rows.map((r) => r.action).join(",") ===
        "product.created,variant.created",
    );
    check(
      "1. exactly one active default",
      (await defaultCount(admin, created.productId)) === 1,
    );

    // 2. Forced failure after product insert rolls back entire RPC
    await admin.query(`
      create or replace function public.mp_ws2c2_fail_variant_insert()
      returns trigger language plpgsql set search_path = '' as $$
      begin
        if new.sku = 'SC-FORCE-FAIL' then
          raise exception 'forced variant failure for atomicity test';
        end if;
        return new;
      end;
      $$;
      drop trigger if exists mp_ws2c2_fail_variant_insert_trg on public.mp_product_variants;
      create trigger mp_ws2c2_fail_variant_insert_trg
        before insert on public.mp_product_variants
        for each row execute function public.mp_ws2c2_fail_variant_insert();
    `);
    let rolledBack = false;
    try {
      await createProduct(admin, {
        brandId,
        categoryId,
        title: "Should Roll Back",
        slug: "should-roll-back",
        sku: "SC-FORCE-FAIL",
      });
    } catch {
      rolledBack = true;
    }
    const orphan = await admin.query(
      `select count(*)::int as n from public.mp_products where slug = 'should-roll-back'`,
    );
    const orphanAudit = await admin.query(
      `select count(*)::int as n from public.mp_audit_events
       where payload->>'slug' = 'should-roll-back'`,
    );
    check("2. forced post-product failure raises", rolledBack);
    check("2. no partial product remains", orphan.rows[0].n === 0);
    check("2. no partial audits remain", orphanAudit.rows[0].n === 0);
    await admin.query(`
      drop trigger if exists mp_ws2c2_fail_variant_insert_trg on public.mp_product_variants;
      drop function if exists public.mp_ws2c2_fail_variant_insert();
    `);

    // 3 + 4. Forced audit failure rolls back product update
    await admin.query(`
      create or replace function public.mp_ws2c2_fail_audit()
      returns trigger language plpgsql set search_path = '' as $$
      begin
        if new.action = 'product.updated' then
          raise exception 'forced audit failure for atomicity test';
        end if;
        return new;
      end;
      $$;
      drop trigger if exists mp_ws2c2_fail_audit_trg on public.mp_audit_events;
      create trigger mp_ws2c2_fail_audit_trg
        before insert on public.mp_audit_events
        for each row execute function public.mp_ws2c2_fail_audit();
    `);
    let auditFail = false;
    try {
      await admin.query(
        `select public.mp_admin_update_product(
          $1,$2,$3,$4,null,null,'Updated Title',null,null,null,null
        )`,
        [ACTOR.id, ACTOR.username, ACTOR.role, created.productId],
      );
    } catch {
      auditFail = true;
    }
    const titleAfter = await admin.query(
      `select title from public.mp_products where id = $1`,
      [created.productId],
    );
    check("3. forced audit failure raises", auditFail);
    check(
      "4. product update rolled back with audit failure",
      titleAfter.rows[0].title === "Atomic Product",
    );
    await admin.query(`
      drop trigger if exists mp_ws2c2_fail_audit_trg on public.mp_audit_events;
      drop function if exists public.mp_ws2c2_fail_audit();
    `);

    // Successful update + audit together
    await admin.query(
      `select public.mp_admin_update_product(
        $1,$2,$3,$4,null,null,'Updated Title',null,null,null,true
      )`,
      [ACTOR.id, ACTOR.username, ACTOR.role, created.productId],
    );
    const updated = await admin.query(
      `select title, featured from public.mp_products where id = $1`,
      [created.productId],
    );
    const updateAudit = await admin.query(
      `select count(*)::int as n from public.mp_audit_events
       where entity_id = $1 and action = 'product.updated'`,
      [created.productId],
    );
    check("4b. product update committed", updated.rows[0].title === "Updated Title");
    check("4b. product.updated audit committed", updateAudit.rows[0].n === 1);

    // 5. Variant update + audit together
    await admin.query(
      `select public.mp_admin_update_variant(
        $1,$2,$3,$4,$5,null,'Default Renamed',null,null,null
      )`,
      [
        ACTOR.id,
        ACTOR.username,
        ACTOR.role,
        created.productId,
        created.variantId,
      ],
    );
    const vTitle = await admin.query(
      `select title from public.mp_product_variants where id = $1`,
      [created.variantId],
    );
    const vAudit = await admin.query(
      `select count(*)::int as n from public.mp_audit_events
       where entity_id = $1 and action = 'variant.updated'`,
      [created.variantId],
    );
    check("5. variant update committed", vTitle.rows[0].title === "Default Renamed");
    check("5. variant.updated audit committed", vAudit.rows[0].n === 1);

    // Add second variant for reassignment tests
    const v2 = await admin.query(
      `select public.mp_admin_create_variant(
        $1,$2,$3,$4,'SC-ATOMIC_2','Alt',false,true,true
      ) as result`,
      [ACTOR.id, ACTOR.username, ACTOR.role, created.productId],
    );
    const variant2Id = (v2.rows[0].result as { variantId: string }).variantId;
    check(
      "secondary non-default variant created",
      (await defaultCount(admin, created.productId)) === 1,
    );

    // 6. Clear/set failure preserves previous default
    await admin.query(`
      create or replace function public.mp_ws2c2_fail_default_set()
      returns trigger language plpgsql set search_path = '' as $$
      begin
        if tg_op = 'UPDATE' and new.id = current_setting('mp.ws2c2_fail_variant', true)
           and new.is_default = true then
          raise exception 'forced default set failure';
        end if;
        return new;
      end;
      $$;
      drop trigger if exists mp_ws2c2_fail_default_set_trg on public.mp_product_variants;
      create trigger mp_ws2c2_fail_default_set_trg
        before update on public.mp_product_variants
        for each row execute function public.mp_ws2c2_fail_default_set();
    `);
    await admin.query(`select set_config('mp.ws2c2_fail_variant', $1, false)`, [
      variant2Id,
    ]);
    let clearSetFail = false;
    try {
      await admin.query(
        `select public.mp_admin_update_variant(
          $1,$2,$3,$4,$5,null,null,true,null,true
        )`,
        [ACTOR.id, ACTOR.username, ACTOR.role, created.productId, variant2Id],
      );
    } catch {
      clearSetFail = true;
    }
    check("6. clear/set failure raises", clearSetFail);
    check(
      "6. previous default preserved",
      (await defaultCount(admin, created.productId)) === 1,
    );
    const stillDefault = await admin.query(
      `select id from public.mp_product_variants
       where product_id = $1 and is_default and active`,
      [created.productId],
    );
    check(
      "6. original default still active default",
      stillDefault.rows[0].id === created.variantId,
    );
    await admin.query(`
      drop trigger if exists mp_ws2c2_fail_default_set_trg on public.mp_product_variants;
      drop function if exists public.mp_ws2c2_fail_default_set();
      select set_config('mp.ws2c2_fail_variant', '', false);
    `);

    // 7-9. Concurrent default reassignments serialize; exactly one remains
    const c1 = new pg.Client({ connectionString: DB_URL });
    const c2 = new pg.Client({ connectionString: DB_URL });
    await c1.connect();
    await c2.connect();

    const runReassign = async (client: pg.Client, variantId: string) => {
      try {
        await client.query(
          `select public.mp_admin_update_variant(
            $1,$2,$3,$4,$5,null,null,true,null,true
          )`,
          [ACTOR.id, ACTOR.username, ACTOR.role, created.productId, variantId],
        );
        return "ok" as const;
      } catch {
        return "err" as const;
      }
    };

    const results = await Promise.all([
      runReassign(c1, created.variantId),
      runReassign(c2, variant2Id),
    ]);
    await c1.end();
    await c2.end();
    check(
      "7. concurrent reassignments serialize (both succeed or one conflict)",
      results.filter((r) => r === "ok").length >= 1,
    );
    check(
      "8. exactly one active default after concurrency",
      (await defaultCount(admin, created.productId)) === 1,
    );
    check(
      "9. no committed zero-default state",
      (await defaultCount(admin, created.productId)) === 1,
    );

    // 10. Partial unique index still prevents multiple active defaults
    let multiBlocked = false;
    try {
      await admin.query("begin");
      await admin.query(
        `update public.mp_product_variants set is_default = true, active = true
         where product_id = $1`,
        [created.productId],
      );
      await admin.query("commit");
    } catch {
      multiBlocked = true;
      try {
        await admin.query("rollback");
      } catch {
        /* ignore */
      }
    }
    check("10. partial unique index blocks multiple defaults", multiBlocked);
    check(
      "10b. still exactly one default after multi attempt",
      (await defaultCount(admin, created.productId)) === 1,
    );

    // 11. Deferred invariant prevents committing zero defaults via direct SQL
    let zeroBlocked = false;
    try {
      await admin.query("begin");
      await admin.query(
        `update public.mp_product_variants
         set is_default = false
         where product_id = $1 and is_default and active`,
        [created.productId],
      );
      await admin.query("commit");
    } catch (err) {
      zeroBlocked = /DEFAULT_VARIANT_REQUIRED/i.test(String((err as Error).message));
      try {
        await admin.query("rollback");
      } catch {
        /* ignore */
      }
    }
    check("11. deferred invariant blocks zero defaults", zeroBlocked);
    check(
      "11b. default restored after failed zero-default commit",
      (await defaultCount(admin, created.productId)) === 1,
    );

    // 12. Product deletion/cascade remains valid
    const doomed = await createProduct(admin, {
      brandId,
      categoryId,
      title: "Doomed",
      slug: "doomed-product",
      sku: "SC-DOOMED",
    });
    await admin.query(`delete from public.mp_products where id = $1`, [
      doomed.productId,
    ]);
    const cascaded = await admin.query(
      `select count(*)::int as n from public.mp_product_variants where product_id = $1`,
      [doomed.productId],
    );
    check("12. product delete cascades variants", cascaded.rows[0].n === 0);

    // 13. Duplicate slug/SKU map safely
    let dupSlug = false;
    try {
      await createProduct(admin, {
        brandId,
        categoryId,
        title: "Dup",
        slug: "atomic-product",
        sku: "SC-UNIQUE_X",
      });
    } catch (err) {
      dupSlug = /DUPLICATE_SLUG/i.test(String((err as Error).message));
    }
    let dupSku = false;
    try {
      await createProduct(admin, {
        brandId,
        categoryId,
        title: "DupSku",
        slug: "dup-sku-product",
        sku: "SC-ATOMIC_1",
      });
    } catch (err) {
      dupSku = /DUPLICATE_SKU/i.test(String((err as Error).message));
    }
    check("13. duplicate slug maps to DUPLICATE_SLUG", dupSlug);
    check("13. duplicate sku maps to DUPLICATE_SKU", dupSku);

    // 14. No forbidden commercial column changes through admin RPCs
    const before = await commercialSnapshot(admin, created.variantId);
    await admin.query(
      `select public.mp_admin_update_variant(
        $1,$2,$3,$4,$5,null,'Still Safe',null,null,null
      )`,
      [
        ACTOR.id,
        ACTOR.username,
        ACTOR.role,
        created.productId,
        created.variantId,
      ],
    );
    const after = await commercialSnapshot(admin, created.variantId);
    check(
      "14. website_price unchanged",
      before.website_price === after.website_price,
    );
    check(
      "14. website_price_state unchanged",
      before.website_price_state === after.website_price_state,
    );
    check(
      "14. stock_status unchanged",
      before.stock_status === after.stock_status,
    );
    check(
      "14. price_published_at unchanged",
      String(before.price_published_at) === String(after.price_published_at),
    );

    // 15. Unauthorized browser roles cannot execute admin RPCs
    await admin.query(`grant usage on schema public to anon, authenticated`);
    let anonDenied = false;
    try {
      await admin.query("begin");
      await admin.query(`set local role anon`);
      await admin.query(
        `select public.mp_admin_create_product(
          $1,$2,$3,$4,$5,'x','anon-denied','', '{}'::text[], true, false, 'SC-ANON', 'Z', true
        )`,
        [ACTOR.id, ACTOR.username, ACTOR.role, brandId, categoryId],
      );
      await admin.query("commit");
    } catch {
      anonDenied = true;
      try {
        await admin.query("rollback");
      } catch {
        /* ignore */
      }
    }
    let authDenied = false;
    try {
      await admin.query("begin");
      await admin.query(`set local role authenticated`);
      await admin.query(
        `select public.mp_admin_update_product(
          $1,$2,$3,$4,null,null,'nope',null,null,null,null
        )`,
        [ACTOR.id, ACTOR.username, ACTOR.role, created.productId],
      );
      await admin.query("commit");
    } catch {
      authDenied = true;
      try {
        await admin.query("rollback");
      } catch {
        /* ignore */
      }
    }
    check("15. anon cannot execute admin create RPC", anonDenied);
    check("15. authenticated cannot execute admin update RPC", authDenied);

    await admin.query("begin");
    await admin.query(`set local role service_role`);
    const sr = await admin.query(
      `select public.mp_admin_update_product(
        $1,$2,$3,$4,null,null,'Service Role Title',null,null,null,null
      ) as result`,
      [ACTOR.id, ACTOR.username, ACTOR.role, created.productId],
    );
    await admin.query("commit");
    check(
      "15. service_role can execute admin update RPC",
      Boolean(sr.rows[0].result),
    );

    console.log("\nWS2C2 PostgreSQL atomicity tests passed.");
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
