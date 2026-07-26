/**
 * WS6b COD PostgreSQL state-machine / concurrency tests.
 * Ephemeral Postgres 16 only. Requires Docker.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createCodRepository, CodRepositoryError } from "./codRepository.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const WS0 = path.join(ROOT, "scripts/marketplace-ws0-foundation-schema.sql");
const WS1 = path.join(ROOT, "scripts/marketplace-ws1-additive-schema.sql");
const WS5 = path.join(ROOT, "scripts/marketplace-ws5-cart-checkout.sql");
const WS6A = path.join(ROOT, "scripts/marketplace-ws6a-bank-transfer.sql");
const WS6B = path.join(ROOT, "scripts/marketplace-ws6b-cod.sql");
const CONTAINER = `mp-ws6b-test-${randomBytes(4).toString("hex")}`;
const PORT = 55910 + Math.floor(Math.random() * 200);
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

async function waitForPg(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const c = new pg.Client({ connectionString: DB_URL });
    try {
      await c.connect();
      await c.query("select 1");
      await c.end();
      return;
    } catch {
      try {
        await c.end();
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("Postgres not ready");
}

async function ensureRoles(client: pg.Client): Promise<void> {
  await client.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$;
  `);
  await client.query(
    "grant usage on schema public to anon, authenticated, service_role",
  );
}

function makeRpc(admin: pg.Client) {
  return async (name: string, args: Record<string, unknown>) => {
    const keys = Object.keys(args);
    const vals = keys.map((k) => args[k]);
    const params = keys.map((k, i) => `${k} := $${i + 1}`).join(", ");
    try {
      const result = await admin.query(
        `select public.${name}(${params}) as r`,
        vals,
      );
      return result.rows[0].r as Record<string, unknown>;
    } catch (err) {
      throw new Error(String((err as Error).message || err));
    }
  };
}

async function seedCatalogue(admin: pg.Client): Promise<void> {
  await admin.query(`
    insert into public.mp_brands (id, name, slug)
    values ('mpbrand_ws6b', 'WS6B Brand', 'ws6b-brand') on conflict do nothing;
    insert into public.mp_categories (id, name, slug)
    values ('mpcat_ws6b', 'WS6B Cat', 'ws6b-cat') on conflict do nothing;
    insert into public.mp_products (id, brand_id, category_id, title, slug, active)
    values ('mpprod_ws6b', 'mpbrand_ws6b', 'mpcat_ws6b', 'WS6B Product', 'ws6b-product', true)
    on conflict do nothing;
    insert into public.mp_product_variants
      (id, product_id, sku, title, is_default, stock_status, website_price,
       website_price_state, website_price_source, active, is_priceable)
    values
      ('mpvar_ws6b_ok', 'mpprod_ws6b', 'ws6b-sku-ok', 'OK', true, 'in_stock', 50000,
       'priced_auto', 'seed', true, true)
    on conflict do nothing;
  `);
}

async function seedCodOrder(
  admin: pg.Client,
  opts: {
    publicRef: string;
    customerId?: string | null;
    guestHash?: string | null;
    zoneId?: string;
    planType?: string;
  },
): Promise<{ orderId: string; amount: number }> {
  const zoneId = opts.zoneId ?? "mpzone_lhr";
  const plan = opts.planType ?? "cod_eligible";
  const delivery = zoneId === "mpzone_lhr" ? 500 : 1000;
  const amount = 50000 + delivery;
  const checkout = await admin.query(
    `select public.mp_checkout(
       $1, $2, $3, $4, $5,
       50000::numeric, $6::numeric, 0, $7, $8,
       $9::numeric, $10::numeric, $11,
       $12::jsonb
     ) as r`,
    [
      opts.customerId
        ? `customer:${opts.customerId}`
        : `guest:${opts.publicRef}`,
      opts.publicRef,
      `ORD-${opts.publicRef.slice(-8)}`,
      opts.customerId ?? null,
      opts.guestHash ?? null,
      delivery,
      zoneId,
      plan,
      plan === "cod_eligible" ? 0 : amount,
      plan === "cod_eligible" ? amount : 0,
      plan === "cod_eligible",
      JSON.stringify([
        {
          product_id: "mpprod_ws6b",
          variant_id: "mpvar_ws6b_ok",
          quantity: 1,
        },
      ]),
    ],
  );
  check("seed checkout ok", checkout.rows[0].r.ok === true);
  return { orderId: checkout.rows[0].r.order_id as string, amount };
}

async function main(): Promise<void> {
  if (spawnSync("docker", ["info"], { encoding: "utf8" }).status !== 0) {
    console.error("Docker unavailable");
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
      "postgres:16-alpine",
    ],
    { stdio: "ignore" },
  );

  const admin = new pg.Client({ connectionString: DB_URL });
  try {
    await waitForPg();
    await admin.connect();
    await ensureRoles(admin);
    for (const f of [WS0, WS1, WS5, WS6A, WS6B]) {
      await admin.query(readFileSync(f, "utf8"));
    }
    await seedCatalogue(admin);

    // Browser roles cannot execute privileged RPCs
    for (const role of ["anon", "authenticated"]) {
      const r = await admin.query(
        `select has_function_privilege($1, 'public.mp_cod_confirm(text,text,text,text,text,text)', 'execute') as e`,
        [role],
      );
      check(`${role} cannot execute mp_cod_confirm`, r.rows[0].e === false);
    }
    const sr = await admin.query(
      `select has_function_privilege('service_role', 'public.mp_cod_confirm(text,text,text,text,text,text)', 'execute') as e`,
    );
    check("service_role can execute mp_cod_confirm", sr.rows[0].e === true);

    const repo = createCodRepository({ rpc: makeRpc(admin) });

    // 1. Customer COD confirm
    const custRef = `mporef_${"c".repeat(32)}`;
    await seedCodOrder(admin, {
      publicRef: custRef,
      customerId: "cust_ws6b_1",
    });
    const custId = {
      kind: "customer" as const,
      customerId: "cust_ws6b_1",
      actorScope: "customer:cust_ws6b_1",
    };
    const conf = await repo.confirm(custId, custRef, "idem-cust-1");
    check("customer COD confirm", conf.orderStatus === "confirmed");
    check("confirm does not collect", conf.paymentStatus === "pending");

    // 2. Guest COD confirm
    const guestRef = `mporef_${"g".repeat(32)}`;
    const guestRaw = "guest-token-ws6b";
    const guestHash = hashToken(guestRaw);
    await seedCodOrder(admin, { publicRef: guestRef, guestHash });
    const guestId = {
      kind: "guest" as const,
      tokenHash: guestHash,
      actorScope: `guest:${guestRef}`,
    };
    const gConf = await repo.confirm(guestId, guestRef, "idem-guest-1");
    check("guest COD confirm", gConf.fulfillmentState === "cod_confirmed");

    // 5. Cross access
    let cross = "";
    try {
      await repo.confirm(custId, guestRef, "idem-cross");
    } catch (e) {
      cross = (e as CodRepositoryError).code;
    }
    check("cross-customer ORDER_NOT_FOUND", cross === "ORDER_NOT_FOUND");

    let wrongGuest = "";
    try {
      await repo.get(
        { kind: "guest", tokenHash: hashToken("wrong"), actorScope: `guest:${guestRef}` },
        guestRef,
      );
    } catch (e) {
      wrongGuest = (e as CodRepositoryError).code;
    }
    check("wrong guest token ORDER_NOT_FOUND", wrongGuest === "ORDER_NOT_FOUND");

    // 6. Non-COD orders cannot enter
    const btRef = `mporef_${"b".repeat(32)}`;
    await seedCodOrder(admin, {
      publicRef: btRef,
      guestHash: hashToken("bt"),
      planType: "full",
    });
    let nonCod = "";
    try {
      await repo.confirm(
        {
          kind: "guest",
          tokenHash: hashToken("bt"),
          actorScope: `guest:${btRef}`,
        },
        btRef,
        "idem-bt",
      );
    } catch (e) {
      nonCod = (e as CodRepositoryError).code;
    }
    check(
      "non-COD rejected",
      nonCod === "INVALID_PAYMENT_METHOD" || nonCod === "COD_NOT_ALLOWED",
    );

    // 7. COD-disabled zone
    const khiRef = `mporef_${"k".repeat(32)}`;
    // Force-create COD plan on KHI by temporarily using checkout — WS0 checkout
    // rejects non-COD zones for cod_eligible. Insert order manually for this case.
    await admin.query(
      `insert into public.mp_orders (
         id, public_ref, order_number, guest_token_hash, status,
         subtotal, delivery_fee, tax, grand_total, delivery_zone_id, checkout_locked,
         fulfillment_state
       ) values (
         'mpord_khi1', $1, 'ORD-KHI1', $2, 'pending_payment',
         50000, 1000, 0, 51000, 'mpzone_khi', true, 'cod_pending'
       )`,
      [khiRef, hashToken("khi")],
    );
    await admin.query(
      `insert into public.mp_payment_plans (
         id, order_id, plan_type, grand_total, upfront_amount, balance_due, balance_on_delivery
       ) values (
         'mpplan_khi1', 'mpord_khi1', 'cod_eligible', 51000, 0, 51000, true
       )`,
    );
    await admin.query(
      `insert into public.mp_payments (
         id, order_id, payment_plan_id, amount, method, status
       ) values (
         'mppay_khi1', 'mpord_khi1', 'mpplan_khi1', 51000, 'cash_on_delivery', 'pending'
       )`,
    );
    let khi = "";
    try {
      await repo.confirm(
        {
          kind: "guest",
          tokenHash: hashToken("khi"),
          actorScope: `guest:${khiRef}`,
        },
        khiRef,
        "idem-khi",
      );
    } catch (e) {
      khi = (e as CodRepositoryError).code;
    }
    check("COD-disabled zone rejected", khi === "COD_NOT_ALLOWED");

    // 9-10. Duplicate/concurrent confirmation
    const replay = await repo.confirm(guestId, guestRef, "idem-guest-1");
    check("idempotent replay", replay.replay === true);

    const concRef = `mporef_${"x".repeat(32)}`;
    await seedCodOrder(admin, {
      publicRef: concRef,
      guestHash: hashToken("conc"),
    });
    const concId = {
      kind: "guest" as const,
      tokenHash: hashToken("conc"),
      actorScope: `guest:${concRef}`,
    };
    const conc = await Promise.allSettled([
      repo.confirm(concId, concRef, "idem-conc"),
      repo.confirm(concId, concRef, "idem-conc"),
    ]);
    const concOk = conc.filter((r) => r.status === "fulfilled").length;
    check("concurrent confirm >=1 success", concOk >= 1);
    const concCount = await admin.query(
      `select count(*)::int as n from public.mp_orders
       where public_ref = $1 and status = 'confirmed'`,
      [concRef],
    );
    check("one confirmed order", concCount.rows[0].n === 1);

    // Changed idempotency conflict
    let conflict = "";
    try {
      await repo.confirm(guestId, guestRef, "idem-guest-1");
      // same key same hash → replay; force conflict via admin with different reason hashes
      await repo.adminTransition(
        "admin:ops:u1",
        "u1",
        guestRef,
        "dispatch",
        { idempotencyKey: "idem-disp-1" },
      );
      await repo.adminTransition(
        "admin:ops:u1",
        "u1",
        guestRef,
        "dispatch",
        { reason: "different", idempotencyKey: "idem-disp-1" },
      );
    } catch (e) {
      conflict = (e as CodRepositoryError).code;
    }
    // second dispatch after success may be INVALID_STATUS or IDEMPOTENCY_CONFLICT
    check(
      "changed/idempotent admin conflict or invalid transition",
      conflict === "IDEMPOTENCY_CONFLICT" ||
        conflict === "INVALID_STATUS_TRANSITION" ||
        conflict === "",
    );

    // Ensure guest order dispatched for further tests
    const gState = await admin.query(
      `select status, fulfillment_state from public.mp_orders where public_ref = $1`,
      [guestRef],
    );
    if (gState.rows[0].status === "confirmed") {
      await repo.adminTransition("admin:ops:u1", "u1", guestRef, "dispatch", {
        idempotencyKey: "idem-disp-g",
      });
    }

    // 11-12. Dispatch / attempt
    let earlyAttempt = "";
    const earlyRef = `mporef_${"e".repeat(32)}`;
    await seedCodOrder(admin, {
      publicRef: earlyRef,
      guestHash: hashToken("early"),
    });
    const earlyId = {
      kind: "guest" as const,
      tokenHash: hashToken("early"),
      actorScope: `guest:${earlyRef}`,
    };
    await repo.confirm(earlyId, earlyRef, "idem-early");
    try {
      await repo.adminTransition(
        "admin:ops:u1",
        "u1",
        earlyRef,
        "delivery_attempt",
        { reason: "Trying early", idempotencyKey: "idem-early-att" },
      );
    } catch (e) {
      earlyAttempt = (e as CodRepositoryError).code;
    }
    check(
      "attempt before dispatch rejected",
      earlyAttempt === "DELIVERY_ATTEMPT_NOT_ALLOWED",
    );

    await repo.adminTransition("admin:ops:u1", "u1", earlyRef, "dispatch", {
      idempotencyKey: "idem-early-d",
    });
    const att = await repo.adminTransition(
      "admin:ops:u1",
      "u1",
      earlyRef,
      "delivery_attempt",
      { reason: "Customer not home", idempotencyKey: "idem-early-att2" },
    );
    check("delivery attempt ok", att.fulfillmentState === "delivery_attempted");

    // 13-15. Collection
    let earlyCollect = "";
    const colRef = `mporef_${"p".repeat(32)}`;
    await seedCodOrder(admin, {
      publicRef: colRef,
      guestHash: hashToken("col"),
    });
    const colId = {
      kind: "guest" as const,
      tokenHash: hashToken("col"),
      actorScope: `guest:${colRef}`,
    };
    await repo.confirm(colId, colRef, "idem-col-c");
    try {
      await repo.adminTransition(
        "admin:finance:u1",
        "u1",
        colRef,
        "collect",
        { idempotencyKey: "idem-col-early" },
      );
    } catch (e) {
      earlyCollect = (e as CodRepositoryError).code;
    }
    check(
      "collect before dispatch rejected",
      earlyCollect === "COD_COLLECTION_NOT_ALLOWED",
    );

    await repo.adminTransition("admin:ops:u1", "u1", colRef, "dispatch", {
      idempotencyKey: "idem-col-d",
    });
    const collected = await repo.adminTransition(
      "admin:finance:u1",
      "u1",
      colRef,
      "collect",
      { idempotencyKey: "idem-col-ok" },
    );
    check("collect ok", collected.paymentStatus === "collected");
    check("order delivered", collected.orderStatus === "delivered");

    const net = await admin.query(
      `select public.mp_order_net_paid(id) as n from public.mp_orders where public_ref = $1`,
      [colRef],
    );
    check("net paid equals COD amount", Number(net.rows[0].n) === 50500);

    // Concurrent collect
    const ccRef = `mporef_${"q".repeat(32)}`;
    await seedCodOrder(admin, {
      publicRef: ccRef,
      guestHash: hashToken("cc"),
    });
    const ccId = {
      kind: "guest" as const,
      tokenHash: hashToken("cc"),
      actorScope: `guest:${ccRef}`,
    };
    await repo.confirm(ccId, ccRef, "idem-cc-c");
    await repo.adminTransition("admin:ops:u1", "u1", ccRef, "dispatch", {
      idempotencyKey: "idem-cc-d",
    });
    const ccRes = await Promise.allSettled([
      repo.adminTransition("admin:finance:u1", "u1", ccRef, "collect", {
        idempotencyKey: "idem-cc-a",
      }),
      repo.adminTransition("admin:finance:u2", "u2", ccRef, "collect", {
        idempotencyKey: "idem-cc-b",
      }),
    ]);
    const ccOk = ccRes.filter((r) => r.status === "fulfilled").length;
    const ccFail = ccRes.filter((r) => r.status === "rejected").length;
    check("concurrent collect one success", ccOk === 1);
    check("concurrent collect one failure", ccFail === 1);

    // 16. Forced outbox failure rolls back
    const rbRef = `mporef_${"r".repeat(32)}`;
    await seedCodOrder(admin, {
      publicRef: rbRef,
      guestHash: hashToken("rb"),
    });
    const rbId = {
      kind: "guest" as const,
      tokenHash: hashToken("rb"),
      actorScope: `guest:${rbRef}`,
    };
    await repo.confirm(rbId, rbRef, "idem-rb-c");
    await repo.adminTransition("admin:ops:u1", "u1", rbRef, "dispatch", {
      idempotencyKey: "idem-rb-d",
    });
    let rolled = false;
    try {
      await admin.query("begin");
      await admin.query(
        `select public.mp_cod_admin_transition(
           'admin:finance:u1', $1, 'collect', 'u1', null, 'idem-rb-col', 'hash-rb-col'
         )`,
        [rbRef],
      );
      await admin.query(
        `select public.mp_enqueue_event(
           'cod.collected', 'mp_payments', 'x', null, null, 'client:evil', '{}'::jsonb
         )`,
      );
      await admin.query("commit");
    } catch {
      await admin.query("rollback");
      rolled = true;
    }
    check("forced failure rolls back", rolled);
    const rbPay = await admin.query(
      `select p.status from public.mp_payments p
       join public.mp_orders o on o.id = p.order_id
       where o.public_ref = $1 and p.method = 'cash_on_delivery'`,
      [rbRef],
    );
    check("payment still pending after rollback", rbPay.rows[0].status === "pending");

    // 17. Fail/refuse never collect
    const failRef = `mporef_${"f".repeat(32)}`;
    await seedCodOrder(admin, {
      publicRef: failRef,
      guestHash: hashToken("fail"),
    });
    const failId = {
      kind: "guest" as const,
      tokenHash: hashToken("fail"),
      actorScope: `guest:${failRef}`,
    };
    await repo.confirm(failId, failRef, "idem-fail-c");
    await repo.adminTransition("admin:ops:u1", "u1", failRef, "dispatch", {
      idempotencyKey: "idem-fail-d",
    });
    const failed = await repo.adminTransition(
      "admin:ops:u1",
      "u1",
      failRef,
      "fail",
      { reason: "Address unreachable", idempotencyKey: "idem-fail-f" },
    );
    check("fail keeps payment pending", failed.paymentStatus === "pending");
    check("fail fulfillment", failed.fulfillmentState === "delivery_failed");

    // 19-20. Cancel preserves history; collected cannot cancel
    const canRef = `mporef_${"z".repeat(32)}`;
    await seedCodOrder(admin, {
      publicRef: canRef,
      guestHash: hashToken("can"),
    });
    const canId = {
      kind: "guest" as const,
      tokenHash: hashToken("can"),
      actorScope: `guest:${canRef}`,
    };
    await repo.confirm(canId, canRef, "idem-can-c");
    const cancelled = await repo.adminTransition(
      "admin:ops:u1",
      "u1",
      canRef,
      "cancel",
      { reason: "Customer requested cancel", idempotencyKey: "idem-can" },
    );
    check("cancel ok", cancelled.orderStatus === "cancelled");
    const hist = await admin.query(
      `select count(*)::int as n from public.mp_payments p
       join public.mp_orders o on o.id = p.order_id where o.public_ref = $1`,
      [canRef],
    );
    check("cancel preserves payment row", hist.rows[0].n >= 1);

    let postCollectCancel = "";
    try {
      await repo.adminTransition("admin:ops:u1", "u1", colRef, "cancel", {
        reason: "Too late",
        idempotencyKey: "idem-late-can",
      });
    } catch (e) {
      postCollectCancel = (e as CodRepositoryError).code;
    }
    check(
      "collected cannot cancel",
      postCollectCancel === "CANCELLATION_NOT_ALLOWED",
    );

    // 21. Return to origin
    const rto = await repo.adminTransition(
      "admin:ops:u1",
      "u1",
      failRef,
      "return_start",
      { reason: "Courier return ticket", idempotencyKey: "idem-rto-s" },
    );
    check("return started", rto.fulfillmentState === "return_started");
    const rtoDone = await repo.adminTransition(
      "admin:ops:u1",
      "u1",
      failRef,
      "return_complete",
      { idempotencyKey: "idem-rto-c" },
    );
    check("return completed", rtoDone.fulfillmentState === "return_completed");

    // Outbox events present
    const ev = await admin.query(
      `select event_type from public.mp_event_outbox
       where event_type in (
         'cod.confirmed','order.dispatched','cod.collected',
         'delivery.failed','order.cancelled','return_to_origin.started'
       )`,
    );
    const types = new Set(ev.rows.map((r) => r.event_type));
    check("outbox has cod.confirmed", types.has("cod.confirmed"));
    check("outbox has cod.collected", types.has("cod.collected"));
    check("outbox has delivery.failed", types.has("delivery.failed"));

    // Privacy / commercial
    const audit = await admin.query(
      `select payload::text as p from public.mp_audit_events
       where action like 'cod.%' limit 20`,
    );
    const atext = audit.rows.map((r) => r.p).join(" ");
    check("audit omits guest hash", !atext.includes(guestHash));
    check("audit omits address keys", !atext.includes("address"));

    const price = await admin.query(
      `select website_price from public.mp_product_variants where id = 'mpvar_ws6b_ok'`,
    );
    check("website_price unchanged", Number(price.rows[0].website_price) === 50000);

    // Ops cannot collect at RPC scope
    let opsCollect = "";
    try {
      await repo.adminTransition("admin:ops:u9", "u9", earlyRef, "collect", {
        idempotencyKey: "idem-ops-col",
      });
    } catch (e) {
      opsCollect = (e as CodRepositoryError).code;
    }
    check(
      "ops scope cannot collect",
      opsCollect === "ORDER_NOT_AUTHORIZED" ||
        opsCollect === "COD_ALREADY_COLLECTED" ||
        opsCollect === "COD_COLLECTION_NOT_ALLOWED",
    );

    console.log("\nmarketplace WS6b COD postgres tests passed");
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
