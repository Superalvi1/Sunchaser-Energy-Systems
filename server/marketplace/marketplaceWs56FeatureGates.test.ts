/**
 * Proves CEO auto-import can enable independently of WS5/WS6.
 * Cart, payments, and COD must fail closed without their feature flags
 * and must not touch repositories/DB while disabled.
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createCartRouter } from "./cart/cartRoutes.ts";
import type { CartRepository } from "./cart/cartRepository.ts";
import { createPaymentRouter } from "./payments/paymentRoutes.ts";
import type { PaymentRepository } from "./payments/paymentRepository.ts";
import { createCodRouter } from "./cod/codRoutes.ts";
import type { CodRepository } from "./cod/codRepository.ts";
import { createMarketplaceAutoImportRouter } from "./autoImport/autoImportRoutes.ts";
import {
  isMarketplaceCartEnabled,
  isMarketplaceCodEnabled,
  isMarketplacePaymentsEnabled,
  readMarketplaceConfig,
} from "./marketplaceConfig.ts";

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

function throwRepo<T extends object>(label: string): T {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return undefined;
        throw new Error(`${label} repository method invoked while disabled: ${String(prop)}`);
      },
    },
  ) as T;
}

async function listen(app: express.Express): Promise<{
  base: string;
  close: () => Promise<void>;
}> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

const autoImportFlags = {
  MARKETPLACE_ENABLED: "true",
  MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
  MARKETPLACE_CEO_AUTO_IMPORT_PERSIST: "true",
};

{
  const cfg = readMarketplaceConfig(autoImportFlags);
  check("auto-import env leaves cart disabled", isMarketplaceCartEnabled(cfg) === false);
  check(
    "auto-import env leaves payments disabled",
    isMarketplacePaymentsEnabled(cfg) === false,
  );
  check("auto-import env leaves COD disabled", isMarketplaceCodEnabled(cfg) === false);
}

{
  const cfg = readMarketplaceConfig({
    MARKETPLACE_CART_ENABLED: "true",
    MARKETPLACE_PAYMENTS_ENABLED: "true",
    MARKETPLACE_COD_ENABLED: "true",
  });
  check("feature flags alone do not enable cart", isMarketplaceCartEnabled(cfg) === false);
  check(
    "feature flags alone do not enable payments",
    isMarketplacePaymentsEnabled(cfg) === false,
  );
  check("feature flags alone do not enable COD", isMarketplaceCodEnabled(cfg) === false);
}

{
  const cfg = readMarketplaceConfig({
    MARKETPLACE_ENABLED: "true",
    MARKETPLACE_CART_ENABLED: "false",
    MARKETPLACE_PAYMENTS_ENABLED: "0",
    MARKETPLACE_COD_ENABLED: "",
  });
  check("explicit false/empty cart fail closed", isMarketplaceCartEnabled(cfg) === false);
  check(
    "explicit false/empty payments fail closed",
    isMarketplacePaymentsEnabled(cfg) === false,
  );
  check("missing COD fail closed", isMarketplaceCodEnabled(cfg) === false);
}

{
  const app = express();
  app.use(express.json());
  app.use(
    "/api/marketplace",
    createCartRouter({
      env: autoImportFlags,
      repository: throwRepo<CartRepository>("cart"),
    }),
  );
  app.use(
    "/api/marketplace",
    createPaymentRouter({
      env: autoImportFlags,
      repository: throwRepo<PaymentRepository>("payments"),
    }),
  );
  app.use(
    "/api/marketplace",
    createCodRouter({
      env: autoImportFlags,
      repository: throwRepo<CodRepository>("cod"),
    }),
  );

  const { base, close } = await listen(app);
  try {
    const cart = await fetch(`${base}/api/marketplace/cart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const cartBody = await cart.json();
    check("cart disabled 503 under auto-import flags", cart.status === 503);
    check(
      "cart disabled code",
      cartBody?.error?.code === "MARKETPLACE_CART_DISABLED",
    );

    const pay = await fetch(
      `${base}/api/marketplace/orders/mporef_${"a".repeat(32)}/payments/preflight`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    const payBody = await pay.json();
    check("payments disabled 503 under auto-import flags", pay.status === 503);
    check(
      "payments disabled code",
      payBody?.error?.code === "MARKETPLACE_PAYMENTS_DISABLED",
    );

    const cod = await fetch(
      `${base}/api/marketplace/orders/mporef_${"b".repeat(32)}/cod/confirm`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "gate-test-1",
        },
        body: "{}",
      },
    );
    const codBody = await cod.json();
    check("COD disabled 503 under auto-import flags", cod.status === 503);
    check("COD disabled code", codBody?.error?.code === "MARKETPLACE_COD_DISABLED");
  } finally {
    await close();
  }
}

{
  // Auto-import router remains reachable when marketplace + CEO flags are on
  // without enabling WS5/WS6 feature flags.
  const service = {
    async runAutomaticImport() {
      return {
        ok: true,
        runId: "test-run",
        discovered: 0,
        accepted: 0,
        rejected: 0,
        exactMatchGroups: 0,
        keptSeparate: 0,
        persisted: 0,
        errors: [],
        note: null,
      };
    },
    async getHealth() {
      return {
        enabled: true,
        persist: true,
        lastRun: null,
        listingCount: 0,
      };
    },
    async listListings() {
      return [];
    },
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & {
      actor?: {
        id: string;
        username: string;
        role: string;
        name: string;
        email: string;
        accountStatus: string;
        emailVerified: boolean;
        onboardingCompleted: boolean;
        authMethod: string;
      };
    }).actor = {
      id: "sa-1",
      username: "superadmin",
      role: "Super Admin",
      name: "Super Admin",
      email: "sa@test.com",
      accountStatus: "Approved",
      emailVerified: true,
      onboardingCompleted: true,
      authMethod: "jwt",
    };
    next();
  });
  app.use(
    "/api/marketplace/admin",
    createMarketplaceAutoImportRouter({
      env: autoImportFlags,
      service: service as never,
    }),
  );

  const { base, close } = await listen(app);
  try {
    const health = await fetch(
      `${base}/api/marketplace/admin/suppliers/auto-import/health`,
    );
    const body = await health.json();
    check("auto-import health succeeds independently", health.status === 200);
    check("auto-import health ok envelope", body.ok === true);
    check(
      "auto-import not cart-disabled",
      body?.error?.code !== "MARKETPLACE_CART_DISABLED",
    );
    check(
      "auto-import not payments-disabled",
      body?.error?.code !== "MARKETPLACE_PAYMENTS_DISABLED",
    );
    check(
      "auto-import not COD-disabled",
      body?.error?.code !== "MARKETPLACE_COD_DISABLED",
    );
  } finally {
    await close();
  }
}

console.log("marketplaceWs56FeatureGates.test.ts: all checks passed");
