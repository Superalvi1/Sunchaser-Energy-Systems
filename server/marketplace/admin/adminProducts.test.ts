/**
 * WS2C marketplace admin product/variant tests (no Docker).
 * Run: npm run test:marketplace-ws2
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { signAccessToken } from "../../auth/jwt.ts";
import { createAuthorizationMiddleware } from "../../middleware/authorization.ts";
import { setDynamicRolePermissions } from "../../../src/lib/roles.ts";
import type { CatalogueRepository } from "../catalogue/catalogueRepository.ts";
import {
  MARKETPLACE_API_VERSION,
  MARKETPLACE_API_VERSION_HEADER,
} from "../catalogue/catalogueTypes.ts";
import { createMarketplaceAdminRouter } from "./adminRoutes.ts";
import {
  createMemoryAdminProductRepository,
  createMemoryAdminStore,
  type MemoryAdminStore,
} from "./memoryAdminProductRepository.ts";
import { parseCreateProductBody } from "./adminValidation.ts";
import { AdminProductError } from "./adminTypes.ts";

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "marketplace-ws2c-product-test-secret-min-32!!";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";

const FORBIDDEN_PAIRS: Array<[string, unknown]> = [
  ["display_from_price", 1],
  ["displayFromPrice", 1],
  ["display_price_state", "priced_auto"],
  ["displayPriceState", "priced_auto"],
  ["website_price", 100],
  ["websitePrice", 100],
  ["website_price_state", "priced_auto"],
  ["websitePriceState", "priced_auto"],
  ["website_price_source", "seed"],
  ["websitePriceSource", "seed"],
  ["price_published_at", "2026-01-01"],
  ["pricePublishedAt", "2026-01-01"],
  ["stock_status", "in_stock"],
  ["stockStatus", "in_stock"],
  ["supplier_public_price", 1],
  ["supplierPublicPrice", 1],
  ["actual_purchase_cost", 1],
  ["actualPurchaseCost", 1],
  ["profit", 1],
  ["margin", 1],
  ["delivery_charge", 1],
  ["deliveryCharge", 1],
  ["priceOverride", {}],
  ["price_overrides", []],
  ["supplierObservation", {}],
  ["supplierMapping", {}],
];

function userRow(partial: {
  id: string;
  username: string;
  role: string;
}) {
  return {
    id: partial.id,
    username: partial.username,
    name: partial.username,
    email: `${partial.username}@test.com`,
    role: partial.role,
    account_status: "Approved",
  };
}

const USERS = [
  userRow({ id: "u-adm", username: "admin", role: "Admin" }),
  userRow({ id: "u-sm", username: "salesmgr", role: "Sales Manager" }),
];

function taxonomyRepo(store: MemoryAdminStore): CatalogueRepository {
  return {
    async listBrands() {
      return store.brands.map((b) => ({ slug: b.slug, name: b.name }));
    },
    async listCategories() {
      return store.categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        description: c.description,
        sortOrder: c.sortOrder,
      }));
    },
    async listProducts() {
      throw new Error("CRM/legacy products path must not be used");
    },
    async getProductBySlug() {
      return null;
    },
  };
}

type HttpResult = { status: number; body: any; headers: Headers };

async function withServer(
  store: MemoryAdminStore,
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
    createMarketplaceAdminRouter({
      env: { ...process.env, MARKETPLACE_ENABLED: "true", ...env },
      repository: taxonomyRepo(store),
      productRepository: createMemoryAdminProductRepository(store),
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
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; authHeader?: string } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (opts.authHeader) headers.authorization = opts.authHeader;
  else if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

function validCreate(overrides: Record<string, unknown> = {}) {
  return {
    brandId: "mpbrand_knox",
    categoryId: "mpcat_inverters",
    title: "Test Inverter",
    slug: "test-inverter-ws2c",
    description: "A test product",
    tags: ["hybrid"],
    active: true,
    featured: false,
    defaultVariant: {
      sku: "SC-TEST_INVERTER_WS2C",
      title: "Default",
      isDefault: true,
      isPriceable: true,
      active: true,
    },
    ...overrides,
  };
}

function assertNoForbiddenInResponse(payload: unknown) {
  const text = JSON.stringify(payload);
  for (const key of [
    "websitePrice",
    "website_price",
    "stockStatus",
    "stock_status",
    "actualPurchaseCost",
    "margin",
    "deliveryCharge",
    "supplierPublicPrice",
  ]) {
    assert.equal(text.includes(`"${key}"`), false, `leaked ${key}`);
  }
}

function assertNoForbiddenWrites(store: MemoryAdminStore) {
  for (const payload of store.writePayloads) {
    for (const key of Object.keys(payload)) {
      assert.equal(
        [
          "website_price",
          "website_price_state",
          "website_price_source",
          "price_published_at",
          "stock_status",
          "display_from_price",
          "display_price_state",
          "actual_purchase_cost",
          "margin",
          "delivery_charge",
        ].includes(key),
        false,
        `wrote forbidden column ${key}`,
      );
    }
  }
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    throw err;
  }
}

await test("1. missing/invalid JWT remains 401", async () => {
  const store = createMemoryAdminStore();
  await withServer(store, {}, async (base) => {
    const missing = await api(base, "GET", "/api/marketplace/admin/products");
    assert.equal(missing.status, 401);
    const invalid = await api(base, "GET", "/api/marketplace/admin/products", {
      authHeader: "Bearer not-valid",
    });
    assert.equal(invalid.status, 401);
  });
});

await test("2. actor without marketplace permission remains 403", async () => {
  const store = createMemoryAdminStore();
  await withServer(store, {}, async (base, tokens) => {
    const res = await api(base, "GET", "/api/marketplace/admin/products", {
      token: tokens.salesmgr,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "FORBIDDEN");
  });
});

await test("3. feature-disabled behavior remains 503 MARKETPLACE_DISABLED", async () => {
  const store = createMemoryAdminStore();
  await withServer(
    store,
    { MARKETPLACE_ENABLED: "false" },
    async (base, tokens) => {
      const res = await api(base, "GET", "/api/marketplace/admin/products", {
        token: tokens.admin,
      });
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, "MARKETPLACE_DISABLED");
      assert.equal(
        res.headers.get(MARKETPLACE_API_VERSION_HEADER),
        MARKETPLACE_API_VERSION,
      );
    },
  );
});

await test("4-7. permitted staff list/read/create/patch products via mp_* repo", async () => {
  const store = createMemoryAdminStore();
  await withServer(store, {}, async (base, tokens) => {
    const created = await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: validCreate(),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.ok, true);
    assert.equal(created.body.data.slug, "test-inverter-ws2c");
    assert.equal(created.body.data.variants.length, 1);
    assertNoForbiddenInResponse(created.body);

    const list = await api(base, "GET", "/api/marketplace/admin/products", {
      token: tokens.admin,
    });
    assert.equal(list.status, 200);
    assert.equal(list.body.data.items.length, 1);
    assert.equal(store.products.length, 1);
    assert.equal(store.variants.length, 1);

    const detail = await api(
      base,
      "GET",
      `/api/marketplace/admin/products/${created.body.data.id}`,
      { token: tokens.admin },
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.title, "Test Inverter");

    const patched = await api(
      base,
      "PATCH",
      `/api/marketplace/admin/products/${created.body.data.id}`,
      {
        token: tokens.admin,
        body: { title: "Updated Inverter", featured: true },
      },
    );
    assert.equal(patched.status, 200);
    assert.equal(patched.body.data.title, "Updated Inverter");
    assert.equal(patched.body.data.featured, true);
    assert.equal(patched.body.data.slug, "test-inverter-ws2c");
  });
  assertNoForbiddenWrites(store);
});

await test("8. existing slug cannot be patched", async () => {
  const store = createMemoryAdminStore();
  await withServer(store, {}, async (base, tokens) => {
    const created = await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: validCreate(),
    });
    const res = await api(
      base,
      "PATCH",
      `/api/marketplace/admin/products/${created.body.data.id}`,
      {
        token: tokens.admin,
        body: { slug: "test-inverter-ws2c" },
      },
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "FORBIDDEN_FIELD");
  });
});

await test("9. duplicate slug is rejected", async () => {
  const store = createMemoryAdminStore();
  await withServer(store, {}, async (base, tokens) => {
    await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: validCreate(),
    });
    const res = await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: validCreate({
        defaultVariant: {
          sku: "SC-OTHER_SKU",
          title: "Default",
          isDefault: true,
          isPriceable: true,
          active: true,
        },
      }),
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "DUPLICATE_SLUG");
  });
});

await test("10. duplicate SKU is rejected", async () => {
  const store = createMemoryAdminStore();
  await withServer(store, {}, async (base, tokens) => {
    await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: validCreate(),
    });
    const res = await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: validCreate({ slug: "other-product" }),
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "DUPLICATE_SKU");
  });
});

await test("11. invalid brand/category relationships are rejected", async () => {
  const store = createMemoryAdminStore();
  await withServer(store, {}, async (base, tokens) => {
    const badBrand = await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: validCreate({ brandId: "missing-brand" }),
    });
    assert.equal(badBrand.body.error.code, "INVALID_RELATIONSHIP");
    const badCat = await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: validCreate({
        slug: "other",
        categoryId: "missing-cat",
        defaultVariant: {
          sku: "SC-OTHER",
          title: "D",
          isDefault: true,
          isPriceable: true,
          active: true,
        },
      }),
    });
    assert.equal(badCat.body.error.code, "INVALID_RELATIONSHIP");
  });
});

await test("12-13. unknown top-level and nested fields rejected", async () => {
  const store = createMemoryAdminStore();
  await withServer(store, {}, async (base, tokens) => {
    const top = await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: { ...validCreate(), unexpected: true },
    });
    assert.equal(top.body.error.code, "UNKNOWN_FIELD");
    const nested = await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: validCreate({
        defaultVariant: {
          sku: "SC-X",
          title: "D",
          isDefault: true,
          isPriceable: true,
          active: true,
          extra: 1,
        },
      }),
    });
    assert.equal(nested.body.error.code, "UNKNOWN_FIELD");
  });
});

await test("14. every forbidden commercial field rejected snake+camel", async () => {
  const store = createMemoryAdminStore();
  await withServer(store, {}, async (base, tokens) => {
    for (const [key, value] of FORBIDDEN_PAIRS) {
      const res = await api(base, "POST", "/api/marketplace/admin/products", {
        token: tokens.admin,
        body: { ...validCreate({ slug: `slug-${key.toLowerCase()}` }), [key]: value },
      });
      assert.equal(res.status, 400, key);
      assert.equal(res.body.error.code, "FORBIDDEN_FIELD", key);
    }
  });
});

await test("15. mass-assignment and prototype-pollution rejected", async () => {
  for (const key of ["__proto__", "prototype", "constructor"]) {
    const body = {
      ...validCreate({ slug: `pollute-${key}` }),
      [key]: { polluted: true },
    };
    assert.throws(
      () => parseCreateProductBody(body),
      (err: unknown) =>
        err instanceof AdminProductError && err.code === "UNKNOWN_FIELD",
    );
  }
  const store = createMemoryAdminStore();
  await withServer(store, {}, async (base, tokens) => {
    const mass = await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: {
        ...validCreate({
          slug: "mass-assign",
          defaultVariant: {
            sku: "SC-MASS",
            title: "D",
            isDefault: true,
            isPriceable: true,
            active: true,
          },
        }),
        id: "client-id",
        createdAt: "2020-01-01",
        role: "Super Admin",
        permissions: ["marketplace"],
      },
    });
    assert.equal(mass.status, 400);
    assert.equal(mass.body.error.code, "FORBIDDEN_FIELD");
  });
});

await test("16. product/variant relationship mismatches rejected", async () => {
  const store = createMemoryAdminStore();
  await withServer(store, {}, async (base, tokens) => {
    const a = await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: validCreate(),
    });
    const b = await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: validCreate({
        slug: "second-product",
        defaultVariant: {
          sku: "SC-SECOND",
          title: "D",
          isDefault: true,
          isPriceable: true,
          active: true,
        },
      }),
    });
    const mismatch = await api(
      base,
      "PATCH",
      `/api/marketplace/admin/products/${a.body.data.id}/variants/${b.body.data.variants[0].id}`,
      { token: tokens.admin, body: { title: "Nope" } },
    );
    assert.equal(mismatch.status, 404);
    assert.equal(mismatch.body.error.code, "VARIANT_NOT_FOUND");
  });
});

await test("17-19. single active default invariant + reassignment", async () => {
  const store = createMemoryAdminStore();
  await withServer(store, {}, async (base, tokens) => {
    const created = await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: validCreate(),
    });
    const productId = created.body.data.id;
    const v1 = created.body.data.variants[0].id;

    const deactivateSole = await api(
      base,
      "PATCH",
      `/api/marketplace/admin/products/${productId}/variants/${v1}`,
      { token: tokens.admin, body: { active: false } },
    );
    assert.equal(deactivateSole.status, 400);
    assert.equal(deactivateSole.body.error.code, "DEFAULT_VARIANT_REQUIRED");

    const v2res = await api(
      base,
      "POST",
      `/api/marketplace/admin/products/${productId}/variants`,
      {
        token: tokens.admin,
        body: {
          sku: "SC-SECOND_VAR",
          title: "Alt",
          isDefault: true,
          isPriceable: true,
          active: true,
        },
      },
    );
    assert.equal(v2res.status, 201);
    const detail = await api(
      base,
      "GET",
      `/api/marketplace/admin/products/${productId}`,
      { token: tokens.admin },
    );
    const defaults = detail.body.data.variants.filter(
      (v: any) => v.isDefault && v.active,
    );
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0].id, v2res.body.data.id);

    // Concurrent reassignment: both succeed or one CONFLICT; never >1 default
    const v2 = v2res.body.data.id;
    const [r1, r2] = await Promise.all([
      api(
        base,
        "PATCH",
        `/api/marketplace/admin/products/${productId}/variants/${v1}`,
        { token: tokens.admin, body: { isDefault: true, active: true } },
      ),
      api(
        base,
        "PATCH",
        `/api/marketplace/admin/products/${productId}/variants/${v2}`,
        { token: tokens.admin, body: { isDefault: true, active: true } },
      ),
    ]);
    assert.ok([200, 409].includes(r1.status));
    assert.ok([200, 409].includes(r2.status));
    const after = await api(
      base,
      "GET",
      `/api/marketplace/admin/products/${productId}`,
      { token: tokens.admin },
    );
    assert.equal(
      after.body.data.variants.filter((v: any) => v.isDefault && v.active)
        .length,
      1,
    );
  });
});

await test("20. failed nested creation leaves no partial product", async () => {
  const store = createMemoryAdminStore();
  const repo = createMemoryAdminProductRepository(store);
  await assert.rejects(
    () =>
      repo.createProduct(
        validCreate({
          slug: "partial-fail",
          defaultVariant: {
            sku: "SC-PARTIAL",
            title: "D",
            isDefault: true,
            isPriceable: true,
            active: true,
          },
          __failVariant: true,
        } as any),
        { id: "u-adm", username: "admin", role: "Admin" },
      ),
  );
  assert.equal(store.products.length, 0);
  assert.equal(store.variants.length, 0);
});

await test("21-22. audit identity server-derived; payload safe", async () => {
  const store = createMemoryAdminStore();
  await withServer(store, {}, async (base, tokens) => {
    await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: {
        ...validCreate(),
        actor: { id: "attacker", role: "Super Admin" },
      },
    }).then((res) => {
      // actor key forbidden/unknown
      assert.equal(res.status, 400);
    });
    await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: validCreate({ slug: "audit-ok", defaultVariant: {
        sku: "SC-AUDIT_OK",
        title: "D",
        isDefault: true,
        isPriceable: true,
        active: true,
      } }),
    });
    assert.ok(store.audits.length >= 2);
    for (const a of store.audits) {
      assert.equal(a.actorScope, "staff:u-adm");
      assert.equal(a.isFinancial, false);
      assert.equal(a.payload.actorId, "u-adm");
      assert.equal(a.payload.actorUsername, "admin");
      const text = JSON.stringify(a.payload);
      assert.equal(text.includes("Bearer"), false);
      assert.equal(text.includes("website_price"), false);
      assert.equal(text.includes("password"), false);
    }
  });
});

await test("23-24. responses omit forbidden fields; version header on success/error", async () => {
  const store = createMemoryAdminStore();
  await withServer(store, {}, async (base, tokens) => {
    const ok = await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: validCreate(),
    });
    assert.equal(
      ok.headers.get(MARKETPLACE_API_VERSION_HEADER),
      MARKETPLACE_API_VERSION,
    );
    assertNoForbiddenInResponse(ok.body);

    const err = await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: { nope: true },
    });
    assert.equal(err.status, 400);
    assert.equal(
      err.headers.get(MARKETPLACE_API_VERSION_HEADER),
      MARKETPLACE_API_VERSION,
    );
  });
});

await test("25. WS2B brands/categories behavior remains passing", async () => {
  const store = createMemoryAdminStore();
  await withServer(store, {}, async (base, tokens) => {
    const brands = await api(base, "GET", "/api/marketplace/admin/brands", {
      token: tokens.admin,
    });
    const cats = await api(base, "GET", "/api/marketplace/admin/categories", {
      token: tokens.admin,
    });
    assert.equal(brands.status, 200);
    assert.equal(cats.status, 200);
    assert.ok(Array.isArray(brands.body.data));
    assert.ok(Array.isArray(cats.body.data));
  });
});

await test("27. no price columns change during any WS2C operation", async () => {
  const store = createMemoryAdminStore();
  await withServer(store, {}, async (base, tokens) => {
    const created = await api(base, "POST", "/api/marketplace/admin/products", {
      token: tokens.admin,
      body: validCreate(),
    });
    const id = created.body.data.id;
    const vid = created.body.data.variants[0].id;
    await api(base, "PATCH", `/api/marketplace/admin/products/${id}`, {
      token: tokens.admin,
      body: { description: "x" },
    });
    await api(
      base,
      "POST",
      `/api/marketplace/admin/products/${id}/variants`,
      {
        token: tokens.admin,
        body: {
          sku: "SC-ALT",
          title: "Alt",
          isDefault: false,
          isPriceable: true,
          active: true,
        },
      },
    );
    await api(
      base,
      "PATCH",
      `/api/marketplace/admin/products/${id}/variants/${vid}`,
      { token: tokens.admin, body: { title: "Default 2" } },
    );
  });
  assertNoForbiddenWrites(store);
});

console.log("\nWS2C admin product backend tests passed.");
