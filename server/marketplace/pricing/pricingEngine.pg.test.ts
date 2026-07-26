/**
 * WS3 PostgreSQL-backed pricing engine tests (disposable Docker Postgres only).
 * Run: npm run test:marketplace-ws3
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
const WS3 = path.join(ROOT, "scripts/marketplace-ws3-pricing-engine.sql");
const IMAGE = "postgres:16-alpine";
const CONTAINER = `mp-ws3-test-${randomUUID().slice(0, 8)}`;
const PORT = 55700 + Math.floor(Math.random() * 200);
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
    const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
    try {
      await c.connect();
      await c.query("select 1");
      await c.end();
      return;
    } catch (err) {
      last = err;
      try { await c.end(); } catch { /* */ }
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

async function seedCatalogue(client: pg.Client) {
  await client.query(`
    insert into public.mp_brands (id, name, slug) values ('mpbrand_ws3', 'WS3', 'ws3') on conflict do nothing;
    insert into public.mp_categories (id, name, slug) values ('mpcat_ws3', 'WS3 Cat', 'ws3-cat') on conflict do nothing;
    insert into public.mp_products (id, brand_id, category_id, title, slug)
      values ('mpprod_ws3', 'mpbrand_ws3', 'mpcat_ws3', 'WS3 Product', 'ws3-product')
      on conflict do nothing;
    insert into public.mp_product_variants (id, product_id, sku, title, is_default, active)
      values ('mpvar_ws3', 'mpprod_ws3', 'SC-WS3', 'Default', true, true)
      on conflict do nothing;
  `);
}

async function main(): Promise<void> {
  if (!dockerAvailable()) {
    console.error("WS3 BLOCKED: Docker unavailable");
    process.exit(2);
  }
  console.log(`Starting ${IMAGE} as ${CONTAINER} on :${PORT}`);
  execFileSync("docker", [
    "run", "-d", "--rm", "--name", CONTAINER,
    "-e", "POSTGRES_PASSWORD=postgres", "-p", `${PORT}:5432`, IMAGE,
  ], { stdio: "inherit" });

  const admin = new pg.Client({ connectionString: DB_URL });
  try {
    await waitForPg();
    await admin.connect();
    await ensureRoles(admin);
    await apply(admin, WS0);
    await apply(admin, WS1);
    await apply(admin, WS3);
    await apply(admin, WS3);
    await seedCatalogue(admin);

    // 1. Super Admin can manage costs
    const cost = await admin.query(
      `select public.mp_set_cost($1,'mpprod_ws3','mpvar_ws3',50000,'u-sa','initial') as r`,
      [SCOPE],
    );
    check("1. cost created", Boolean(cost.rows[0].r.costId || cost.rows[0].r.cost_id));
    const costId = cost.rows[0].r.costId || cost.rows[0].r.cost_id;

    // Audit must not contain cost value
    const costAudit = await admin.query(
      `select payload::text as p from public.mp_audit_events where entity_id = $1`,
      [costId],
    );
    check(
      "18a. cost audit omits purchase cost value",
      !String(costAudit.rows[0]?.p || "").includes("50000"),
    );

    // 3. Browser roles cannot execute privileged RPCs
    await admin.query("grant usage on schema public to anon, authenticated");
    let anonDenied = false;
    try {
      await admin.query("begin");
      await admin.query("set local role anon");
      await admin.query(
        `select public.mp_publish_price($1,'mpvar_ws3','x')`,
        [SCOPE],
      );
      await admin.query("commit");
    } catch {
      anonDenied = true;
      try { await admin.query("rollback"); } catch { /* */ }
    }
    check("3. anon cannot execute publish RPC", anonDenied);

    // 5. Active override wins
    await admin.query(
      `select public.mp_apply_override($1,'mpprod_ws3','mpvar_ws3',111000,'permanent',null,'manual','u-sa')`,
      [SCOPE],
    );
    let pub = await admin.query(
      `select public.mp_publish_price($1,'mpvar_ws3','u-sa') as r`,
      [SCOPE],
    );
    check(
      "5. active override wins",
      pub.rows[0].r.website_price_state === "priced_override" &&
        Number(pub.rows[0].r.website_price) === 111000,
    );

    // Revoke for supplier tests
    const ovr = await admin.query(
      `select id from public.mp_price_overrides where variant_id='mpvar_ws3' and status='active' limit 1`,
    );
    await admin.query(
      `select public.mp_revoke_override($1,$2,'u-sa')`,
      [SCOPE, ovr.rows[0].id],
    );

    // Insert Kamal + Alladin mappings/observations
    await admin.query(`
      insert into public.mp_supplier_products (
        id, supplier_id, product_id, variant_id, supplier_product_id,
        normalized_exact_model, match_confidence, match_locked, active
      ) values
        ('mpsp_k','mpsup_kamal','mpprod_ws3','mpvar_ws3','k1','MODEL','exact',false,true),
        ('mpsp_a','mpsup_alladin','mpprod_ws3','mpvar_ws3','a1','MODEL','exact',false,true)
      on conflict do nothing;
    `);

    // Clear history noise for cleaner precedence: use a fresh variant
    await admin.query(`
      insert into public.mp_product_variants (id, product_id, sku, title, is_default, active)
      values ('mpvar_prec','mpprod_ws3','SC-PREC','Prec',false,true);
    `);

    // 6. Valid fresh Kamal is second priority (no override)
    await admin.query(`
      insert into public.mp_supplier_products (
        id, supplier_id, product_id, variant_id, supplier_product_id,
        normalized_exact_model, match_confidence, match_locked, active
      ) values
        ('mpsp_pk','mpsup_kamal','mpprod_ws3','mpvar_prec','k-p','MODEL-P','exact',false,true),
        ('mpsp_pa','mpsup_alladin','mpprod_ws3','mpvar_prec','a-p','MODEL-P','exact',false,true);
      insert into public.mp_supplier_observations (id, supplier_product_id, supplier_public_price, availability, parse_status)
      values
        ('mpso_k','mpsp_pk',90000,'in_stock','ok'),
        ('mpso_a','mpsp_pa',80000,'in_stock','ok');
    `);
    pub = await admin.query(
      `select public.mp_publish_price($1,'mpvar_prec','u-sa') as r`,
      [SCOPE],
    );
    check(
      "6. fresh Kamal mapping second priority",
      pub.rows[0].r.website_price_source === "kamal" &&
        Number(pub.rows[0].r.website_price) === 90000,
    );

    // 7. Alladin when Kamal ineligible
    await admin.query(`
      insert into public.mp_product_variants (id, product_id, sku, title, is_default, active)
      values ('mpvar_al','mpprod_ws3','SC-AL','Al',false,true);
      insert into public.mp_supplier_products (
        id, supplier_id, product_id, variant_id, supplier_product_id,
        normalized_exact_model, match_confidence, match_locked, active
      ) values
        ('mpsp_alk','mpsup_kamal','mpprod_ws3','mpvar_al','k-al','M','exact',false,true),
        ('mpsp_ala','mpsup_alladin','mpprod_ws3','mpvar_al','a-al','M','exact',false,true);
      insert into public.mp_supplier_observations (id, supplier_product_id, supplier_public_price, availability, parse_status, observed_at)
      values
        ('mpso_alk','mpsp_alk',70000,'sold_out','ok', timezone('utc', now())),
        ('mpso_ala','mpsp_ala',75000,'in_stock','ok', timezone('utc', now()));
    `);
    pub = await admin.query(
      `select public.mp_publish_price($1,'mpvar_al','u-sa') as r`,
      [SCOPE],
    );
    check(
      "7. Alladin third when Kamal ineligible",
      pub.rows[0].r.website_price_source === "alladin" &&
        Number(pub.rows[0].r.website_price) === 75000,
    );

    // 8. History fallback
    await admin.query(`
      insert into public.mp_product_variants (id, product_id, sku, title, is_default, active)
      values ('mpvar_hist','mpprod_ws3','SC-HIST','Hist',false,true);
      insert into public.mp_price_history (
        id, product_id, variant_id, old_price, new_price, old_state, new_state, source, changed_by
      ) values (
        'mphist_ws3','mpprod_ws3','mpvar_hist',null,66000,'confirm_price','priced_auto','seed','seed'
      );
    `);
    pub = await admin.query(
      `select public.mp_publish_price($1,'mpvar_hist','u-sa') as r`,
      [SCOPE],
    );
    check(
      "8. approved history fallback",
      pub.rows[0].r.website_price_source === "last_approved" &&
        Number(pub.rows[0].r.website_price) === 66000,
    );

    // 9. Missing eligible → confirm_price
    await admin.query(`
      insert into public.mp_product_variants (id, product_id, sku, title, is_default, active)
      values ('mpvar_empty','mpprod_ws3','SC-EMPTY','Empty',false,true);
    `);
    pub = await admin.query(
      `select public.mp_publish_price($1,'mpvar_empty','u-sa') as r`,
      [SCOPE],
    );
    check(
      "9. missing source → confirm_price",
      pub.rows[0].r.website_price_state === "confirm_price" &&
        pub.rows[0].r.website_price === null,
    );

    // 10-13. Ineligible observations
    const cases: Array<[string, string, string, number | null, string]> = [
      ["sold", "sold_out", "ok", 1000, "10. sold_out cannot publish"],
      ["back", "backorder", "ok", 1000, "10. backorder cannot publish"],
      ["unk", "unknown", "ok", 1000, "10. unknown cannot publish"],
      ["bad", "in_stock", "malformed", 1000, "11. parse-failed cannot publish"],
      ["zero", "in_stock", "ok", 0, "12. zero price cannot publish"],
      ["neg", "in_stock", "ok", -5, "12. negative price cannot publish"],
    ];
    for (const [suffix, avail, parse, price, label] of cases) {
      const vid = `mpvar_${suffix}`;
      const spid = `mpsp_${suffix}`;
      await admin.query(
        `insert into public.mp_product_variants (id, product_id, sku, title, is_default, active)
         values ($1,'mpprod_ws3',$2,$2,false,true)`,
        [vid, `SC-${suffix.toUpperCase()}`],
      );
      await admin.query(
        `insert into public.mp_supplier_products (
           id, supplier_id, product_id, variant_id, supplier_product_id,
           normalized_exact_model, match_confidence, match_locked, active
         ) values ($1,'mpsup_kamal','mpprod_ws3',$2,$3,'M','exact',false,true)`,
        [spid, vid, `sup-${suffix}`],
      );
      await admin.query(
        `insert into public.mp_supplier_observations (
           id, supplier_product_id, supplier_public_price, availability, parse_status
         ) values ($1,$2,$3,$4,$5)`,
        [`mpso_${suffix}`, spid, price, avail, parse],
      );
      const r = await admin.query(
        `select public.mp_publish_price($1,$2,'u-sa') as r`,
        [SCOPE, vid],
      );
      check(label, r.rows[0].r.website_price_state === "confirm_price");
    }

    // Ambiguous mapping
    await admin.query(`
      insert into public.mp_product_variants (id, product_id, sku, title, is_default, active)
      values ('mpvar_amb','mpprod_ws3','SC-AMB','Amb',false,true);
      insert into public.mp_supplier_products (
        id, supplier_id, product_id, variant_id, supplier_product_id,
        normalized_exact_model, match_confidence, match_locked, active
      ) values (
        'mpsp_amb','mpsup_kamal','mpprod_ws3','mpvar_amb','amb','M','likely',false,true
      );
      insert into public.mp_supplier_observations (id, supplier_product_id, supplier_public_price, availability, parse_status)
      values ('mpso_amb','mpsp_amb',120000,'in_stock','ok');
    `);
    pub = await admin.query(
      `select public.mp_publish_price($1,'mpvar_amb','u-sa') as r`,
      [SCOPE],
    );
    check("13. non-exact mapping cannot publish", pub.rows[0].r.website_price_state === "confirm_price");

    // Locked mapping
    await admin.query(`update public.mp_supplier_products set match_confidence='exact', match_locked=true where id='mpsp_amb'`);
    pub = await admin.query(
      `select public.mp_publish_price($1,'mpvar_amb','u-sa') as r`,
      [SCOPE],
    );
    check("13b. locked mapping cannot publish", pub.rows[0].r.website_price_state === "confirm_price");

    // 14. Atomic publish updates variant + history + audit
    await admin.query(`
      insert into public.mp_supplier_observations (id, supplier_product_id, supplier_public_price, availability, parse_status)
      values ('mpso_amb2','mpsp_amb',130000,'in_stock','ok');
      update public.mp_supplier_products set match_locked=false where id='mpsp_amb';
    `);
    // still likely? set exact
    await admin.query(`update public.mp_supplier_products set match_confidence='exact' where id='mpsp_amb'`);
    const beforeHist = await admin.query(
      `select count(*)::int as n from public.mp_price_history where variant_id='mpvar_amb'`,
    );
    pub = await admin.query(
      `select public.mp_publish_price($1,'mpvar_amb','u-sa') as r`,
      [SCOPE],
    );
    const afterHist = await admin.query(
      `select count(*)::int as n from public.mp_price_history where variant_id='mpvar_amb'`,
    );
    const audits = await admin.query(
      `select action, payload::text as p from public.mp_audit_events
       where entity_id='mpvar_amb' and action in ('pricing.published','pricing.confirm_required')
       order by created_at desc limit 1`,
    );
    check("14. publish sets priced_auto", pub.rows[0].r.website_price_state === "priced_auto");
    check("14. history appended", afterHist.rows[0].n === beforeHist.rows[0].n + 1);
    check("14. audit written", audits.rows.length === 1);
    check(
      "18b. publish audit omits raw price amount",
      !String(audits.rows[0].p).includes("130000"),
    );

    // 15. Forced audit failure rolls back website_price
    const priceBefore = await admin.query(
      `select website_price, website_price_state from public.mp_product_variants where id='mpvar_amb'`,
    );
    await admin.query(`
      create or replace function public.mp_ws3_fail_audit()
      returns trigger language plpgsql set search_path='' as $$
      begin
        if new.action in ('pricing.published','pricing.confirm_required') then
          raise exception 'forced audit failure';
        end if;
        return new;
      end; $$;
      drop trigger if exists mp_ws3_fail_audit_trg on public.mp_audit_events;
      create trigger mp_ws3_fail_audit_trg
        before insert on public.mp_audit_events
        for each row execute function public.mp_ws3_fail_audit();
    `);
    let failed = false;
    try {
      await admin.query(`select public.mp_publish_price($1,'mpvar_amb','u-sa')`, [SCOPE]);
    } catch {
      failed = true;
    }
    const priceAfter = await admin.query(
      `select website_price, website_price_state from public.mp_product_variants where id='mpvar_amb'`,
    );
    check("15. forced audit failure raises", failed);
    check(
      "15. website_price rolled back",
      String(priceAfter.rows[0].website_price) === String(priceBefore.rows[0].website_price) &&
        priceAfter.rows[0].website_price_state === priceBefore.rows[0].website_price_state,
    );
    await admin.query(`
      drop trigger if exists mp_ws3_fail_audit_trg on public.mp_audit_events;
      drop function if exists public.mp_ws3_fail_audit();
    `);

    // 16. Concurrent publish serialize
    const c1 = new pg.Client({ connectionString: DB_URL });
    const c2 = new pg.Client({ connectionString: DB_URL });
    await c1.connect();
    await c2.connect();
    const results = await Promise.all([
      c1.query(`select public.mp_publish_price($1,'mpvar_prec','u-sa') as r`, [SCOPE]).then(() => "ok").catch(() => "err"),
      c2.query(`select public.mp_publish_price($1,'mpvar_prec','u-sa') as r`, [SCOPE]).then(() => "ok").catch(() => "err"),
    ]);
    await c1.end();
    await c2.end();
    check("16. concurrent publish completed", results.includes("ok"));
    const dflt = await admin.query(
      `select website_price_state from public.mp_product_variants where id='mpvar_prec'`,
    );
    check("16b. variant state consistent", Boolean(dflt.rows[0].website_price_state));

    // 17. Revoked/expired overrides do not resolve
    await admin.query(
      `select public.mp_apply_override($1,'mpprod_ws3','mpvar_empty',99000,'time_limited', timezone('utc', now()) + interval '1 hour','temp','u-sa')`,
      [SCOPE],
    );
    const activeOvr = await admin.query(
      `select id from public.mp_price_overrides where variant_id='mpvar_empty' and status='active'`,
    );
    await admin.query(
      `select public.mp_revoke_override($1,$2,'u-sa')`,
      [SCOPE, activeOvr.rows[0].id],
    );
    pub = await admin.query(
      `select public.mp_publish_price($1,'mpvar_empty','u-sa') as r`,
      [SCOPE],
    );
    check(
      "17. revoked override does not resolve",
      pub.rows[0].r.website_price_state === "confirm_price",
    );

    // 19. Direct commercial column update blocked without allow flag
    let blocked = false;
    try {
      await admin.query(
        `update public.mp_product_variants set website_price = 1 where id='mpvar_empty'`,
      );
    } catch {
      blocked = true;
    }
    check("19. direct website_price update blocked", blocked);

    // Config + mapping RPCs
    await admin.query(
      `select public.mp_admin_update_pricing_config(
        $1,'u-sa', null,null,48,null,null,null,null,null,null,null,null
      )`,
      [SCOPE],
    );
    const cfg = await admin.query(
      `select staleness_hours from public.mp_pricing_config where company_id='sunchaser'`,
    );
    check("config patch works", Number(cfg.rows[0].staleness_hours) === 48);

    const map = await admin.query(
      `select public.mp_admin_upsert_supplier_mapping(
        $1,'kamal','mpprod_ws3','mpvar_empty','sup-new',null,null,'MODEL-NEW','exact',false,true,null
      ) as r`,
      [SCOPE],
    );
    check("mapping upsert works", Boolean(map.rows[0].r.mappingId));

    // service_role can execute
    await admin.query("begin");
    await admin.query("set local role service_role");
    const sr = await admin.query(
      `select public.mp_publish_price($1,'mpvar_empty','u-sa') as r`,
      [SCOPE],
    );
    await admin.query("commit");
    check("3b. service_role can publish", Boolean(sr.rows[0].r));

    // Stale observation
    await admin.query(`
      insert into public.mp_product_variants (id, product_id, sku, title, is_default, active)
      values ('mpvar_stale','mpprod_ws3','SC-STALE','Stale',false,true);
      insert into public.mp_supplier_products (
        id, supplier_id, product_id, variant_id, supplier_product_id,
        normalized_exact_model, match_confidence, match_locked, active
      ) values (
        'mpsp_stale','mpsup_kamal','mpprod_ws3','mpvar_stale','stale','M','exact',false,true
      );
      insert into public.mp_supplier_observations (
        id, supplier_product_id, supplier_public_price, availability, parse_status, observed_at
      ) values (
        'mpso_stale','mpsp_stale',50000,'in_stock','ok', timezone('utc', now()) - interval '100 hours'
      );
    `);
    pub = await admin.query(
      `select public.mp_publish_price($1,'mpvar_stale','u-sa') as r`,
      [SCOPE],
    );
    check("11. stale observation cannot publish", pub.rows[0].r.website_price_state === "confirm_price");

    console.log("\nWS3 PostgreSQL pricing engine tests passed.");
  } finally {
    try { await admin.end(); } catch { /* */ }
    try { execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" }); } catch { /* */ }
  }
}

main().catch((err) => {
  console.error(err);
  try { execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" }); } catch { /* */ }
  process.exit(1);
});
