/**
 * WS6b COD route / RBAC / validation tests (no Docker).
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response } from "express";
import { isPublicApiRoute } from "../../middleware/publicRoutes.ts";
import { isCustomerAllowedApiRoute } from "../../middleware/customerRoutePolicy.ts";
import { createCodRouter } from "./codRoutes.ts";
import type { CodRepository } from "./codRepository.ts";
import { CodRepositoryError } from "./codRepository.ts";
import { hasTokenSmuggling, parseReasonBody } from "./codValidation.ts";
import {
  createCodRouteLockdown,
  isMarketplaceFinanceRole,
  isMarketplaceOpsRole,
} from "./codLockdown.ts";
import type { RequestActor } from "../../middleware/actor.ts";
import { MARKETPLACE_API_VERSION_HEADER } from "./codTypes.ts";

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

function buildRepo(): CodRepository {
  return {
    async get(_i, publicRef) {
      return {
        publicRef,
        orderStatus: "confirmed",
        fulfillmentState: "cod_confirmed",
        planType: "cod_eligible",
        paymentMethod: "cash_on_delivery",
        amountDue: 50500,
        currency: "PKR",
        grandTotal: 50500,
        deliveryCharge: 500,
        codEligibleZone: true,
        paymentStatus: "pending",
        deliveryAttemptCount: 0,
        codConfirmedAt: new Date().toISOString(),
        dispatchedAt: null,
      };
    },
    async confirm(_i, publicRef) {
      return {
        publicRef,
        orderStatus: "confirmed",
        fulfillmentState: "cod_confirmed",
        paymentStatus: "pending",
        amountDue: 50500,
        currency: "PKR",
        replay: false,
      };
    },
    async adminList() {
      return [];
    },
    async adminTransition(_s, _a, publicRef, action) {
      if (action === "collect" && publicRef.includes("deny")) {
        throw new CodRepositoryError(
          "ORDER_NOT_AUTHORIZED",
          "Not authorized.",
        );
      }
      return {
        publicRef,
        orderStatus: action === "collect" ? "delivered" : "dispatched",
        fulfillmentState: action === "collect" ? "collected" : "dispatched",
        paymentStatus: action === "collect" ? "collected" : "pending",
        replay: false,
      };
    },
  };
}

async function withServer(
  env: NodeJS.ProcessEnv,
  repository: CodRepository,
  actor: RequestActor | undefined,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  if (actor) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.actor = actor;
      next();
    });
  }
  app.use("/api/marketplace", createCodRouter({ env, repository }));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

const ref = `mporef_${"a".repeat(32)}`;

check(
  "admin cod routes are not public",
  isPublicApiRoute("GET", "/api/marketplace/admin/cod/orders") === false,
);
check(
  "customer cod confirm remains public prefix",
  isPublicApiRoute("POST", `/api/marketplace/orders/${ref}/cod/confirm`) === true,
);
check(
  "customers cannot access admin COD",
  isCustomerAllowedApiRoute("/api/marketplace/admin/cod/orders") === false,
);
check("Sales is ops role", isMarketplaceOpsRole("Sales") === true);
check(
  "Sales is not finance role",
  isMarketplaceFinanceRole("Sales") === false,
);
check(
  "Accounts Manager is finance",
  isMarketplaceFinanceRole("Accounts Manager") === true,
);
check(
  "query token smuggling detected",
  hasTokenSmuggling({ token: "x" }, {}) === true,
);
check(
  "client amount forbidden",
  parseReasonBody({ reason: "ok reason", amount: 1 }).ok === false,
);

const financeActor: RequestActor = {
  id: "u-fin",
  username: "fin",
  name: "Fin",
  email: "f@x.com",
  role: "Accounts Manager",
  accountStatus: "Active",
  emailVerified: true,
  onboardingCompleted: true,
  authMethod: "jwt",
};

const salesActor: RequestActor = {
  ...financeActor,
  id: "u-sales",
  username: "sales",
  role: "Sales",
};

await withServer(
  { MARKETPLACE_ENABLED: "true" },
  buildRepo(),
  undefined,
  async (base) => {
    const res = await fetch(
      `${base}/api/marketplace/orders/${ref}/cod/confirm`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem-missing-auth",
        },
        body: "{}",
      },
    );
    const json = await res.json();
    check(
      "missing auth non-enumerating",
      res.status === 404 && json.error?.code === "ORDER_NOT_FOUND",
    );
    check(
      "version header",
      res.headers.get(MARKETPLACE_API_VERSION_HEADER) === "1",
    );

    const smuggle = await fetch(
      `${base}/api/marketplace/orders/${ref}/cod?token=abc`,
      { headers: { "x-marketplace-token": "guest" } },
    );
    check("query token rejected", (await smuggle.json()).error?.code === "VALIDATION_ERROR");
  },
);

await withServer(
  { MARKETPLACE_ENABLED: "true" },
  buildRepo(),
  salesActor,
  async (base) => {
    const dispatch = await fetch(
      `${base}/api/marketplace/admin/cod/orders/${ref}/dispatch`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem-d1",
        },
        body: "{}",
      },
    );
    check("ops can dispatch", dispatch.status === 200);

    const collect = await fetch(
      `${base}/api/marketplace/admin/cod/orders/${ref}/collect`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem-c1",
        },
        body: "{}",
      },
    );
    const collectJson = await collect.json();
    check(
      "ops cannot collect",
      collect.status === 403 &&
        collectJson.error?.code === "ORDER_NOT_AUTHORIZED",
    );
  },
);

await withServer(
  { MARKETPLACE_ENABLED: "true" },
  buildRepo(),
  financeActor,
  async (base) => {
    const collect = await fetch(
      `${base}/api/marketplace/admin/cod/orders/${ref}/collect`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem-c2",
        },
        body: "{}",
      },
    );
    check("finance can collect", collect.status === 200);
  },
);

{
  const mw = createCodRouteLockdown({
    marketplaceEnabled: false,
    mode: "ops",
  });
  let status = 0;
  mw(
    { actor: salesActor } as Request,
    {
      status(code: number) {
        status = code;
        return this;
      },
      json() {
        return this;
      },
    } as Response,
    () => {
      status = 200;
    },
  );
  check("lockdown disabled marketplace", status === 503);
}

console.log("\ncodRoutes tests passed");
