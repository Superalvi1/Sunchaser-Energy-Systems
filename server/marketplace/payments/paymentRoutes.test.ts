/**
 * WS6a payment route / RBAC / idempotency / privacy tests (no Docker).
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/marketplace/payments/paymentRoutes.test.ts
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response } from "express";
import { isPublicApiRoute } from "../../middleware/publicRoutes.ts";
import { isCustomerAllowedApiRoute } from "../../middleware/customerRoutePolicy.ts";
import { MARKETPLACE_API_VERSION_HEADER } from "./paymentTypes.ts";
import { createPaymentRouter } from "./paymentRoutes.ts";
import type { PaymentRepository } from "./paymentRepository.ts";
import { PaymentRepositoryError } from "./paymentRepository.ts";
import {
  hasTokenSmuggling,
  parseReceiptJsonBody,
} from "./paymentValidation.ts";
import {
  isMarketplaceFinanceRole,
  createMarketplaceRouteLockdown,
} from "./marketplaceRouteLockdown.ts";
import type { RequestActor } from "../../middleware/actor.ts";

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

function buildMemoryRepo(): PaymentRepository & {
  storageIoBeforeAuth: boolean;
  lastIdem?: string;
} {
  const repo: PaymentRepository & {
    storageIoBeforeAuth: boolean;
    lastIdem?: string;
    calls: string[];
  } = {
    storageIoBeforeAuth: false,
    calls: [],
    async preflight(identity, publicRef) {
      repo.calls.push("preflight");
      if (publicRef.includes("other")) {
        throw new PaymentRepositoryError("ORDER_NOT_FOUND", "Order not found.");
      }
      return {
        publicRef,
        orderStatus: "pending_payment",
        planType: "full",
        paymentMethod: "bank_transfer",
        currency: "PKR",
        amountDue: 50000,
        grandTotal: 50000,
        netPaid: 0,
        receiptConstraints: {
          allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf"],
          maxBytes: 5242880,
        },
      };
    },
    async createUploadIntent(_identity, publicRef, idempotencyKey) {
      repo.calls.push("createUploadIntent");
      repo.lastIdem = idempotencyKey;
      return {
        uploadIntentId: "mpui_testintent01",
        status: "claimed",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf"],
        maxBytes: 5242880,
        amountDue: 50000,
        currency: "PKR",
        replay: false,
      };
    },
    async submitReceipt(_identity, _publicRef, input) {
      repo.calls.push("submitReceipt");
      repo.lastIdem = input.idempotencyKey;
      return {
        paymentId: "mppay_testpay01",
        receiptId: "mprct_testreceipt01",
        status: "submitted",
        replay: false,
      };
    },
    async listOrderPayments(_identity, publicRef) {
      return [
        {
          paymentId: "mppay_testpay01",
          amount: 50000,
          method: "bank_transfer",
          status: "submitted",
          createdAt: new Date().toISOString(),
          hasReceipt: true,
        },
      ];
    },
    async adminListPayments() {
      return [];
    },
    async adminAction(_scope, _actorId, paymentId, action) {
      return { ok: true, paymentId, action, replay: false };
    },
    async getIntentStoragePath() {
      repo.storageIoBeforeAuth = true;
      return "mp-receipts/abcdef012345/mpui_testintent01";
    },
  };
  return repo;
}

async function withServer(
  env: NodeJS.ProcessEnv,
  repository: PaymentRepository,
  fn: (base: string) => Promise<void>,
  actor?: RequestActor,
): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  if (actor) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.actor = actor;
      next();
    });
  }
  app.use("/api/marketplace", createPaymentRouter({ env, repository }));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(base);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

const ref = `mporef_${"a".repeat(32)}`;
const jpegB64 = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(16, 1),
]).toString("base64");

check(
  "admin marketplace routes are not public",
  isPublicApiRoute("GET", "/api/marketplace/admin/payments") === false,
);
check(
  "customer payment preflight remains public",
  isPublicApiRoute("POST", `/api/marketplace/orders/${ref}/payments/preflight`) ===
    true,
);
check(
  "customers cannot access marketplace admin",
  isCustomerAllowedApiRoute("/api/marketplace/admin/payments") === false,
);
check(
  "Accounts Manager is finance role",
  isMarketplaceFinanceRole("Accounts Manager") === true,
);
check(
  "Sales is not finance role",
  isMarketplaceFinanceRole("Sales") === false,
);

check(
  "query possession token smuggling detected",
  hasTokenSmuggling({ token: "x" }, {}) === true,
);
check(
  "body possession token smuggling detected",
  hasTokenSmuggling({}, { possessionToken: "x" }) === true,
);

const polluted = parseReceiptJsonBody({
  uploadIntentId: "mpui_x",
  mimeType: "image/jpeg",
  contentBase64: "aa",
  __proto__: { admin: true },
});
check("prototype pollution key rejected", polluted.ok === false);

const pathBody = parseReceiptJsonBody({
  uploadIntentId: "mpui_x",
  mimeType: "image/jpeg",
  contentBase64: "aa",
  storagePath: "evil",
});
check("caller storagePath rejected", pathBody.ok === false);

await withServer(
  { MARKETPLACE_ENABLED: "true" },
  buildMemoryRepo(),
  async (base) => {
    const missing = await fetch(
      `${base}/api/marketplace/orders/${ref}/payments/preflight`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    const missingJson = await missing.json();
    check(
      "missing auth returns non-enumerating not found",
      missing.status === 404 && missingJson.error?.code === "ORDER_NOT_FOUND",
    );
    check(
      "API version header set",
      missing.headers.get(MARKETPLACE_API_VERSION_HEADER) === "1",
    );

    const smuggle = await fetch(
      `${base}/api/marketplace/orders/${ref}/payments/preflight?token=abc`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-marketplace-token": "guest-token-value",
        },
        body: "{}",
      },
    );
    const smuggleJson = await smuggle.json();
    check(
      "query token rejected",
      smuggle.status === 400 && smuggleJson.error?.code === "VALIDATION_ERROR",
    );

    const noIdem = await fetch(
      `${base}/api/marketplace/orders/${ref}/payments/upload-intent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-marketplace-token": "guest-token-value",
        },
        body: "{}",
      },
    );
    const noIdemJson = await noIdem.json();
    check(
      "idempotency key required",
      noIdem.status === 400 &&
        noIdemJson.error?.code === "IDEMPOTENCY_KEY_REQUIRED",
    );
  },
);

const financeActor: RequestActor = {
  id: "u-finance",
  username: "finance",
  name: "Finance",
  email: "f@example.com",
  role: "Accounts Manager",
  accountStatus: "Active",
  emailVerified: true,
  onboardingCompleted: true,
  authMethod: "jwt",
};

await withServer(
  { MARKETPLACE_ENABLED: "true" },
  buildMemoryRepo(),
  async (base) => {
    const res = await fetch(`${base}/api/marketplace/admin/payments`, {
      headers: { authorization: "Bearer unused-in-test" },
    });
    const json = await res.json();
    check("admin list succeeds for finance actor", res.status === 200 && json.ok === true);
  },
  financeActor,
);

await withServer(
  { MARKETPLACE_ENABLED: "true" },
  buildMemoryRepo(),
  async (base) => {
    const res = await fetch(`${base}/api/marketplace/admin/payments`);
    const json = await res.json();
    check(
      "admin without actor forbidden",
      res.status === 401 && json.error?.code === "INVALID_TOKEN",
    );
  },
);

const salesActor: RequestActor = {
  ...financeActor,
  id: "u-sales",
  username: "sales",
  role: "Sales",
};

await withServer(
  { MARKETPLACE_ENABLED: "true" },
  buildMemoryRepo(),
  async (base) => {
    const res = await fetch(`${base}/api/marketplace/admin/payments`);
    const json = await res.json();
    check(
      "non-finance staff forbidden",
      res.status === 403 && json.error?.code === "ORDER_NOT_AUTHORIZED",
    );
  },
  salesActor,
);

// Lockdown unit: disabled marketplace
{
  const mw = createMarketplaceRouteLockdown({ marketplaceEnabled: false });
  let status = 0;
  let body: any;
  mw(
    { actor: financeActor } as Request,
    {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    } as Response,
    () => {
      status = 200;
    },
  );
  check(
    "lockdown blocks when marketplace disabled",
    status === 503 && body.error.code === "MARKETPLACE_DISABLED",
  );
}

check(
  "responses must not advertise private storage paths in validation helpers",
  !JSON.stringify(parseReceiptJsonBody({
    uploadIntentId: "mpui_abc",
    mimeType: "image/jpeg",
    contentBase64: jpegB64,
  })).includes("storagePath"),
);

console.log("\npaymentRoutes tests passed");
