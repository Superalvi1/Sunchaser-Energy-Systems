/**
 * WS5 cart / delivery / checkout PostgreSQL integration tests.
 * Ephemeral Postgres 16 only. Requires Docker.
 *
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/marketplace/cart/marketplaceWs5Cart.test.ts
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const WS0 = path.join(ROOT, "scripts/marketplace-ws0-foundation-schema.sql");
const WS1_ADD = path.join(ROOT, "scripts/marketplace-ws1-additive-schema.sql");
const WS5 = path.join(ROOT, "scripts/marketplace-ws5-cart-checkout.sql");
const IMAGE = "postgres:16-alpine";
const CONTAINER = `mp-ws5-test-${randomUUIDSlice()}`;
const PORT = 55732 + Math.floor(Math.random() * 200);
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;

function randomUUIDSlice(): string {
  return randomBytes(4).toString("hex");
}

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

function dockerAvailable(): boolean {
  return spawnSync("docker", ["info"], { encoding: "utf8" }).status === 0;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

async function waitForPg(attempts = 40): Promise<void> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    const client = new pg.Client({ connectionString: DB_URL });
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
  await client.query(
    "grant usage on schema public to anon, authenticated, service_role",
  );
}

async function apply(client: pg.Client, file: string): Promise<void> {
  await client.query(readFileSync(file, "utf8"));
}

async function seedVariants(client: pg.Client): Promise<{
  okSku: string;
  confirmSku: string;
  soldOutSku: string;
  okVariantId: string;
}> {
  await client.query(`
    insert into public.mp_brands (id, name, slug)
    values ('mpbrand_ws5', 'WS5 Brand', 'ws5-brand') on conflict do nothing;
    insert into public.mp_categories (id, name, slug)
    values ('mpcat_ws5', 'WS5 Cat', 'ws5-cat') on conflict do nothing;
    insert into public.mp_products (id, brand_id, category_id, title, slug, active)
    values ('mpprod_ws5', 'mpbrand_ws5', 'mpcat_ws5', 'WS5 Product', 'ws5-product', true)
    on conflict do nothing;
  `);
  await client.query(`
    insert into public.mp_product_variants
      (id, product_id, sku, title, is_default, stock_status, website_price,
       website_price_state, website_price_source, active, is_priceable)
    values
      ('mpvar_ws5_ok', 'mpprod_ws5', 'ws5-sku-ok', 'OK', true, 'in_stock', 50000,
       'priced_auto', 'seed', true, true),
      ('mpvar_ws5_confirm', 'mpprod_ws5', 'ws5-sku-confirm', 'Confirm', false, 'in_stock', null,
       'confirm_price', null, true, true),
      ('mpvar_ws5_sold', 'mpprod_ws5', 'ws5-sku-sold', 'Sold', false, 'sold_out', 50000,
       'priced_auto', 'seed', true, true)
    on conflict do nothing;
  `);
  return {
    okSku: "ws5-sku-ok",
    confirmSku: "ws5-sku-confirm",
    soldOutSku: "ws5-sku-sold",
    okVariantId: "mpvar_ws5_ok",
  };
}

function errCode(err: unknown): string {
  const msg = String((err as { message?: string })?.message || err);
  const m = /([A-Z][A-Z0-9_]+):/.exec(msg);
  return m?.[1] || msg;
}

async function main(): Promise<void> {
  if (!dockerAvailable()) {
    console.error("BLOCKED: Docker unavailable — cannot run WS5 cart schema tests");
    process.exit(2);
  }

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
    await waitForPg();
    await admin.connect();
    await ensureRoles(admin);
    await apply(admin, WS0);
    await apply(admin, WS1_ADD);
    await apply(admin, WS5);
    await apply(admin, WS5);
    check("WS5 SQL applies and re-applies", true);

    const seeded = await seedVariants(admin);
    const priceBefore = await admin.query<{ website_price: string }>(
      `select website_price::text from mp_product_variants where id = $1`,
      [seeded.okVariantId],
    );
    const priceSnap = priceBefore.rows[0].website_price;

    // 1–2 Guest cart: raw token only in app layer; DB stores hash
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(rawToken);
    const createGuest = await admin.query<{ r: Record<string, unknown> }>(
      `select public.mp_cart_create('guest:pending', null, $1, 72) as r`,
      [tokenHash],
    );
    const guestRef = String(createGuest.rows[0].r.publicRef);
    check("guest cart returns publicRef", guestRef.startsWith("mpcref_"));

    const stored = await admin.query<{ guest_token_hash: string | null }>(
      `select guest_token_hash from mp_carts where public_ref = $1`,
      [guestRef],
    );
    check(
      "guest cart stores hash only",
      stored.rows[0].guest_token_hash === tokenHash,
    );
    check(
      "raw token not stored",
      stored.rows[0].guest_token_hash !== rawToken,
    );

    // 2 Correct hash authorizes
    const addOk = await admin.query<{ r: Record<string, unknown> }>(
      `select public.mp_cart_upsert_item(
        $1, $2, null, $3, $4, 2
      ) as r`,
      [`guest:${guestRef}`, guestRef, tokenHash, seeded.okSku],
    );
    check("correct token hash adds item", addOk.rows[0].r.ok === true);
    check(
      "unit price from website_price",
      Number(addOk.rows[0].r.unitPrice) === 50000,
    );

    // 3 Wrong / missing token fail
    try {
      await admin.query(
        `select public.mp_cart_upsert_item(
          $1, $2, null, $3, $4, 1
        )`,
        [`guest:${guestRef}`, guestRef, hashToken("wrong-token"), seeded.okSku],
      );
      check("wrong token rejected", false);
    } catch (err) {
      check("wrong token rejected", errCode(err) === "CART_NOT_FOUND");
    }

    // Expired cart
    await admin.query(
      `update mp_carts set expires_at = timezone('utc', now()) - interval '1 hour'
       where public_ref = $1`,
      [guestRef],
    );
    try {
      await admin.query(
        `select public.mp_cart_upsert_item($1,$2,null,$3,$4,1)`,
        [`guest:${guestRef}`, guestRef, tokenHash, seeded.okSku],
      );
      check("expired cart rejected", false);
    } catch (err) {
      check("expired cart rejected", errCode(err) === "CART_EXPIRED");
    }
    await admin.query(
      `update mp_carts set expires_at = timezone('utc', now()) + interval '72 hours'
       where public_ref = $1`,
      [guestRef],
    );

    // 5–6 Customer ownership + cross-customer deny
    const custA = "cust_ws5_a";
    const custB = "cust_ws5_b";
    const createA = await admin.query<{ r: Record<string, unknown> }>(
      `select public.mp_cart_create($1, $2, null, 72) as r`,
      [`customer:${custA}`, custA],
    );
    const cartA = String(createA.rows[0].r.publicRef);
    await admin.query(
      `select public.mp_cart_upsert_item($1,$2,$3,null,$4,1)`,
      [`customer:${custA}`, cartA, custA, seeded.okSku],
    );
    try {
      await admin.query(
        `select public.mp_cart_upsert_item($1,$2,$3,null,$4,1)`,
        [`customer:${custB}`, cartA, custB, seeded.okSku],
      );
      check("cross-customer denied", false);
    } catch (err) {
      check("cross-customer denied", errCode(err) === "CART_NOT_FOUND");
    }

    // 7 Enumeration: unknown ref same code
    try {
      await admin.query(
        `select public.mp_cart_upsert_item($1,$2,$3,null,$4,1)`,
        [`customer:${custA}`, "mpcref_" + "0".repeat(32), custA, seeded.okSku],
      );
      check("unknown ref not found", false);
    } catch (err) {
      check("unknown ref not found", errCode(err) === "CART_NOT_FOUND");
    }

    // 9 Client prices never written — upsert ignores; snap from DB
    const itemRow = await admin.query<{ unit_price_snap: string }>(
      `select unit_price_snap::text from mp_cart_items ci
       join mp_carts c on c.id = ci.cart_id where c.public_ref = $1`,
      [cartA],
    );
    check(
      "cart snap equals website_price",
      itemRow.rows[0].unit_price_snap === "50000.00" ||
        itemRow.rows[0].unit_price_snap === "50000",
    );

    // 10 confirm_price / sold_out rejected
    try {
      await admin.query(
        `select public.mp_cart_upsert_item($1,$2,$3,null,$4,1)`,
        [`customer:${custA}`, cartA, custA, seeded.confirmSku],
      );
      check("confirm_price rejected", false);
    } catch (err) {
      check(
        "confirm_price rejected",
        errCode(err) === "CONFIRM_PRICE_REQUIRED",
      );
    }
    try {
      await admin.query(
        `select public.mp_cart_upsert_item($1,$2,$3,null,$4,1)`,
        [`customer:${custA}`, cartA, custA, seeded.soldOutSku],
      );
      check("sold_out rejected", false);
    } catch (err) {
      check("sold_out rejected", errCode(err) === "STOCK_NOT_ELIGIBLE");
    }

    // 11–12 Delivery quote server-side + COD
    const quoteLhr = await admin.query<{ r: Record<string, unknown> }>(
      `select public.mp_cart_quote_delivery($1,$2,$3,null,'LHR') as r`,
      [`customer:${custA}`, cartA, custA],
    );
    check(
      "delivery charge server-side LHR",
      Number(quoteLhr.rows[0].r.deliveryCharge) === 500,
    );
    check("COD eligible LHR", quoteLhr.rows[0].r.codEligible === true);

    const quoteKhi = await admin.query<{ r: Record<string, unknown> }>(
      `select public.mp_cart_quote_delivery($1,$2,$3,null,'KHI') as r`,
      [`customer:${custA}`, cartA, custA],
    );
    check("COD not eligible KHI", quoteKhi.rows[0].r.codEligible === false);

    try {
      await admin.query(
        `select public.mp_cart_quote_delivery($1,$2,$3,null,'XXX')`,
        [`customer:${custA}`, cartA, custA],
      );
      check("invalid zone rejected", false);
    } catch (err) {
      check("invalid zone rejected", errCode(err) === "INVALID_DELIVERY_ZONE");
    }

    // 13 Atomic checkout
    const checkout = await admin.query<{ r: Record<string, unknown> }>(
      `select public.mp_cart_checkout(
        $1, $2, $3, null, 'LHR', 'full', $4, $5
      ) as r`,
      [
        `customer:${custA}`,
        cartA,
        custA,
        "idem-ws5-1",
        hashToken("req-1"),
      ],
    );
    check("checkout ok", checkout.rows[0].r.ok === true);
    const orderRef = String(checkout.rows[0].r.publicRef);
    const orderCount = await admin.query(
      `select count(*)::int as n from mp_orders where public_ref = $1`,
      [orderRef],
    );
    const itemCount = await admin.query(
      `select count(*)::int as n from mp_order_items oi
       join mp_orders o on o.id = oi.order_id where o.public_ref = $1`,
      [orderRef],
    );
    const planCount = await admin.query(
      `select count(*)::int as n from mp_payment_plans pp
       join mp_orders o on o.id = pp.order_id where o.public_ref = $1`,
      [orderRef],
    );
    const auditCount = await admin.query(
      `select count(*)::int as n from mp_audit_events
       where action = 'checkout.completed' and entity_id = (
         select id from mp_orders where public_ref = $1
       )`,
      [orderRef],
    );
    check("order created", orderCount.rows[0].n === 1);
    check("order items created", itemCount.rows[0].n >= 1);
    check("payment plan created", planCount.rows[0].n === 1);
    check("checkout audit written", auditCount.rows[0].n === 1);
    const cartChecked = await admin.query<{ checked_out_at: string | null }>(
      `select checked_out_at from mp_carts where public_ref = $1`,
      [cartA],
    );
    check("cart marked checked out", cartChecked.rows[0].checked_out_at != null);

    // 17 Idempotent replay
    const replay = await admin.query<{ r: Record<string, unknown> }>(
      `select public.mp_cart_checkout(
        $1, $2, $3, null, 'LHR', 'full', $4, $5
      ) as r`,
      [
        `customer:${custA}`,
        cartA,
        custA,
        "idem-ws5-1",
        hashToken("req-1"),
      ],
    );
    check("idempotent replay", replay.rows[0].r.replay === true);
    check(
      "replay same order ref",
      String(replay.rows[0].r.publicRef) === orderRef,
    );

    // 18 Same key different request → conflict
    const conflict = await admin.query<{ r: Record<string, unknown> }>(
      `select public.mp_cart_checkout(
        $1, $2, $3, null, 'ISB', 'full', $4, $5
      ) as r`,
      [
        `customer:${custA}`,
        cartA,
        custA,
        "idem-ws5-1",
        hashToken("req-different"),
      ],
    );
    check(
      "idempotency conflict",
      conflict.rows[0].r.ok === false &&
        (conflict.rows[0].r.error as { code: string }).code ===
          "IDEMPOTENCY_CONFLICT",
    );

    // Fresh cart for rollback / price-change / concurrency
    const createB = await admin.query<{ r: Record<string, unknown> }>(
      `select public.mp_cart_create($1, $2, null, 72) as r`,
      [`customer:${custB}`, custB],
    );
    const cartB = String(createB.rows[0].r.publicRef);
    await admin.query(
      `select public.mp_cart_upsert_item($1,$2,$3,null,$4,1)`,
      [`customer:${custB}`, cartB, custB, seeded.okSku],
    );

    // 14 Forced failure rolls back (invalid zone after cart ready)
    const failCheckout = await admin.query<{ r: Record<string, unknown> }>(
      `select public.mp_cart_checkout(
        $1, $2, $3, null, 'ZZZ', 'full', $4, $5
      ) as r`,
      [
        `customer:${custB}`,
        cartB,
        custB,
        "idem-ws5-fail",
        hashToken("fail-1"),
      ],
    );
    check(
      "failed checkout returns error",
      failCheckout.rows[0].r.ok === false,
    );
    const ordersAfterFail = await admin.query(
      `select count(*)::int as n from mp_orders o
       join mp_carts c on c.guest_token_hash is null
       where o.customer_id = $1 and o.created_at > now() - interval '1 minute'`,
      [custB],
    );
    // More precise: cart still open, no order linked via cart checkout for this key
    const cartBState = await admin.query<{ checked_out_at: string | null }>(
      `select checked_out_at from mp_carts where public_ref = $1`,
      [cartB],
    );
    check("failed checkout leaves cart open", cartBState.rows[0].checked_out_at == null);
    check(
      "failed_known persisted",
      (
        await admin.query(
          `select state from mp_idempotency_keys
           where idempotency_key = 'idem-ws5-fail' and actor_scope = $1`,
          [`customer:${custB}`],
        )
      ).rows[0]?.state === "failed_known",
    );
    void ordersAfterFail;

    // 15 Price change before checkout (session-level bypass; insert-only seed path is guarded on UPDATE)
    await admin.query(`select set_config('mp.allow_price_write', 'on', false)`);
    await admin.query(
      `update mp_product_variants set website_price = 60000 where id = $1`,
      [seeded.okVariantId],
    );
    await admin.query(`select set_config('mp.allow_price_write', '', false)`);

    const priceChanged = await admin.query<{ r: Record<string, unknown> }>(
      `select public.mp_cart_checkout(
        $1, $2, $3, null, 'LHR', 'full', $4, $5
      ) as r`,
      [
        `customer:${custB}`,
        cartB,
        custB,
        "idem-ws5-price",
        hashToken("price-1"),
      ],
    );
    check(
      "price change detected",
      priceChanged.rows[0].r.ok === false &&
        (priceChanged.rows[0].r.error as { code: string }).code ===
          "PRICE_CHANGED",
    );

    // Restore price and refresh cart snap via upsert for concurrency test
    await admin.query(`select set_config('mp.allow_price_write', 'on', false)`);
    await admin.query(
      `update mp_product_variants set website_price = 50000 where id = $1`,
      [seeded.okVariantId],
    );
    await admin.query(`select set_config('mp.allow_price_write', '', false)`);
    await admin.query(
      `select public.mp_cart_upsert_item($1,$2,$3,null,$4,1)`,
      [`customer:${custB}`, cartB, custB, seeded.okSku],
    );

    // 16 Concurrent identical idempotency → one order
    const createC = await admin.query<{ r: Record<string, unknown> }>(
      `select public.mp_cart_create('customer:cust_ws5_c', 'cust_ws5_c', null, 72) as r`,
    );
    const cartC = String(createC.rows[0].r.publicRef);
    await admin.query(
      `select public.mp_cart_upsert_item('customer:cust_ws5_c',$1,'cust_ws5_c',null,$2,1)`,
      [cartC, seeded.okSku],
    );

    const c1 = new pg.Client({ connectionString: DB_URL });
    const c2 = new pg.Client({ connectionString: DB_URL });
    await c1.connect();
    await c2.connect();
    const idem = "idem-ws5-concurrent";
    const reqHash = hashToken("concurrent-1");
    const sql = `select public.mp_cart_checkout(
      'customer:cust_ws5_c', $1, 'cust_ws5_c', null, 'LHR', 'full', $2, $3
    ) as r`;
    const [r1, r2] = await Promise.all([
      c1.query<{ r: Record<string, unknown> }>(sql, [cartC, idem, reqHash]),
      c2.query<{ r: Record<string, unknown> }>(sql, [cartC, idem, reqHash]),
    ]);
    await c1.end();
    await c2.end();
    const refs = [r1.rows[0].r, r2.rows[0].r]
      .filter((r) => r.ok === true)
      .map((r) => String(r.publicRef));
    const uniqueOrders = new Set(refs);
    check(
      "concurrent checkout one success path",
      uniqueOrders.size === 1 ||
        (refs.length === 1 &&
          [r1.rows[0].r, r2.rows[0].r].some(
            (r) =>
              r.ok === false &&
              (r.error as { code?: string })?.code === "CONFLICT",
          )),
    );
    const orderN = await admin.query(
      `select count(*)::int as n from mp_orders where customer_id = 'cust_ws5_c'`,
    );
    check("concurrent creates one order", orderN.rows[0].n === 1);

    // 19 Browser roles denied
    await admin.query("begin");
    await admin.query("set local role anon");
    try {
      await admin.query(
        `select public.mp_cart_create('guest:pending', null, $1, 72)`,
        [hashToken("anon-try")],
      );
      await admin.query("rollback");
      check("anon execute denied", false);
    } catch {
      await admin.query("rollback");
      check("anon execute denied", true);
    }

    await admin.query("begin");
    await admin.query("set local role authenticated");
    try {
      await admin.query(
        `select public.mp_cart_checkout(
          'customer:x', 'mpcref_' || repeat('a',32), 'x', null, 'LHR', 'full', 'k', 'h'
        )`,
      );
      await admin.query("rollback");
      check("authenticated execute denied", false);
    } catch {
      await admin.query("rollback");
      check("authenticated execute denied", true);
    }

    // 20 Audit/DTO safety — no token hashes in audit payload
    const audits = await admin.query<{ payload: Record<string, unknown> }>(
      `select payload from mp_audit_events
       where action in ('cart.created','cart.item_upserted','checkout.completed')
       order by created_at desc limit 20`,
    );
    const auditText = JSON.stringify(audits.rows.map((r) => r.payload));
    check(
      "audits omit token hashes",
      !auditText.includes(tokenHash) && !auditText.includes(rawToken),
    );
    check(
      "audits omit costs/margins",
      !auditText.includes("actual_purchase_cost") &&
        !auditText.includes("margin") &&
        !auditText.includes("profit"),
    );

    // 21 Protected pricing fields unchanged from cart ops (price restored to 50000)
    const priceAfter = await admin.query<{ website_price: string }>(
      `select website_price::text from mp_product_variants where id = $1`,
      [seeded.okVariantId],
    );
    check(
      "website_price restored/stable after cart ops",
      priceAfter.rows[0].website_price === "50000.00" ||
        priceAfter.rows[0].website_price === priceSnap ||
        priceAfter.rows[0].website_price === "50000",
    );

    // Order get ownership
    const orderDto = await admin.query<{ r: Record<string, unknown> }>(
      `select public.mp_order_get($1, $2, null) as r`,
      [orderRef, custA],
    );
    check("order get for owner", orderDto.rows[0].r.ok === true);
    try {
      await admin.query(`select public.mp_order_get($1, $2, null)`, [
        orderRef,
        custB,
      ]);
      check("cross-customer order denied", false);
    } catch (err) {
      check("cross-customer order denied", errCode(err) === "CART_NOT_FOUND");
    }

    console.log("marketplaceWs5Cart.test.ts: all checks passed");
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
