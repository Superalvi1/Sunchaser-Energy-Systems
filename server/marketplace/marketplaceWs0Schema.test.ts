/**
 * WS0 marketplace schema + security integration tests.
 * Spins an ephemeral Postgres 16 container, applies the migration twice,
 * and asserts constraints / RLS / RPC foundations.
 *
 * Requires Docker. Skips with a clear message if Docker is unavailable.
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
const SCHEMA_PATH = path.join(ROOT, "scripts/marketplace-ws0-foundation-schema.sql");
const IMAGE = "postgres:16-alpine";
const CONTAINER = `mp-ws0-test-${randomUUID().slice(0, 8)}`;
const PORT = 55432 + Math.floor(Math.random() * 200);
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

async function applySchema(client: pg.Client): Promise<void> {
  const sql = readFileSync(SCHEMA_PATH, "utf8");
  await client.query(sql);
}

async function seedCatalogue(client: pg.Client): Promise<{
  brandId: string;
  categoryId: string;
  productId: string;
  variantId: string;
}> {
  const brandId = "mpbrand_test1";
  const categoryId = "mpcat_test1";
  const productId = "mpprod_test1";
  const variantId = "mpvar_test1";
  await client.query(
    `insert into public.mp_brands (id, name, slug) values ($1, 'Test Brand', 'test-brand')
     on conflict do nothing`,
    [brandId],
  );
  await client.query(
    `insert into public.mp_categories (id, name, slug) values ($1, 'Test Cat', 'test-cat')
     on conflict do nothing`,
    [categoryId],
  );
  await client.query(
    `insert into public.mp_products (id, brand_id, category_id, title, slug)
     values ($1, $2, $3, 'Test Product', 'test-product')
     on conflict do nothing`,
    [productId, brandId, categoryId],
  );
  await client.query(
    `insert into public.mp_product_variants
       (id, product_id, sku, title, is_default, stock_status, website_price, website_price_state, website_price_source)
     values ($1, $2, 'SKU-TEST-1', 'Default', true, 'in_stock', 100000, 'priced_auto', 'seed')
     on conflict do nothing`,
    [variantId, productId],
  );
  // seed write bypasses price guard (insert). Good.
  return { brandId, categoryId, productId, variantId };
}

async function main(): Promise<void> {
  if (!dockerAvailable()) {
    console.error("BLOCKED: Docker unavailable — cannot run WS0 schema tests");
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

  const adminFactory = () =>
    new pg.Client({
      connectionString: DB_URL,
      connectionTimeoutMillis: 2000,
    });

  try {
    await waitForPg(adminFactory);
    const admin = adminFactory();
    await admin.connect();
    await ensureRoles(admin);

    await applySchema(admin);
    check("migration applies cleanly", true);

    await applySchema(admin);
    check("migration re-apply is safe", true);

    const tables = await admin.query<{ tablename: string }>(
      `select tablename from pg_tables
       where schemaname = 'public' and tablename like 'mp_%'
       order by 1`,
    );
    const expected = [
      "mp_audit_events",
      "mp_brands",
      "mp_cart_items",
      "mp_carts",
      "mp_categories",
      "mp_delivery_rates",
      "mp_delivery_zones",
      "mp_idempotency_keys",
      "mp_job_runs",
      "mp_media",
      "mp_order_items",
      "mp_orders",
      "mp_payment_plans",
      "mp_payments",
      "mp_price_alerts",
      "mp_price_history",
      "mp_price_overrides",
      "mp_pricing_config",
      "mp_product_costs",
      "mp_product_variants",
      "mp_products",
      "mp_receipt_objects",
      "mp_receipts",
      "mp_storage_cleanup_outbox",
      "mp_supplier_observations",
      "mp_supplier_products",
      "mp_suppliers",
      "mp_upload_intents",
    ];
    for (const t of expected) {
      check(`table ${t} exists`, tables.rows.some((r) => r.tablename === t));
    }

    const rls = await admin.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname like 'mp_%' and c.relkind = 'r'`,
    );
    for (const row of rls.rows) {
      check(`RLS enabled on ${row.relname}`, row.relrowsecurity === true);
      check(`FORCE RLS on ${row.relname}`, row.relforcerowsecurity === true);
    }

    const fns = await admin.query<{ proname: string }>(
      `select proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and proname like 'mp_%'
       order by 1`,
    );
    for (const name of [
      "mp_idempotency_preflight",
      "mp_create_upload_intent",
      "mp_checkout",
      "mp_record_payment",
      "mp_verify_payment",
      "mp_collect_cod_payment",
      "mp_cancel_cod_payment",
      "mp_refund_payment",
      "mp_publish_price",
      "mp_apply_override",
      "mp_revoke_override",
      "mp_set_cost",
      "mp_correct_order_totals",
      "mp_reconcile_stale_claimed_intent",
    ]) {
      check(`RPC ${name} exists`, fns.rows.some((r) => r.proname === name));
    }

    // Privilege: anon cannot select confidential tables
    await admin.query("grant usage on schema public to anon, authenticated, service_role");
    const anon = new pg.Client({ connectionString: DB_URL });
    await anon.connect();
    await anon.query("set role anon");
    let anonBlocked = false;
    try {
      await anon.query("select * from public.mp_product_costs");
    } catch {
      anonBlocked = true;
    }
    check("anon cannot read mp_product_costs", anonBlocked);
    await anon.query("reset role");
    await anon.end();

    const auth = new pg.Client({ connectionString: DB_URL });
    await auth.connect();
    await auth.query("set role authenticated");
    let authBlocked = false;
    try {
      await auth.query("select * from public.mp_audit_events");
    } catch {
      authBlocked = true;
    }
    check("authenticated cannot read mp_audit_events", authBlocked);
    await auth.query("reset role");
    await auth.end();

    // service_role has DML
    await admin.query("set role service_role");
    const svcCount = await admin.query("select count(*)::int as n from public.mp_suppliers");
    check("service_role can select mp_suppliers", svcCount.rows[0].n >= 2);
    await admin.query("reset role");

    const ids = await seedCatalogue(admin);
    check("default stock_status unknown on fresh insert path", true);
    const unknownStock = await admin.query(
      `insert into public.mp_product_variants (id, product_id, sku, title)
       values ('mpvar_unk', $1, 'SKU-UNK', 'Unk') returning stock_status`,
      [ids.productId],
    );
    check(
      "new variant defaults stock unknown",
      unknownStock.rows[0].stock_status === "unknown",
    );

    // Append-only audit
    await admin.query(
      `insert into public.mp_audit_events (id, actor_scope, action, entity_type, is_financial, payload)
       values ('mpaud_t1', 'system:test', 'ping', 'test', true, '{"ok":true}'::jsonb)`,
    );
    let auditUpdateBlocked = false;
    try {
      await admin.query(`update public.mp_audit_events set action = 'x' where id = 'mpaud_t1'`);
    } catch {
      auditUpdateBlocked = true;
    }
    check("audit events reject UPDATE", auditUpdateBlocked);

    // Price guard
    let priceGuard = false;
    try {
      await admin.query(
        `update public.mp_product_variants set website_price = 1 where id = $1`,
        [ids.variantId],
      );
    } catch {
      priceGuard = true;
    }
    check("variant price columns RPC-guarded", priceGuard);

    // Composite mismatch on cart items
    let compositeReject = false;
    try {
      await admin.query(
        `insert into public.mp_carts (id, public_ref, guest_token_hash, expires_at)
         values ('mpcart_1', 'cref1', 'hash', timezone('utc', now()) + interval '1 day')`,
      );
      await admin.query(
        `insert into public.mp_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_snap)
         values ('mpci_1', 'mpcart_1', 'mpprod_missing', $1, 1, 100)`,
        [ids.variantId],
      );
    } catch {
      compositeReject = true;
    }
    check("composite variant/product FK rejects mismatch", compositeReject);

    // Idempotency + upload intent binding
    const pre = await admin.query(
      `select public.mp_idempotency_preflight($1,$2,$3,$4,$5) as r`,
      ["idem-1", "bank_transfer_receipt", "guest:abc", "hash-1", "ref-1"],
    );
    check(
      "idempotency NEW_REQUEST",
      pre.rows[0].r.status === "NEW_REQUEST",
    );

    let badIntent = false;
    try {
      await admin.query(
        `insert into public.mp_upload_intents
           (id, operation_type, actor_scope, order_id, idempotency_key, request_hash, storage_path)
         values ('mpui_bad', 'bank_transfer_receipt', 'guest:abc', 'no-order', 'idem-1', 'wrong-hash', 'mp-receipts/aa/bb')`,
      );
    } catch {
      badIntent = true;
    }
    check("upload intent must match idempotency claim", badIntent);

    // Checkout + receipt path integrity
    const checkout = await admin.query(
      `select public.mp_checkout(
         'guest:abc', 'oref1', 'ORD-1', null, 'ghash',
         100000, 500, 0, null, 'full', 100500, 0, false,
         $1::jsonb
       ) as r`,
      [
        JSON.stringify([
          {
            product_id: ids.productId,
            variant_id: ids.variantId,
            quantity: 1,
          },
        ]),
      ],
    );
    check("checkout ok", checkout.rows[0].r.ok === true);
    const orderId = checkout.rows[0].r.order_id as string;

    const intent = await admin.query(
      `select public.mp_create_upload_intent($1,$2,$3,$4,$5) as r`,
      [orderId, "bank_transfer_receipt", "guest:abc", "idem-1", "hash-1"],
    );
    check("create upload intent ok", intent.rows[0].r.ok === true);
    const intentId = intent.rows[0].r.upload_intent_id as string;
    const storagePath = intent.rows[0].r.storage_path as string;
    check("storage path uses mp-receipts prefix", storagePath.startsWith("mp-receipts/"));
    check("storage path excludes raw idempotency key", !storagePath.includes("idem-1"));

    await admin.query(`select public.mp_mark_upload_intent_uploaded($1, 12, $2)`, [
      intentId,
      "a".repeat(64),
    ]);

    const recorded = await admin.query(
      `select public.mp_record_payment(
         'guest:abc', $1, $2, 100500, $3, 12, 'idem-1', 'hash-1'
       ) as r`,
      [orderId, intentId, "b".repeat(64)],
    );
    check("record payment ok", recorded.rows[0].r.ok === true);

    // Receipt UPDATE blocked
    let receiptUpdateBlocked = false;
    try {
      await admin.query(`update public.mp_receipts set order_id = order_id`);
    } catch {
      receiptUpdateBlocked = true;
    }
    check("mp_receipts rejects UPDATE", receiptUpdateBlocked);

    // Receipt DELETE while payment exists blocked
    let receiptDeleteBlocked = false;
    try {
      await admin.query(`delete from public.mp_receipts`);
    } catch {
      receiptDeleteBlocked = true;
    }
    check("mp_receipts rejects DELETE while payment exists", receiptDeleteBlocked);

    // Stale claimed reconciliation
    await admin.query(
      `select public.mp_idempotency_preflight($1,$2,$3,$4,$5)`,
      ["idem-2", "bank_transfer_receipt", "guest:abc", "hash-2", orderId],
    );
    const intent2 = await admin.query(
      `select public.mp_create_upload_intent($1,$2,$3,$4,$5) as r`,
      [orderId, "bank_transfer_receipt", "guest:abc", "idem-2", "hash-2"],
    );
    // unique (idempotency_key, operation_type, actor_scope) — second intent for same actor/op needs new key - good
    // But order may already be awaiting_verification; create_upload_intent only needs order lock.
    // Wait - unique on upload intents is (idempotency_key, operation_type, actor_scope) - different key ok.
    // However create_upload_intent for same order is fine.
    const intent2Id = intent2.rows[0].r.upload_intent_id as string;

    const abandoned = await admin.query(
      `select public.mp_reconcile_stale_claimed_intent($1, false) as r`,
      [intent2Id],
    );
    check("stale claimed + no object → abandoned", abandoned.rows[0].r.status === "abandoned");

    await admin.query(
      `select public.mp_idempotency_preflight($1,$2,$3,$4,$5)`,
      ["idem-3", "bank_transfer_receipt", "guest:xyz", "hash-3", orderId],
    );
    // Need another order for another intent with claimed status - use same order
    const intent3 = await admin.query(
      `select public.mp_create_upload_intent($1,$2,$3,$4,$5) as r`,
      [orderId, "bank_transfer_receipt", "guest:xyz", "idem-3", "hash-3"],
    );
    const cleanup = await admin.query(
      `select public.mp_reconcile_stale_claimed_intent($1, true) as r`,
      [intent3.rows[0].r.upload_intent_id],
    );
    check(
      "stale claimed + object present → cleanup_pending",
      cleanup.rows[0].r.status === "cleanup_pending",
    );
    const outbox = await admin.query(
      `select count(*)::int as n from public.mp_storage_cleanup_outbox
       where reason = 'stale_claimed_object_present'`,
    );
    check("cleanup outbox row created", outbox.rows[0].n >= 1);

    // Payment plan ownership: mismatched plan/order rejected
    let planOwn = false;
    try {
      await admin.query(
        `insert into public.mp_payments
           (id, order_id, payment_plan_id, amount, method, status)
         values ('mppay_bad', $1, 'no-such-plan', 10, 'bank_transfer', 'pending')`,
        [orderId],
      );
    } catch {
      planOwn = true;
    }
    check("payment plan ownership FK rejects mismatch", planOwn);

    // Publish ignores sold_out
    await admin.query(
      `insert into public.mp_supplier_products (
         id, supplier_id, product_id, variant_id, supplier_product_id,
         normalized_exact_model, match_confidence, match_evidence
       ) values (
         'mpsp_1', 'mpsup_kamal', $1, $2, 'sup-1', 'MODEL-X', 'exact', '{}'::jsonb
       )`,
      [ids.productId, ids.variantId],
    );
    await admin.query(
      `insert into public.mp_supplier_observations (
         id, supplier_product_id, supplier_public_price, availability, parse_status
       ) values ('mpso_1', 'mpsp_1', 999, 'sold_out', 'ok')`,
    );
    // reset variant to confirm_price via RPC revoke path — use publish
    const pub = await admin.query(
      `select public.mp_publish_price('admin:super:test', $1, 'tester') as r`,
      [ids.variantId],
    );
    // After sold_out-only obs, publish should fall back (seed history or confirm).
    // We inserted seed price history? publish writes history. Prior state was priced_auto seed.
    // last-approved may keep price. Insert another variant for cleaner test.
    await admin.query(
      `insert into public.mp_product_variants (id, product_id, sku, title, stock_status)
       values ('mpvar_pub', $1, 'SKU-PUB', 'Pub', 'unknown')`,
      [ids.productId],
    );
    await admin.query(
      `insert into public.mp_supplier_products (
         id, supplier_id, product_id, variant_id, supplier_product_id,
         normalized_exact_model, match_confidence
       ) values (
         'mpsp_2', 'mpsup_kamal', $1, 'mpvar_pub', 'sup-2', 'MODEL-Y', 'exact'
       )`,
      [ids.productId],
    );
    await admin.query(
      `insert into public.mp_supplier_observations (
         id, supplier_product_id, supplier_public_price, availability, parse_status
       ) values
         ('mpso_2', 'mpsp_2', 500, 'sold_out', 'ok'),
         ('mpso_3', 'mpsp_2', 600, 'backorder', 'ok'),
         ('mpso_4', 'mpsp_2', 700, 'unknown', 'ok')`,
    );
    const pub2 = await admin.query(
      `select public.mp_publish_price('admin:super:test', 'mpvar_pub', 'tester') as r`,
    );
    check(
      "sold_out/backorder/unknown observations do not publish",
      pub2.rows[0].r.website_price_state === "confirm_price" &&
        pub2.rows[0].r.website_price === null,
    );

    // in_stock publishes
    await admin.query(
      `insert into public.mp_supplier_observations (
         id, supplier_product_id, supplier_public_price, availability, parse_status
       ) values ('mpso_5', 'mpsp_2', 88000, 'in_stock', 'ok')`,
    );
    const pub3 = await admin.query(
      `select public.mp_publish_price('admin:super:test', 'mpvar_pub', 'tester') as r`,
    );
    check(
      "exact in_stock observation publishes",
      pub3.rows[0].r.website_price_state === "priced_auto" &&
        Number(pub3.rows[0].r.website_price) === 88000 &&
        pub3.rows[0].r.website_price_source === "kamal",
    );

    // search_path hardening
    const sp = await admin.query<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select prosecdef, proconfig from pg_proc
       where proname = 'mp_idempotency_preflight'`,
    );
    check("idempotency RPC is SECURITY DEFINER", sp.rows[0].prosecdef === true);
    check(
      "idempotency RPC fixed search_path",
      (sp.rows[0].proconfig ?? []).some((c) => c === "search_path=\"\""),
    );

    void pub;
    await admin.end();
    console.log("marketplaceWs0Schema.test.ts: all checks passed");
  } finally {
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
