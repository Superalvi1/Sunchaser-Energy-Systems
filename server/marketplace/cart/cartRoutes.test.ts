/**
 * WS5 cart route / security tests (no Docker).
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/marketplace/cart/cartRoutes.test.ts
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { isPublicApiRoute } from "../../middleware/publicRoutes.ts";
import { isCustomerAllowedApiRoute } from "../../middleware/customerRoutePolicy.ts";
import { createCartRouter } from "./cartRoutes.ts";
import type { CartRepository } from "./cartRepository.ts";
import { MARKETPLACE_API_VERSION_HEADER } from "./cartTypes.ts";
import {
  generatePossessionToken,
  hashPossessionToken,
  readPossessionTokenFromHeaders,
  verifyPossessionToken,
} from "./possessionToken.ts";
import { hasTokenSmuggling, parseCartItemBody } from "./cartValidation.ts";

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

function buildMemoryRepo(): CartRepository & {
  lastCreate?: { kind: string; hash?: string };
} {
  const repo: CartRepository & {
    lastCreate?: { kind: string; hash?: string };
    carts: Map<string, { tokenHash?: string; customerId?: string }>;
  } = {
    carts: new Map(),
    async createCart(identity) {
      const publicRef = `mpcref_${"a".repeat(32)}`;
      if (identity.kind === "guest") {
        repo.lastCreate = { kind: "guest", hash: identity.tokenHash };
        repo.carts.set(publicRef, { tokenHash: identity.tokenHash });
        return {
          publicRef,
          expiresAt: new Date().toISOString(),
          possessionToken: identity.rawToken,
        };
      }
      repo.lastCreate = { kind: "customer" };
      repo.carts.set(publicRef, { customerId: identity.customerId });
      return { publicRef, expiresAt: new Date().toISOString() };
    },
    async upsertItem(_identity, publicRef, sku, quantity) {
      return { publicRef, sku, quantity, unitPrice: 50000 };
    },
    async quoteDelivery(_identity, publicRef, zoneCode) {
      return {
        publicRef,
        zoneCode,
        subtotal: 50000,
        deliveryCharge: 500,
        codEligible: zoneCode === "LHR",
        grandTotal: 50500,
      };
    },
    async checkout(_identity, input) {
      return {
        publicRef: `mporef_${"b".repeat(32)}`,
        orderNumber: "MPO-TEST",
        cartPublicRef: input.publicRef,
        planType: input.planType,
        zoneCode: input.zoneCode,
        codEligible: true,
        subtotal: 50000,
        deliveryCharge: 500,
        grandTotal: 50500,
        replay: false,
      };
    },
    async getOrder(_identity, publicRef) {
      return {
        publicRef,
        orderNumber: "MPO-TEST",
        status: "pending_payment",
        subtotal: 50000,
        deliveryCharge: 500,
        grandTotal: 50500,
        currency: "PKR",
        items: [],
      };
    },
  };
  return repo;
}

async function withServer(
  env: NodeJS.ProcessEnv,
  repository: CartRepository,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/marketplace", createCartRouter({ env, repository }));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const addr = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function main(): Promise<void> {
  // Possession token helpers
  const raw = generatePossessionToken();
  const hash = hashPossessionToken(raw);
  check("token verifies", verifyPossessionToken(raw, hash));
  check("wrong token fails verify", !verifyPossessionToken("nope", hash));
  check(
    "header X-Marketplace-Token",
    readPossessionTokenFromHeaders({ "x-marketplace-token": raw }) === raw,
  );
  check(
    "header Authorization Marketplace",
    readPossessionTokenFromHeaders({
      authorization: `Marketplace ${raw}`,
    }) === raw,
  );
  check(
    "Bearer not treated as possession",
    readPossessionTokenFromHeaders({ authorization: `Bearer ${raw}` }) === null,
  );

  check(
    "query token smuggling detected",
    hasTokenSmuggling({ token: "x" }, {}),
  );
  check(
    "body token smuggling detected",
    hasTokenSmuggling({}, { possessionToken: "x" }),
  );
  check(
    "clean body allowed",
    !hasTokenSmuggling({}, { sku: "abc", quantity: 1 }),
  );

  const badPrice = parseCartItemBody({
    sku: "abc",
    quantity: 1,
    unitPrice: 1,
  });
  check("client unitPrice rejected", badPrice.ok === false);

  check(
    "marketplace prefix is public",
    isPublicApiRoute("POST", "/api/marketplace/cart"),
  );
  check(
    "marketplace allowed for customers",
    isCustomerAllowedApiRoute("/api/marketplace/checkout"),
  );

  await withServer({ MARKETPLACE_ENABLED: "false" }, buildMemoryRepo(), async (base) => {
    const res = await fetch(`${base}/api/marketplace/cart`, { method: "POST" });
    const body = await res.json();
    check("disabled 503", res.status === 503);
    check("disabled envelope", body.ok === false);
  });

  const repo = buildMemoryRepo();
  await withServer(
    { MARKETPLACE_ENABLED: "true", MARKETPLACE_CART_ENABLED: "true" },
    repo,
    async (base) => {
    const create = await fetch(`${base}/api/marketplace/cart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const created = await create.json();
    check("create 201", create.status === 201);
    check("create ok", created.ok === true);
    check(
      "version header",
      create.headers.get(MARKETPLACE_API_VERSION_HEADER) === "1",
    );
    check(
      "raw token once",
      typeof created.data.possessionToken === "string" &&
        created.data.possessionToken.length > 20,
    );
    const token = created.data.possessionToken as string;
    const publicRef = created.data.publicRef as string;

    // Body token rejected
    const bodyTok = await fetch(
      `${base}/api/marketplace/cart/${publicRef}/items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sku: "ws5-sku-ok",
          quantity: 1,
          token,
        }),
      },
    );
    check("body token rejected", bodyTok.status === 400);

    // Query token rejected
    const qTok = await fetch(
      `${base}/api/marketplace/cart/${publicRef}/items?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Marketplace-Token": token,
        },
        body: JSON.stringify({ sku: "ws5-sku-ok", quantity: 1 }),
      },
    );
    check("query token rejected", qTok.status === 400);

    // Header token accepted
    const add = await fetch(`${base}/api/marketplace/cart/${publicRef}/items`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Marketplace-Token": token,
      },
      body: JSON.stringify({ sku: "ws5-sku-ok", quantity: 2 }),
    });
    const added = await add.json();
    check("header token add ok", add.status === 200 && added.ok === true);

    // Client commercial fields rejected
    const priced = await fetch(
      `${base}/api/marketplace/cart/${publicRef}/items`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Marketplace-Token": token,
        },
        body: JSON.stringify({
          sku: "ws5-sku-ok",
          quantity: 1,
          websitePrice: 1,
          margin: 9,
        }),
      },
    );
    check("commercial fields rejected", priced.status === 400);

    // Missing token
    const missing = await fetch(
      `${base}/api/marketplace/cart/${publicRef}/items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sku: "ws5-sku-ok", quantity: 1 }),
      },
    );
    check("missing token 401", missing.status === 401);

    // Delivery quote
    const quote = await fetch(`${base}/api/marketplace/delivery/quote`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Marketplace-Token": token,
      },
      body: JSON.stringify({ publicRef, zoneCode: "LHR" }),
    });
    const quoteBody = await quote.json();
    check(
      "delivery quote ok",
      quote.status === 200 &&
        quoteBody.data.deliveryCharge === 500 &&
        quoteBody.data.codEligible === true,
    );

    // Checkout requires idempotency
    const noIdem = await fetch(`${base}/api/marketplace/checkout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Marketplace-Token": token,
      },
      body: JSON.stringify({
        publicRef,
        zoneCode: "LHR",
        planType: "full",
      }),
    });
    check("idempotency required", noIdem.status === 400);

    const checkout = await fetch(`${base}/api/marketplace/checkout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Marketplace-Token": token,
        "Idempotency-Key": "route-idem-1",
      },
      body: JSON.stringify({
        publicRef,
        zoneCode: "LHR",
        planType: "full",
      }),
    });
    const checked = await checkout.json();
    check("checkout ok", checkout.status === 201 && checked.ok === true);
    check(
      "checkout dto has no costs",
      !JSON.stringify(checked).includes("actual_purchase_cost") &&
        !JSON.stringify(checked).includes("margin"),
    );

    const orderRef = checked.data.publicRef as string;
    const order = await fetch(`${base}/api/marketplace/orders/${orderRef}`, {
      headers: { Authorization: `Marketplace ${token}` },
    });
    check("order get ok", order.status === 200);

    // Enumeration-ish unknown order
    const unknown = await fetch(
      `${base}/api/marketplace/orders/mporef_${"c".repeat(32)}`,
      { headers: { "X-Marketplace-Token": token } },
    );
    // memory repo returns ok; ensure route shape still envelopes
    check("order route responds", unknown.status === 200 || unknown.status === 404);
  });

  console.log("cartRoutes.test.ts: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
