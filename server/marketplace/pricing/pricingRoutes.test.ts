/**
 * WS3 pricing route authorization tests (memory repository).
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { signAccessToken } from "../../auth/jwt.ts";
import { createAuthorizationMiddleware } from "../../middleware/authorization.ts";
import { setDynamicRolePermissions } from "../../../src/lib/roles.ts";
import { MARKETPLACE_API_VERSION_HEADER } from "../catalogue/catalogueTypes.ts";
import { createMarketplacePricingRouter } from "./pricingRoutes.ts";
import type { PricingRepository } from "./pricingRepository.ts";

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "marketplace-ws3-pricing-test-secret-min-32!!";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";

const USERS = [
  {
    id: "u-sa",
    username: "super",
    name: "Super",
    email: "sa@test.com",
    role: "Super Admin",
    account_status: "Approved",
  },
  {
    id: "u-adm",
    username: "admin",
    name: "Admin",
    email: "adm@test.com",
    role: "Admin",
    account_status: "Approved",
  },
];

function memoryRepo(): PricingRepository {
  return {
    async listCosts() {
      return [];
    },
    async createCost() {
      return {
        id: "mpcost_1",
        productId: "p1",
        variantId: "v1",
        actualPurchaseCost: 1,
        currency: "PKR",
        effectiveFrom: new Date().toISOString(),
        effectiveTo: null,
        setBy: "u-sa",
        reason: null,
      };
    },
    async updateCost() {
      throw new Error("unused");
    },
    async getMargin() {
      return {
        variantId: "v1",
        productId: "p1",
        websitePrice: 100,
        websitePriceState: "priced_auto",
        actualPurchaseCost: 40,
        profit: 60,
        marginPct: 0.6,
        purchasable: true,
      };
    },
    async publishPrice() {
      return {
        variantId: "v1",
        productId: "p1",
        websitePrice: 100,
        websitePriceState: "priced_auto",
        websitePriceSource: "kamal",
      };
    },
    async createOverride() {
      return { overrideId: "o1", supersededOverrideId: null };
    },
    async revokeOverride() {
      return { overrideId: "o1", supersededOverrideId: null };
    },
    async getPricingConfig() {
      return {
        companyId: "sunchaser",
        maxIncreasePct: 15,
        maxDecreasePct: 25,
        stalenessHours: 36,
        allowSoldoutReference: false,
        safetyAbsoluteFloor: null,
        safetyAbsoluteCeiling: null,
        minTokenPct: 10,
        maxTokenPct: 40,
        minAdvancePct: 20,
        maxAdvancePct: 70,
        codMaxOrderValue: 250000,
        updatedBy: null,
        updatedAt: new Date().toISOString(),
      };
    },
    async updatePricingConfig() {
      return this.getPricingConfig();
    },
    async upsertSupplierMapping() {
      return { mappingId: "m1", action: "supplier_mapping.created" };
    },
  };
}

async function withServer(
  env: NodeJS.ProcessEnv,
  fn: (base: string, tokens: Record<string, string>) => Promise<void>,
) {
  setDynamicRolePermissions(null);
  const app = express();
  app.use(express.json());
  app.use(
    createAuthorizationMiddleware({
      resolveLocalDb: () => ({ users: USERS }) as any,
    }),
  );
  app.use(
    "/api/marketplace/admin",
    createMarketplacePricingRouter({
      env: { ...process.env, MARKETPLACE_ENABLED: "true", ...env },
      repository: memoryRepo(),
    }),
  );
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const tokens: Record<string, string> = {};
  for (const u of USERS) {
    tokens[u.username] = signAccessToken({
      userId: u.id,
      username: u.username,
      role: u.role,
    });
  }
  try {
    await fn(base, tokens);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

async function api(
  base: string,
  path: string,
  token?: string,
  method = "GET",
  body?: unknown,
) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return {
    status: res.status,
    body: await res.json(),
    headers: res.headers,
  };
}

await withServer({}, async (base, tokens) => {
  const unauth = await api(base, "/api/marketplace/admin/costs");
  assert.equal(unauth.status, 401);
  console.log("ok - missing JWT → 401");

  const staff = await api(
    base,
    "/api/marketplace/admin/costs",
    tokens.admin,
  );
  assert.equal(staff.status, 403);
  console.log("ok - Admin with marketplace but not Super Admin → 403");

  const sa = await api(base, "/api/marketplace/admin/costs", tokens.super);
  assert.equal(sa.status, 200);
  assert.equal(sa.body.ok, true);
  assert.equal(sa.headers.get(MARKETPLACE_API_VERSION_HEADER), "1");
  console.log("ok - Super Admin can list costs");

  const forbidden = await api(
    base,
    "/api/marketplace/admin/costs",
    tokens.super,
    "POST",
    { variantId: "v1", actualPurchaseCost: 1, websitePrice: 9 },
  );
  assert.equal(forbidden.status, 400);
  assert.equal(forbidden.body.error.code, "FORBIDDEN_FIELD");
  console.log("ok - websitePrice rejected on cost create");
});

await withServer({ MARKETPLACE_ENABLED: "false" }, async (base, tokens) => {
  const res = await api(base, "/api/marketplace/admin/costs", tokens.super);
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, "MARKETPLACE_DISABLED");
  console.log("ok - feature disabled → 503");
});

console.log("\nWS3 pricing route tests passed.");
