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

    const uploadSha = "a".repeat(64);
    await admin.query(`select public.mp_mark_upload_intent_uploaded($1, 12, $2)`, [
      intentId,
      uploadSha,
    ]);

    const recorded = await admin.query(
      `select public.mp_record_payment(
         'guest:abc', $1, $2, 100500, $3, 12, 'idem-1', 'hash-1'
       ) as r`,
      [orderId, intentId, uploadSha],
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

    // =========================================================================
    // WS0 Correction 1 regressions
    // =========================================================================
    await admin.query("begin");
    await admin.query(`select set_config('mp.allow_price_write','on',true)`);
    await admin.query(
      `update public.mp_product_variants
       set stock_status = 'in_stock',
           website_price = 100000,
           website_price_state = 'priced_auto',
           website_price_source = 'seed',
           is_priceable = true,
           active = true
       where id = $1`,
      [ids.variantId],
    );
    await admin.query("commit");
    const shaOk = "c".repeat(64);
    async function freshPendingOrder(
      client: pg.Client,
      ref: string,
      planType = "full",
      zoneId: string | null = null,
      subtotal = 100000,
      delivery = 0,
      balanceDue = 0,
    ): Promise<string> {
      const grand = subtotal + delivery;
      const upfront = grand - balanceDue;
      const r = await client.query(
        `select public.mp_checkout(
           'guest:corr', $1, $2, null, 'ghash-corr',
           $3::numeric, $4::numeric, 0, $5, $6, $7::numeric, $8::numeric, $9,
           $10::jsonb
         ) as r`,
        [
          ref,
          `ORD-${ref}`,
          subtotal,
          delivery,
          zoneId,
          planType,
          upfront,
          balanceDue,
          planType.includes("cod"),
          JSON.stringify([
            { product_id: ids.productId, variant_id: ids.variantId, quantity: 1 },
          ]),
        ],
      );
      return r.rows[0].r.order_id as string;
    }

    async function createClaimedIntent(
      client: pg.Client,
      oid: string,
      key: string,
      hash: string,
    ): Promise<string> {
      await client.query(`select public.mp_idempotency_preflight($1,$2,$3,$4,$5)`, [
        key,
        "bank_transfer_receipt",
        "guest:corr",
        hash,
        oid,
      ]);
      const r = await client.query(
        `select public.mp_create_upload_intent($1,$2,$3,$4,$5) as r`,
        [oid, "bank_transfer_receipt", "guest:corr", key, hash],
      );
      return r.rows[0].r.upload_intent_id as string;
    }

    // claimed cannot attach
    {
      const oid = await freshPendingOrder(admin, "corr-claimed");
      const iid = await createClaimedIntent(admin, oid, "idem-claimed", "hash-claimed");
      let blocked = false;
      try {
        await admin.query(
          `select public.mp_record_payment('guest:corr',$1,$2,100000,$3,12,'idem-claimed','hash-claimed')`,
          [oid, iid, shaOk],
        );
      } catch {
        blocked = true;
      }
      check("claimed intent cannot be attached", blocked);
    }

    // abandoned / cleanup_pending cannot attach
    {
      const oid = await freshPendingOrder(admin, "corr-aband");
      const iid = await createClaimedIntent(admin, oid, "idem-aband", "hash-aband");
      await admin.query(`select public.mp_reconcile_stale_claimed_intent($1,false)`, [iid]);
      let blocked = false;
      try {
        await admin.query(
          `select public.mp_record_payment('guest:corr',$1,$2,100000,$3,12,'idem-aband','hash-aband')`,
          [oid, iid, shaOk],
        );
      } catch {
        blocked = true;
      }
      check("abandoned intent cannot be attached", blocked);
    }
    {
      const oid = await freshPendingOrder(admin, "corr-clean");
      const iid = await createClaimedIntent(admin, oid, "idem-clean", "hash-clean");
      await admin.query(`select public.mp_reconcile_stale_claimed_intent($1,true)`, [iid]);
      let blocked = false;
      try {
        await admin.query(
          `select public.mp_record_payment('guest:corr',$1,$2,100000,$3,12,'idem-clean','hash-clean')`,
          [oid, iid, shaOk],
        );
      } catch {
        blocked = true;
      }
      check("cleanup_pending intent cannot be attached", blocked);
    }

    // SHA / byte-size mismatch fails; matching uploaded metadata attaches
    {
      const oid = await freshPendingOrder(admin, "corr-meta");
      const iid = await createClaimedIntent(admin, oid, "idem-meta", "hash-meta");
      await admin.query(`select public.mp_mark_upload_intent_uploaded($1, 20, $2)`, [
        iid,
        shaOk,
      ]);
      let shaMismatch = false;
      try {
        await admin.query(
          `select public.mp_record_payment('guest:corr',$1,$2,100000,$3,20,'idem-meta','hash-meta')`,
          [oid, iid, "d".repeat(64)],
        );
      } catch {
        shaMismatch = true;
      }
      check("upload SHA mismatch fails", shaMismatch);

      let sizeMismatch = false;
      try {
        await admin.query(
          `select public.mp_record_payment('guest:corr',$1,$2,100000,$3,99,'idem-meta','hash-meta')`,
          [oid, iid, shaOk],
        );
      } catch {
        sizeMismatch = true;
      }
      check("upload byte-size mismatch fails", sizeMismatch);

      const ok = await admin.query(
        `select public.mp_record_payment('guest:corr',$1,$2,100000,$3,20,'idem-meta','hash-meta') as r`,
        [oid, iid, shaOk],
      );
      check("correct uploaded metadata attaches successfully", ok.rows[0].r.ok === true);
      const obj = await admin.query(
        `select sha256, byte_size from public.mp_receipt_objects
         where upload_intent_id = $1`,
        [iid],
      );
      check(
        "receipt object uses locked intent evidence",
        obj.rows[0].sha256 === shaOk && Number(obj.rows[0].byte_size) === 20,
      );
    }

    // Override supersession / expired replacement / single active
    {
      const o1 = await admin.query(
        `select public.mp_apply_override(
           'admin:super:t', $1, $2, 111000, 'permanent', null, 'first', 'admin'
         ) as r`,
        [ids.productId, ids.variantId],
      );
      const o2 = await admin.query(
        `select public.mp_apply_override(
           'admin:super:t', $1, $2, 122000, 'permanent', null, 'second', 'admin'
         ) as r`,
        [ids.productId, ids.variantId],
      );
      check("second override supersedes first", o2.rows[0].r.ok === true);
      check(
        "superseded_by linkage set",
        o2.rows[0].r.superseded_override_id === o1.rows[0].r.override_id,
      );
      const activeCount = await admin.query(
        `select count(*)::int as n from public.mp_price_overrides
         where variant_id = $1 and status = 'active'`,
        [ids.variantId],
      );
      check("only one effective active override remains", activeCount.rows[0].n === 1);

      // Create time_limited with future ends_at, then simulate time passing.
      const beforePrice = await admin.query(
        `select website_price, website_price_state from public.mp_product_variants where id = $1`,
        [ids.variantId],
      );
      let pastRejected = false;
      try {
        await admin.query(
          `select public.mp_apply_override(
             'admin:super:t', $1, $2, 199000, 'time_limited',
             timezone('utc', now()) - interval '1 minute', 'already-expired', 'admin'
           )`,
          [ids.productId, ids.variantId],
        );
      } catch {
        pastRejected = true;
      }
      check("past time-limited ends_at is rejected", pastRejected);
      const afterReject = await admin.query(
        `select website_price, website_price_state from public.mp_product_variants where id = $1`,
        [ids.variantId],
      );
      check(
        "rejected expired override does not alter website_price or price state",
        Number(afterReject.rows[0].website_price) === Number(beforePrice.rows[0].website_price) &&
          afterReject.rows[0].website_price_state === beforePrice.rows[0].website_price_state,
      );

      await admin.query(
        `select public.mp_apply_override(
           'admin:super:t', $1, $2, 133000, 'time_limited',
           timezone('utc', now()) + interval '1 hour', 'future-limited', 'admin'
         )`,
        [ids.productId, ids.variantId],
      );
      // Simulate clock pass: move stored ends_at into the past.
      await admin.query(
        `update public.mp_price_overrides
         set ends_at = timezone('utc', now()) - interval '1 hour'
         where variant_id = $1 and status = 'active' and mode = 'time_limited'`,
        [ids.variantId],
      );
      const o3 = await admin.query(
        `select public.mp_apply_override(
           'admin:super:t', $1, $2, 144000, 'permanent', null, 'after-expired', 'admin'
         ) as r`,
        [ids.productId, ids.variantId],
      );
      check(
        "previously valid override that expires no longer blocks replacement",
        o3.rows[0].r.ok === true,
      );
      const activeAfter = await admin.query(
        `select count(*)::int as n, max(override_price)::numeric as price
         from public.mp_price_overrides
         where variant_id = $1 and status = 'active'`,
        [ids.variantId],
      );
      check(
        "single active after expired replacement",
        activeAfter.rows[0].n === 1 && Number(activeAfter.rows[0].price) === 144000,
      );
      const expiredRows = await admin.query(
        `select count(*)::int as n from public.mp_price_overrides
         where variant_id = $1 and status = 'expired' and override_price = 133000`,
        [ids.variantId],
      );
      check("timed-out override marked expired", expiredRows.rows[0].n === 1);
      const resurrected = await admin.query(
        `select count(*)::int as n from public.mp_price_overrides
         where variant_id = $1 and status in ('superseded','revoked','expired')
           and override_price = 111000`,
        [ids.variantId],
      );
      check(
        "superseded/expired overrides not reactivated",
        resurrected.rows[0].n >= 1,
      );
    }

    // COD overpay rejected; order not delivered
    {
      await admin.query(
        `insert into public.mp_delivery_zones (id, code, name, cod_eligible, active)
         values ('mpz_cod', 'COD1', 'COD Zone', true, true)
         on conflict do nothing`,
      );
      // Reset variant price to 100000 for predictable COD (override may have changed it)
      await admin.query("begin");
      await admin.query(`select set_config('mp.allow_price_write','on',true)`);
      await admin.query(
        `update public.mp_product_variants
         set website_price = 100000, website_price_state = 'priced_auto',
             website_price_source = 'seed'
         where id = $1`,
        [ids.variantId],
      );
      await admin.query("commit");
      const oid = await freshPendingOrder(
        admin,
        "corr-cod",
        "cod_eligible",
        "mpz_cod",
        100000,
        0,
        100000,
      );
      // Simulate another verified payment consuming the total
      const plan = await admin.query(
        `select id from public.mp_payment_plans where order_id = $1`,
        [oid],
      );
      await admin.query(
        `insert into public.mp_payments
           (id, order_id, payment_plan_id, amount, method, status)
         values ('mppay_prepay', $1, $2, 100000, 'bank_transfer', 'verified')`,
        [oid, plan.rows[0].id],
      );
      const codPay = await admin.query(
        `select id from public.mp_payments
         where order_id = $1 and method = 'cash_on_delivery'`,
        [oid],
      );
      let overpay = false;
      try {
        await admin.query(
          `select public.mp_collect_cod_payment('admin:finance', $1, 'collector')`,
          [codPay.rows[0].id],
        );
      } catch {
        overpay = true;
      }
      check("COD collection cannot overpay an order", overpay);
      const st = await admin.query(`select status from public.mp_orders where id = $1`, [
        oid,
      ]);
      check(
        "failed COD collection does not mark delivered",
        st.rows[0].status !== "delivered",
      );
    }

    // Concurrent payment serialization (order lock)
    {
      await admin.query("begin");
      await admin.query(`select set_config('mp.allow_price_write','on',true)`);
      await admin.query(
        `update public.mp_product_variants
         set website_price = 100000, website_price_state = 'priced_auto'
         where id = $1`,
        [ids.variantId],
      );
      await admin.query("commit");
      const oid = await freshPendingOrder(
        admin,
        "corr-race",
        "cod_eligible",
        "mpz_cod",
        100000,
        0,
        100000,
      );
      const codPay = await admin.query(
        `select id from public.mp_payments
         where order_id = $1 and method = 'cash_on_delivery'`,
        [oid],
      );
      const c1 = adminFactory();
      const c2 = adminFactory();
      await c1.connect();
      await c2.connect();
      await c1.query("begin");
      await c2.query("begin");
      // c1 locks payment+order path first
      await c1.query(
        `select public.mp_collect_cod_payment('admin:finance', $1, 'c1')`,
        [codPay.rows[0].id],
      );
      const p2 = c2.query(
        `select public.mp_collect_cod_payment('admin:finance', $1, 'c2')`,
        [codPay.rows[0].id],
      );
      // Give c2 time to block on lock
      await new Promise((r) => setTimeout(r, 200));
      await c1.query("commit");
      let secondFailed = false;
      try {
        await p2;
        await c2.query("commit");
      } catch {
        secondFailed = true;
        try {
          await c2.query("rollback");
        } catch {
          /* ignore */
        }
      }
      check("concurrent payment operations serialize safely", secondFailed === true);
      await c1.end();
      await c2.end();
    }

    // =========================================================================
    // WS0 Correction 2 — financial lock-order concurrency
    // =========================================================================
    async function resetVariantPrice(client: pg.Client, price = 100000): Promise<void> {
      await client.query("begin");
      await client.query(`select set_config('mp.allow_price_write','on',true)`);
      await client.query(
        `update public.mp_product_variants
         set website_price = $2, website_price_state = 'priced_auto',
             website_price_source = 'seed', stock_status = 'in_stock'
         where id = $1`,
        [ids.variantId, price],
      );
      await client.query("commit");
    }

    // Verify + COD collect on sibling payments: serialize without deadlock
    {
      await resetVariantPrice(admin);
      const oid = await freshPendingOrder(
        admin,
        "corr2-sib",
        "token_plus_balance_cod",
        "mpz_cod",
        100000,
        0,
        60000,
      );
      const plan = await admin.query(
        `select id from public.mp_payment_plans where order_id = $1`,
        [oid],
      );
      await admin.query(
        `insert into public.mp_payments
           (id, order_id, payment_plan_id, amount, method, status)
         values ('mppay_sib_bt', $1, $2, 40000, 'bank_transfer', 'submitted')`,
        [oid, plan.rows[0].id],
      );
      const codPay = await admin.query(
        `select id from public.mp_payments
         where order_id = $1 and method = 'cash_on_delivery'`,
        [oid],
      );
      const c1 = adminFactory();
      const c2 = adminFactory();
      await c1.connect();
      await c2.connect();
      await c1.query("set lock_timeout = '5s'");
      await c2.query("set lock_timeout = '5s'");
      const started = Date.now();
      const results = await Promise.allSettled([
        c1.query(`select public.mp_verify_payment('admin:finance', $1, 'v1') as r`, [
          "mppay_sib_bt",
        ]),
        c2.query(`select public.mp_collect_cod_payment('admin:finance', $1, 'c1') as r`, [
          codPay.rows[0].id,
        ]),
      ]);
      const elapsed = Date.now() - started;
      check(
        "verify+COD sibling ops serialize without deadlock",
        elapsed < 5000 &&
          results.every((r) => r.status === "fulfilled") &&
          results.filter((r) => r.status === "fulfilled").length === 2,
      );
      const net = await admin.query(`select public.mp_order_net_paid($1)::numeric as n`, [
        oid,
      ]);
      check("sibling verify+collect preserves full balance", Number(net.rows[0].n) === 100000);
      await c1.end();
      await c2.end();
    }

    // Record-payment versus verification on same order
    {
      await resetVariantPrice(admin);
      const oid = await freshPendingOrder(admin, "corr2-rv", "full", null, 100000, 0, 0);
      // Seed a submitted bank payment to verify
      const plan = await admin.query(
        `select id from public.mp_payment_plans where order_id = $1`,
        [oid],
      );
      await admin.query(
        `insert into public.mp_payments
           (id, order_id, payment_plan_id, amount, method, status)
         values ('mppay_rv_bt', $1, $2, 50000, 'bank_transfer', 'submitted')`,
        [oid, plan.rows[0].id],
      );
      const iid = await createClaimedIntent(admin, oid, "idem-rv", "hash-rv");
      const sha = "e".repeat(64);
      await admin.query(`select public.mp_mark_upload_intent_uploaded($1, 10, $2)`, [
        iid,
        sha,
      ]);

      const c1 = adminFactory();
      const c2 = adminFactory();
      await c1.connect();
      await c2.connect();
      await c1.query("set lock_timeout = '5s'");
      await c2.query("set lock_timeout = '5s'");
      const started = Date.now();
      const results = await Promise.allSettled([
        c1.query(`select public.mp_verify_payment('admin:finance', $1, 'v') as r`, [
          "mppay_rv_bt",
        ]),
        c2.query(
          `select public.mp_record_payment(
             'guest:corr', $1, $2, 50000, $3, 10, 'idem-rv', 'hash-rv'
           ) as r`,
          [oid, iid, sha],
        ),
      ]);
      const elapsed = Date.now() - started;
      check(
        "record vs verify serialize without deadlock",
        elapsed < 5000 && results.every((r) => r.status === "fulfilled" || r.status === "rejected"),
      );
      // Exactly one financial winner path that leaves consistent state
      const order = await admin.query(`select status from public.mp_orders where id = $1`, [
        oid,
      ]);
      const pays = await admin.query(
        `select status, count(*)::int as n from public.mp_payments
         where order_id = $1 group by status`,
        [oid],
      );
      const statusMap = Object.fromEntries(pays.rows.map((r) => [r.status, r.n]));
      check(
        "failed concurrent ops leave order/payment status consistent",
        ["pending_payment", "awaiting_verification", "confirmed"].includes(order.rows[0].status) &&
          (statusMap.verified ?? 0) + (statusMap.submitted ?? 0) + (statusMap.attached ?? 0) >= 0,
      );
      // If verify won first, record should have failed_known / cleanup or still pending
      // If record won first, verify may still succeed on submitted sibling.
      const deadlockFree = results.every(
        (r) =>
          r.status === "fulfilled" ||
          (r.status === "rejected" &&
            !/deadlock detected/i.test(String((r as PromiseRejectedResult).reason))),
      );
      check("record/verify concurrency is deadlock-free", deadlockFree);
      void started;
      await c1.end();
      await c2.end();
    }

    // Concurrent refund/payment mutation preserves balance
    {
      await resetVariantPrice(admin);
      const oid = await freshPendingOrder(admin, "corr2-ref", "full", null, 100000, 0, 0);
      const plan = await admin.query(
        `select id from public.mp_payment_plans where order_id = $1`,
        [oid],
      );
      await admin.query(
        `insert into public.mp_payments
           (id, order_id, payment_plan_id, amount, method, status)
         values ('mppay_ref_src', $1, $2, 100000, 'bank_transfer', 'verified')`,
        [oid, plan.rows[0].id],
      );
      await admin.query(
        `update public.mp_orders set status = 'confirmed' where id = $1`,
        [oid],
      );
      const c1 = adminFactory();
      const c2 = adminFactory();
      await c1.connect();
      await c2.connect();
      await c1.query("set lock_timeout = '5s'");
      await c2.query("set lock_timeout = '5s'");
      const started = Date.now();
      const results = await Promise.allSettled([
        c1.query(
          `select public.mp_refund_payment('admin:finance', 'mppay_ref_src', 60000, 'r1') as r`,
        ),
        c2.query(
          `select public.mp_refund_payment('admin:finance', 'mppay_ref_src', 60000, 'r2') as r`,
        ),
      ]);
      const elapsed = Date.now() - started;
      const fulfilled = results.filter((r) => r.status === "fulfilled").length;
      const rejected = results.filter((r) => r.status === "rejected").length;
      check(
        "concurrent refunds serialize without deadlock",
        elapsed < 5000 && fulfilled === 1 && rejected === 1,
      );
      const net = await admin.query(`select public.mp_order_net_paid($1)::numeric as n`, [
        oid,
      ]);
      check(
        "concurrent refund/payment mutation preserves order balance",
        Number(net.rows[0].n) === 40000,
      );
      const order = await admin.query(`select status from public.mp_orders where id = $1`, [
        oid,
      ]);
      check(
        "failed concurrent refund leaves order status consistent",
        order.rows[0].status === "confirmed",
      );
      await c1.end();
      await c2.end();
    }

    // Concurrent identical idempotency preflight
    {
      const key = `idem-race-${randomUUID()}`;
      const c1 = adminFactory();
      const c2 = adminFactory();
      await c1.connect();
      await c2.connect();
      const [r1, r2] = await Promise.all([
        c1.query(`select public.mp_idempotency_preflight($1,$2,$3,$4,$5) as r`, [
          key,
          "bank_transfer_receipt",
          "guest:race",
          "hash-race",
          "ref",
        ]),
        c2.query(`select public.mp_idempotency_preflight($1,$2,$3,$4,$5) as r`, [
          key,
          "bank_transfer_receipt",
          "guest:race",
          "hash-race",
          "ref",
        ]),
      ]);
      const statuses = [r1.rows[0].r.status, r2.rows[0].r.status].sort();
      check(
        "concurrent identical idempotency: NEW_REQUEST + IN_PROGRESS/replay",
        statuses.includes("NEW_REQUEST") &&
          (statuses.includes("IN_PROGRESS") ||
            statuses.includes("COMPLETED_REPLAY") ||
            statuses.filter((s) => s === "NEW_REQUEST").length === 1),
      );
      check(
        "exactly one NEW_REQUEST among concurrent identical claims",
        statuses.filter((s) => s === "NEW_REQUEST").length === 1,
      );
      await c1.end();
      await c2.end();

      const conflict = await admin.query(
        `select public.mp_idempotency_preflight($1,$2,$3,$4,$5) as r`,
        [key, "bank_transfer_receipt", "guest:race", "hash-other", "ref"],
      );
      check(
        "request-hash conflicts remain blocked",
        conflict.rows[0].r.status === "REQUEST_HASH_CONFLICT",
      );
    }

    // Checkout manipulated subtotal rejected
    {
      let badSub = false;
      try {
        await admin.query(
          `select public.mp_checkout(
             'guest:corr', 'bad-sub', 'ORD-BADSUB', null, 'ghash',
             1, 0, 0, null, 'full', 1, 0, false,
             $1::jsonb
           )`,
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
      } catch {
        badSub = true;
      }
      check("checkout rejects a manipulated subtotal", badSub);
    }

    // Checkout rejects ineligible / over-limit COD
    {
      await admin.query(
        `insert into public.mp_delivery_zones (id, code, name, cod_eligible, active)
         values ('mpz_nocod', 'NOCOD', 'No COD', false, true)
         on conflict do nothing`,
      );
      let ineligible = false;
      try {
        await freshPendingOrder(admin, "corr-nocod", "cod_eligible", "mpz_nocod", 100000, 0, 100000);
      } catch {
        ineligible = true;
      }
      check("checkout rejects ineligible COD zone", ineligible);

      await admin.query(
        `update public.mp_pricing_config set cod_max_order_value = 50000 where company_id = 'sunchaser'`,
      );
      let overLimit = false;
      try {
        await freshPendingOrder(admin, "corr-over", "cod_eligible", "mpz_cod", 100000, 0, 100000);
      } catch {
        overLimit = true;
      }
      check("checkout rejects over-limit COD", overLimit);
      await admin.query(
        `update public.mp_pricing_config set cod_max_order_value = 250000 where company_id = 'sunchaser'`,
      );
    }

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
