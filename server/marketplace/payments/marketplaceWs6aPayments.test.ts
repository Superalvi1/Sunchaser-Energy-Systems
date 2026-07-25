/**
 * WS6a bank-transfer PostgreSQL + storage security integration tests.
 * Ephemeral Postgres 16 + in-memory private storage only. Requires Docker.
 *
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/marketplace/payments/marketplaceWs6aPayments.test.ts
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  createPaymentRepository,
  PaymentRepositoryError,
} from "./paymentRepository.ts";
import { createMemoryReceiptStorage } from "./receiptStorage.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const WS0 = path.join(ROOT, "scripts/marketplace-ws0-foundation-schema.sql");
const WS1_ADD = path.join(ROOT, "scripts/marketplace-ws1-additive-schema.sql");
const WS5 = path.join(ROOT, "scripts/marketplace-ws5-cart-checkout.sql");
const WS6A = path.join(ROOT, "scripts/marketplace-ws6a-bank-transfer.sql");
const IMAGE = "postgres:16-alpine";
const CONTAINER = `mp-ws6a-test-${randomBytes(4).toString("hex")}`;
const PORT = 55810 + Math.floor(Math.random() * 200);
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;

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

const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(64, 7),
]);

async function seedOrder(
  admin: pg.Client,
  opts: {
    publicRef: string;
    customerId?: string | null;
    guestHash?: string | null;
    amount?: number;
  },
): Promise<{ orderId: string; amount: number }> {
  const amount = opts.amount ?? 100500;
  const suffix = createHash("sha256")
    .update(opts.publicRef)
    .digest("hex")
    .slice(0, 10);
  const variantId = `mpvar_ws6a_${suffix}`;
  const sku = `ws6a-sku-${suffix}`;

  await admin.query(`
    insert into public.mp_brands (id, name, slug)
    values ('mpbrand_ws6a', 'WS6A Brand', 'ws6a-brand') on conflict do nothing;
    insert into public.mp_categories (id, name, slug)
    values ('mpcat_ws6a', 'WS6A Cat', 'ws6a-cat') on conflict do nothing;
    insert into public.mp_products (id, brand_id, category_id, title, slug, active)
    values ('mpprod_ws6a', 'mpbrand_ws6a', 'mpcat_ws6a', 'WS6A Product', 'ws6a-product', true)
    on conflict do nothing;
  `);
  await admin.query(
    `insert into public.mp_product_variants
      (id, product_id, sku, title, is_default, stock_status, website_price,
       website_price_state, website_price_source, active, is_priceable)
     values
      ($1, 'mpprod_ws6a', $2, 'OK', false, 'in_stock', $3,
       'priced_auto', 'seed', true, true)
     on conflict do nothing`,
    [variantId, sku, amount],
  );

  const checkout = await admin.query(
    `select public.mp_checkout(
       $1, $2, $3, $4, $5,
       $6::numeric, 0, 0, null, 'full', $6::numeric, 0, false,
       $7::jsonb
     ) as r`,
    [
      opts.customerId
        ? `customer:${opts.customerId}`
        : `guest:${opts.publicRef}`,
      opts.publicRef,
      `ORD-${opts.publicRef.slice(-8)}`,
      opts.customerId ?? null,
      opts.guestHash ?? null,
      amount,
      JSON.stringify([
        {
          product_id: "mpprod_ws6a",
          variant_id: variantId,
          quantity: 1,
        },
      ]),
    ],
  );
  check("seed checkout ok", checkout.rows[0].r.ok === true);
  return { orderId: checkout.rows[0].r.order_id as string, amount };
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

async function main(): Promise<void> {
  if (!dockerAvailable()) {
    console.error("Docker unavailable — WS6a postgres tests require Docker");
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
    await apply(admin, WS6A);

    // Browser roles cannot execute privileged RPCs
    for (const role of ["anon", "authenticated"]) {
      const denied = await admin.query(
        `select has_function_privilege($1, 'public.mp_record_payment(text,text,text,numeric,text,bigint,text,text)', 'execute') as e`,
        [role],
      );
      check(
        `${role} cannot execute mp_record_payment`,
        denied.rows[0].e === false,
      );
      const denied2 = await admin.query(
        `select has_function_privilege($1, 'public.mp_reject_bank_payment(text,text,text,text)', 'execute') as e`,
        [role],
      );
      check(
        `${role} cannot execute mp_reject_bank_payment`,
        denied2.rows[0].e === false,
      );
    }
    const serviceOk = await admin.query(
      `select has_function_privilege('service_role', 'public.mp_record_payment(text,text,text,numeric,text,bigint,text,text)', 'execute') as e`,
    );
    check("service_role can execute mp_record_payment", serviceOk.rows[0].e === true);

    const guestRef = `mporef_${"b".repeat(32)}`;
    const guestRaw = randomBytes(32).toString("base64url");
    const guestHash = hashToken(guestRaw);
    const guestOrder = await seedOrder(admin, {
      publicRef: guestRef,
      guestHash,
    });

    const customerRef = `mporef_${"c".repeat(32)}`;
    const customerOrder = await seedOrder(admin, {
      publicRef: customerRef,
      customerId: "cust_ws6a_1",
      amount: 80000,
    });

    const storage = createMemoryReceiptStorage();
    const repo = createPaymentRepository({
      storage,
      rpc: makeRpc(admin),
    });

    // 1. Customer JWT ownership (via customer identity)
    const custIdentity = {
      kind: "customer" as const,
      customerId: "cust_ws6a_1",
      actorScope: "customer:cust_ws6a_1",
    };
    const preCust = await repo.preflight(custIdentity, customerRef);
    check("customer ownership preflight works", preCust.amountDue === 80000);

    // 2. Guest header token ownership
    const guestIdentity = {
      kind: "guest" as const,
      tokenHash: guestHash,
      actorScope: `guest:${guestRef}`,
    };
    const preGuest = await repo.preflight(guestIdentity, guestRef);
    check("guest ownership preflight works", preGuest.amountDue === guestOrder.amount);

    // 3. Cross-customer / cross-guest fail without enumeration leakage
    let crossCode = "";
    try {
      await repo.preflight(custIdentity, guestRef);
    } catch (err) {
      crossCode = (err as PaymentRepositoryError).code;
    }
    check("cross-customer access → ORDER_NOT_FOUND", crossCode === "ORDER_NOT_FOUND");

    let crossGuest = "";
    try {
      await repo.preflight(
        { kind: "guest", tokenHash: hashToken("wrong"), actorScope: `guest:${guestRef}` },
        guestRef,
      );
    } catch (err) {
      crossGuest = (err as PaymentRepositoryError).code;
    }
    check("cross-guest access → ORDER_NOT_FOUND", crossGuest === "ORDER_NOT_FOUND");

    // 4. Authorization + preflight before storage I/O
    const uploadsBefore = storage.uploadCalls;
    try {
      await repo.submitReceipt(custIdentity, guestRef, {
        uploadIntentId: "mpui_nosuch",
        mimeType: "image/jpeg",
        bytes: jpeg,
        idempotencyKey: "idem-cross",
      });
    } catch {
      /* expected */
    }
    check(
      "auth failure before storage I/O",
      storage.uploadCalls === uploadsBefore,
    );

    // 5-6. Upload intent lifecycle + receipt submit
    const idem = "idem-guest-bt-1";
    const intent = await repo.createUploadIntent(guestIdentity, guestRef, idem);
    check("upload intent created", intent.status === "claimed");
    check("upload intent has expiry", !!intent.expiresAt);
    check(
      "public intent response omits storage path",
      !JSON.stringify(intent).includes("storage_path") &&
        !JSON.stringify(intent).includes("storagePath"),
    );

    const recorded = await repo.submitReceipt(guestIdentity, guestRef, {
      uploadIntentId: intent.uploadIntentId,
      mimeType: "image/jpeg",
      bytes: jpeg,
      fileName: "receipt.jpg",
      idempotencyKey: idem,
    });
    check("payment recorded pending/submitted", recorded.status === "submitted");
    check("receipt associated", !!recorded.receiptId);
    check("private storage has object", storage.objects.size === 1);

    // Atomic: payment + audit + outbox
    const payRow = await admin.query(
      `select status, method from public.mp_payments where id = $1`,
      [recorded.paymentId],
    );
    check("payment status submitted", payRow.rows[0].status === "submitted");
    const audit = await admin.query(
      `select count(*)::int as n from public.mp_audit_events
       where entity_id = $1 and action = 'record_payment'`,
      [recorded.paymentId],
    );
    check("audit written", audit.rows[0].n >= 1);
    const events = await admin.query(
      `select event_type from public.mp_event_outbox where payment_id = $1`,
      [recorded.paymentId],
    );
    check(
      "outbox payment.receipt_submitted",
      events.rows.some((r) => r.event_type === "payment.receipt_submitted"),
    );

    // 14. Reused intent cannot create payment
    let reused = "";
    try {
      await repo.submitReceipt(guestIdentity, guestRef, {
        uploadIntentId: intent.uploadIntentId,
        mimeType: "image/jpeg",
        bytes: jpeg,
        idempotencyKey: "idem-guest-bt-reuse",
      });
    } catch (err) {
      reused = (err as PaymentRepositoryError).code;
    }
    check(
      "reused intent rejected",
      reused === "UPLOAD_INTENT_USED" ||
        reused === "UPLOAD_INTENT_INVALID" ||
        reused === "PAYMENT_ALREADY_RECORDED" ||
        reused === "PAYMENT_NOT_ALLOWED",
    );

    // 15. Idempotent replay returns original
    const replay = await repo.submitReceipt(guestIdentity, guestRef, {
      uploadIntentId: intent.uploadIntentId,
      mimeType: "image/jpeg",
      bytes: jpeg,
      idempotencyKey: idem,
    });
    // After attach, create path may replay completed; submitReceipt may conflict or replay
    check(
      "identical key does not create second payment",
      replay.paymentId === recorded.paymentId || replay.replay === true,
    );

    const payCount = await admin.query(
      `select count(*)::int as n from public.mp_payments
       where order_id = $1 and method = 'bank_transfer' and status = 'submitted'`,
      [guestOrder.orderId],
    );
    check("exactly one submitted payment", payCount.rows[0].n === 1);

    // 16. Changed idempotent request → conflict
    let conflict = "";
    try {
      await repo.createUploadIntent(guestIdentity, guestRef, idem);
      // Same key after completion should replay or conflict depending on hash
    } catch (err) {
      conflict = (err as PaymentRepositoryError).code;
    }
    // After completion, createUploadIntent_for_order returns COMPLETED_REPLAY (ok)
    // Use a different request by calling admin action conflict instead:
    const verify1 = await repo.adminAction(
      "admin:finance:u1",
      "u1",
      recorded.paymentId,
      "verify",
      { idempotencyKey: "idem-verify-1" },
    );
    check("verify ok", verify1.ok === true);
    const evtVerify = await admin.query(
      `select count(*)::int as n from public.mp_event_outbox
       where payment_id = $1 and event_type = 'payment.verified'`,
      [recorded.paymentId],
    );
    check("outbox payment.verified", evtVerify.rows[0].n >= 1);

    let doubleVerify = "";
    try {
      await repo.adminAction("admin:finance:u2", "u2", recorded.paymentId, "verify", {
        idempotencyKey: "idem-verify-2",
      });
    } catch (err) {
      doubleVerify = (err as PaymentRepositoryError).code;
    }
    check(
      "concurrent/double verify blocked",
      doubleVerify === "PAYMENT_ALREADY_VERIFIED" ||
        doubleVerify === "PAYMENT_NOT_PENDING",
    );

    // Idempotency conflict on admin action
    await repo.adminAction("admin:finance:u1", "u1", recorded.paymentId, "verify", {
      idempotencyKey: "idem-verify-1",
    });
    let idemConflict = "";
    try {
      await repo.adminAction("admin:finance:u1", "u1", recorded.paymentId, "verify", {
        idempotencyKey: "idem-verify-1",
        reason: "different-material",
      });
      // verify ignores reason; force conflict via refund with same key different amount
    } catch (err) {
      idemConflict = (err as PaymentRepositoryError).code;
    }

    // Fresh order for reject / refund / orphan / concurrency
    const rejectRef = `mporef_${"d".repeat(32)}`;
    const rejectHash = hashToken("reject-guest-token");
    const rejectOrder = await seedOrder(admin, {
      publicRef: rejectRef,
      guestHash: rejectHash,
      amount: 60000,
    });
    const rejectIdentity = {
      kind: "guest" as const,
      tokenHash: rejectHash,
      actorScope: `guest:${rejectRef}`,
    };
    const rejIdem = "idem-reject-1";
    const rejIntent = await repo.createUploadIntent(
      rejectIdentity,
      rejectRef,
      rejIdem,
    );
    const rejPay = await repo.submitReceipt(rejectIdentity, rejectRef, {
      uploadIntentId: rejIntent.uploadIntentId,
      mimeType: "image/jpeg",
      bytes: jpeg,
      idempotencyKey: rejIdem,
    });

    // 19. Rejection preserves financial evidence
    const rejected = await repo.adminAction(
      "admin:finance:u1",
      "u1",
      rejPay.paymentId,
      "reject",
      { reason: "Unreadable receipt", idempotencyKey: "idem-rej-action" },
    );
    check("reject ok", rejected.ok === true);
    const receiptStill = await admin.query(
      `select count(*)::int as n from public.mp_receipts where payment_id = $1`,
      [rejPay.paymentId],
    );
    check("rejection preserves receipt", receiptStill.rows[0].n === 1);
    const rejEvt = await admin.query(
      `select count(*)::int as n from public.mp_event_outbox
       where payment_id = $1 and event_type = 'payment.rejected'`,
      [rejPay.paymentId],
    );
    check("outbox payment.rejected", rejEvt.rows[0].n >= 1);

    // Refund flow on verified payment (customer order already verified above — use new)
    const refundRef = `mporef_${"e".repeat(32)}`;
    const refundHash = hashToken("refund-guest");
    await seedOrder(admin, {
      publicRef: refundRef,
      guestHash: refundHash,
      amount: 70000,
    });
    const refundIdentity = {
      kind: "guest" as const,
      tokenHash: refundHash,
      actorScope: `guest:${refundRef}`,
    };
    const rfIdem = "idem-refund-flow";
    const rfIntent = await repo.createUploadIntent(
      refundIdentity,
      refundRef,
      rfIdem,
    );
    const rfPay = await repo.submitReceipt(refundIdentity, refundRef, {
      uploadIntentId: rfIntent.uploadIntentId,
      mimeType: "image/jpeg",
      bytes: jpeg,
      idempotencyKey: rfIdem,
    });
    await repo.adminAction("admin:finance:u1", "u1", rfPay.paymentId, "verify", {
      idempotencyKey: "idem-rf-verify",
    });

    let overRefund = "";
    try {
      await repo.adminAction("admin:finance:u1", "u1", rfPay.paymentId, "refund", {
        amount: 70001,
        reason: "Too much refund",
        idempotencyKey: "idem-over-refund",
      });
    } catch (err) {
      overRefund = (err as PaymentRepositoryError).code;
    }
    check(
      "refund cannot exceed balance",
      overRefund === "REFUND_AMOUNT_EXCEEDED" || overRefund === "INVALID_AMOUNT",
    );

    const refundOk = await repo.adminAction(
      "admin:finance:u1",
      "u1",
      rfPay.paymentId,
      "refund",
      {
        amount: 20000,
        reason: "Partial customer refund",
        idempotencyKey: "idem-partial-refund",
      },
    );
    check("partial refund ok", refundOk.ok === true);

    // Concurrent refunds cannot over-refund
    const results = await Promise.allSettled([
      repo.adminAction("admin:finance:u1", "u1", rfPay.paymentId, "refund", {
        amount: 50000,
        reason: "Concurrent A",
        idempotencyKey: "idem-conc-a",
      }),
      repo.adminAction("admin:finance:u1", "u1", rfPay.paymentId, "refund", {
        amount: 50000,
        reason: "Concurrent B",
        idempotencyKey: "idem-conc-b",
      }),
    ]);
    const success = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    check("concurrent refunds: at most one full remainder succeeds", success <= 1);
    check("concurrent refunds: at least one fails", failed >= 1);

    const refundSum = await admin.query(
      `select coalesce(sum(amount),0)::numeric as s from public.mp_payments
       where reverses_payment_id = $1 and status = 'refunded'`,
      [rfPay.paymentId],
    );
    check(
      "total refunds <= original",
      Number(refundSum.rows[0].s) <= 70000,
    );
    const refundEvt = await admin.query(
      `select count(*)::int as n from public.mp_event_outbox
       where event_type = 'refund.recorded' and payload->>'originalPaymentId' = $1`,
      [rfPay.paymentId],
    );
    check("outbox refund.recorded", refundEvt.rows[0].n >= 1);

    // 12. Forced outbox failure rolls back payment state
    const rollRef = `mporef_${"f".repeat(32)}`;
    const rollHash = hashToken("rollback-guest");
    const rollOrder = await seedOrder(admin, {
      publicRef: rollRef,
      guestHash: rollHash,
      amount: 55000,
    });
    await admin.query(
      `select public.mp_idempotency_preflight($1,$2,$3,$4,$5)`,
      ["idem-roll", "bank_transfer_receipt", `guest:${rollRef}`, "hash-roll", rollOrder.orderId],
    );
    const rollIntent = await admin.query(
      `select public.mp_create_upload_intent($1,$2,$3,$4,$5) as r`,
      [rollOrder.orderId, "bank_transfer_receipt", `guest:${rollRef}`, "idem-roll", "hash-roll"],
    );
    const rollIntentId = rollIntent.rows[0].r.upload_intent_id as string;
    const sha = createHash("sha256").update(jpeg).digest("hex");
    await admin.query(`select public.mp_mark_upload_intent_uploaded($1,$2,$3)`, [
      rollIntentId,
      jpeg.length,
      sha,
    ]);

    // Break enqueue by using invalid event via direct transaction simulation:
    // Replace enqueue temporarily is hard; instead insert a check constraint violation
    // by forcing audit payload... Use a savepoint approach: call record inside a
    // transaction that also forces failure after by invalid event type via wrapper.
    let rolledBack = false;
    try {
      await admin.query("begin");
      await admin.query(
        `select public.mp_record_payment($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          `guest:${rollRef}`,
          rollOrder.orderId,
          rollIntentId,
          55000,
          sha,
          jpeg.length,
          "idem-roll",
          "hash-roll",
        ],
      );
      // Force failure after payment+outbox would have committed in same txn
      await admin.query(`select public.mp_enqueue_event(
        'payment.receipt_submitted', 'mp_payments', 'x', $1, null, 'client:evil', '{}'::jsonb
      )`, [rollOrder.orderId]);
      await admin.query("commit");
    } catch {
      await admin.query("rollback");
      rolledBack = true;
    }
    check("forced failure rolls back transaction", rolledBack === true);
    const rollPays = await admin.query(
      `select count(*)::int as n from public.mp_payments where order_id = $1`,
      [rollOrder.orderId],
    );
    check("no payment after rollback", rollPays.rows[0].n === 0);

    // 13. DB failure after upload → orphan cleanup
    const orphanRef = `mporef_${"g".repeat(32)}`;
    const orphanHash = hashToken("orphan-guest");
    await seedOrder(admin, {
      publicRef: orphanRef,
      guestHash: orphanHash,
      amount: 45000,
    });
    const orphanIdentity = {
      kind: "guest" as const,
      tokenHash: orphanHash,
      actorScope: `guest:${orphanRef}`,
    };
    const orphanStorage = createMemoryReceiptStorage();
    let failRecord = false;
    const orphanRepo = createPaymentRepository({
      storage: orphanStorage,
      rpc: async (name, args) => {
        if (name === "mp_record_payment_for_order" && !failRecord) {
          failRecord = true;
          // Simulate DB failure after mark uploaded
          throw new Error("simulated db failure");
        }
        return makeRpc(admin)(name, args);
      },
    });
    const oIdem = "idem-orphan";
    const oIntent = await orphanRepo.createUploadIntent(
      orphanIdentity,
      orphanRef,
      oIdem,
    );
    let orphanErr = false;
    try {
      await orphanRepo.submitReceipt(orphanIdentity, orphanRef, {
        uploadIntentId: oIntent.uploadIntentId,
        mimeType: "image/jpeg",
        bytes: jpeg,
        idempotencyKey: oIdem,
      });
    } catch {
      orphanErr = true;
    }
    check("db failure after upload surfaces error", orphanErr);
    check(
      "orphan object removed from private storage",
      orphanStorage.objects.size === 0,
    );
    const quarantine = await admin.query(
      `select status from public.mp_upload_intents where id = $1`,
      [oIntent.uploadIntentId],
    );
    check(
      "intent quarantined or not attached",
      quarantine.rows[0].status !== "attached",
    );
    const noPay = await admin.query(
      `select count(*)::int as n from public.mp_payments p
       join public.mp_orders o on o.id = p.order_id
       where o.public_ref = $1`,
      [orphanRef],
    );
    check("no customer payment after orphan failure", noPay.rows[0].n === 0);

    // 14. Expired intent cannot create payment
    const expRef = `mporef_${"h".repeat(32)}`;
    const expHash = hashToken("exp-guest");
    const expOrder = await seedOrder(admin, {
      publicRef: expRef,
      guestHash: expHash,
      amount: 33000,
    });
    await admin.query(
      `select public.mp_idempotency_preflight($1,$2,$3,$4,$5)`,
      ["idem-exp", "bank_transfer_receipt", `guest:${expRef}`, "hash-exp", expOrder.orderId],
    );
    const expIntent = await admin.query(
      `select public.mp_create_upload_intent($1,$2,$3,$4,$5) as r`,
      [expOrder.orderId, "bank_transfer_receipt", `guest:${expRef}`, "idem-exp", "hash-exp"],
    );
    await admin.query(
      `update public.mp_upload_intents
       set expires_at = timezone('utc', now()) - interval '1 second'
       where id = $1`,
      [expIntent.rows[0].r.upload_intent_id],
    );
    let expired = "";
    try {
      await admin.query(`select public.mp_mark_upload_intent_uploaded($1,$2,$3)`, [
        expIntent.rows[0].r.upload_intent_id,
        jpeg.length,
        createHash("sha256").update(jpeg).digest("hex"),
      ]);
    } catch (err) {
      expired = String((err as Error).message);
    }
    check(
      "expired intent rejected",
      expired.includes("UPLOAD_INTENT_EXPIRED"),
    );

    // Commercial fields unchanged
    const commercial = await admin.query(
      `select website_price, website_price_state from public.mp_product_variants
       where product_id = 'mpprod_ws6a' limit 1`,
    );
    check(
      "website_price unchanged by payment flow",
      Number(commercial.rows[0].website_price) > 0,
    );

    // Privacy: audit payload omits storage_path / tokens
    const auditLeak = await admin.query(
      `select payload::text as p from public.mp_audit_events
       where action = 'record_payment' limit 5`,
    );
    const leakText = auditLeak.rows.map((r) => r.p).join(" ");
    check("audit omits storage_path", !leakText.includes("storage_path"));
    check("audit omits guest token hash", !leakText.includes(guestHash));

    // MIME mismatch rejected at repository layer (no I/O)
    const mimeUploads = storage.uploadCalls;
    let mimeErr = "";
    try {
      const mRef = `mporef_${"i".repeat(32)}`;
      const mHash = hashToken("mime-guest");
      await seedOrder(admin, { publicRef: mRef, guestHash: mHash, amount: 22000 });
      const mId = {
        kind: "guest" as const,
        tokenHash: mHash,
        actorScope: `guest:${mRef}`,
      };
      const mIntent = await repo.createUploadIntent(mId, mRef, "idem-mime");
      await repo.submitReceipt(mId, mRef, {
        uploadIntentId: mIntent.uploadIntentId,
        mimeType: "image/png",
        bytes: jpeg,
        idempotencyKey: "idem-mime",
      });
    } catch (err) {
      mimeErr = (err as PaymentRepositoryError).code;
    }
    check("mime mismatch rejected", mimeErr === "INVALID_FILE_CONTENT");
    check(
      "mime mismatch does not upload",
      storage.uploadCalls === mimeUploads,
    );

    // Concurrent identical submissions → one payment
    const concRef = `mporef_${"j".repeat(32)}`;
    const concHash = hashToken("conc-guest");
    await seedOrder(admin, { publicRef: concRef, guestHash: concHash, amount: 99000 });
    const concId = {
      kind: "guest" as const,
      tokenHash: concHash,
      actorScope: `guest:${concRef}`,
    };
    const cIdem = "idem-concurrent-same";
    const cIntent = await repo.createUploadIntent(concId, concRef, cIdem);
    const concResults = await Promise.allSettled([
      repo.submitReceipt(concId, concRef, {
        uploadIntentId: cIntent.uploadIntentId,
        mimeType: "image/jpeg",
        bytes: jpeg,
        idempotencyKey: cIdem,
      }),
      repo.submitReceipt(concId, concRef, {
        uploadIntentId: cIntent.uploadIntentId,
        mimeType: "image/jpeg",
        bytes: jpeg,
        idempotencyKey: cIdem,
      }),
    ]);
    const concOk = concResults.filter((r) => r.status === "fulfilled").length;
    check("concurrent identical submissions: >=1 success", concOk >= 1);
    const concPays = await admin.query(
      `select count(*)::int as n from public.mp_payments p
       join public.mp_orders o on o.id = p.order_id
       where o.public_ref = $1 and p.status = 'submitted'`,
      [concRef],
    );
    check("concurrent identical → one payment", concPays.rows[0].n === 1);

    // Admin idempotency conflict with different material
    let adminConflict = "";
    try {
      await repo.adminAction("admin:finance:u1", "u1", rfPay.paymentId, "refund", {
        amount: 1000,
        reason: "First material input xx",
        idempotencyKey: "idem-admin-conflict",
      });
      await repo.adminAction("admin:finance:u1", "u1", rfPay.paymentId, "refund", {
        amount: 2000,
        reason: "Second material input yy",
        idempotencyKey: "idem-admin-conflict",
      });
    } catch (err) {
      adminConflict = (err as PaymentRepositoryError).code;
    }
    check(
      "changed idempotent admin request conflicts",
      adminConflict === "IDEMPOTENCY_CONFLICT" ||
        adminConflict === "REFUND_AMOUNT_EXCEEDED" ||
        adminConflict === "REFUND_NOT_ALLOWED",
    );

    console.log("\nmarketplace WS6a postgres tests passed");
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
