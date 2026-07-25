/**
 * WS2B marketplace admin access-boundary tests (no Docker).
 * Run: npm run test:marketplace-ws2
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { signAccessToken } from "../../auth/jwt.ts";
import { createAuthorizationMiddleware } from "../../middleware/authorization.ts";
import {
  ALL_PERMISSION_KEYS,
  ROLE_PERMISSIONS,
  roleHasPermission,
  setDynamicRolePermissions,
} from "../../../src/lib/roles.ts";
import { createCatalogueRouter } from "../catalogue/catalogueRoutes.ts";
import type { CatalogueRepository } from "../catalogue/catalogueRepository.ts";
import { CatalogueRepositoryError } from "../catalogue/catalogueRepository.ts";
import {
  MARKETPLACE_API_VERSION,
  MARKETPLACE_API_VERSION_HEADER,
  type CatalogueBrandDto,
  type CatalogueCategoryDto,
} from "../catalogue/catalogueTypes.ts";
import { createMarketplaceAdminRouter } from "./adminRoutes.ts";
import { canAccessMarketplaceAdmin } from "../MarketplacePermissions.ts";
import type { RequestActor } from "../../middleware/actor.ts";

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "marketplace-ws2-admin-test-secret-min-32!!";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";

const brandsFixture: CatalogueBrandDto[] = [
  { slug: "knox", name: "Knox" },
  { slug: "growatt", name: "Growatt" },
].sort((a, b) => a.name.localeCompare(b.name));

const categoriesFixture: CatalogueCategoryDto[] = [
  {
    slug: "solar-inverters",
    name: "Solar Inverters",
    description: "Inverters",
    sortOrder: 1,
  },
  {
    slug: "solar-panels",
    name: "Solar Panels",
    description: "Panels",
    sortOrder: 2,
  },
];

function memoryRepo(
  overrides: Partial<CatalogueRepository> = {},
): CatalogueRepository {
  return {
    async listBrands() {
      return brandsFixture;
    },
    async listCategories() {
      return categoriesFixture;
    },
    async listProducts() {
      return [];
    },
    async getProductBySlug() {
      return null;
    },
    ...overrides,
  };
}

function userRow(partial: {
  id: string;
  username: string;
  role: string;
  account_status?: string;
}) {
  return {
    id: partial.id,
    username: partial.username,
    name: partial.username,
    email: `${partial.username}@test.com`,
    role: partial.role,
    account_status: partial.account_status ?? "Approved",
  };
}

const USERS = [
  userRow({ id: "u-sa", username: "superadmin", role: "Super Admin" }),
  userRow({ id: "u-dir", username: "director", role: "Director" }),
  userRow({ id: "u-adm", username: "admin", role: "Admin" }),
  userRow({ id: "u-acc", username: "accounts", role: "Accounts Manager" }),
  userRow({ id: "u-sm", username: "salesmgr", role: "Sales Manager" }),
  userRow({ id: "u-tech", username: "tech", role: "Technician" }),
];

function mockDb(users: unknown[] = USERS) {
  return { users } as any;
}

type HttpResult = { status: number; body: any; headers: Headers };

async function withAdminServer(
  opts: {
    env?: NodeJS.ProcessEnv;
    repository?: CatalogueRepository;
    mountCatalogue?: boolean;
  },
  fn: (base: string, tokens: Record<string, string>) => Promise<void>,
): Promise<void> {
  setDynamicRolePermissions(null);
  const env = {
    ...process.env,
    MARKETPLACE_ENABLED: "true",
    ...(opts.env || {}),
  };
  const app = express();
  app.use(express.json());
  app.use(
    createAuthorizationMiddleware({
      resolveLocalDb: () => mockDb(),
    }),
  );
  app.use(
    "/api/marketplace/admin",
    createMarketplaceAdminRouter({
      env,
      repository: opts.repository ?? memoryRepo(),
    }),
  );
  if (opts.mountCatalogue) {
    app.use(
      "/api/marketplace/catalogue",
      createCatalogueRouter({
        env,
        repository: memoryRepo(),
      }),
    );
  }

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
  opts: { token?: string; authHeader?: string } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (opts.authHeader) headers.authorization = opts.authHeader;
  else if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${base}${path}`, { headers });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

function actor(role: string, status = "Approved"): RequestActor {
  return {
    id: "u1",
    username: "u1",
    name: "U",
    email: "u@test.com",
    role,
    accountStatus: status,
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
  };
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    throw err;
  }
}

await test("1. missing JWT → 401", async () => {
  await withAdminServer({}, async (base) => {
    const res = await api(base, "/api/marketplace/admin/brands");
    assert.equal(res.status, 401);
  });
});

await test("2. invalid JWT → 401", async () => {
  await withAdminServer({}, async (base) => {
    const res = await api(base, "/api/marketplace/admin/categories", {
      authHeader: "Bearer not-a-valid-jwt",
    });
    assert.equal(res.status, 401);
  });
});

await test("3. authenticated actor without marketplace → 403", async () => {
  await withAdminServer({}, async (base, tokens) => {
    const res = await api(base, "/api/marketplace/admin/brands", {
      token: tokens.salesmgr,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error.code, "FORBIDDEN");
  });
});

async function assertCanAccessBoth(
  roleKey: "superadmin" | "director" | "admin" | "accounts",
): Promise<void> {
  await withAdminServer({}, async (base, tokens) => {
    for (const path of [
      "/api/marketplace/admin/brands",
      "/api/marketplace/admin/categories",
    ]) {
      const res = await api(base, path, { token: tokens[roleKey] });
      assert.equal(res.status, 200, `${roleKey} ${path}`);
      assert.equal(res.body.ok, true);
      assert.ok(Array.isArray(res.body.data));
    }
  });
}

await test("4. Super Admin can access both endpoints", async () => {
  await assertCanAccessBoth("superadmin");
});

await test("5. Director can access both endpoints", async () => {
  await assertCanAccessBoth("director");
});

await test("6. Admin can access both endpoints", async () => {
  await assertCanAccessBoth("admin");
});

await test("7. Accounts Manager can access both endpoints", async () => {
  await assertCanAccessBoth("accounts");
});

await test("8. unrelated role remains forbidden", async () => {
  assert.equal(canAccessMarketplaceAdmin(actor("Technician")), false);
  assert.equal(canAccessMarketplaceAdmin(actor("Sales Executive")), false);
  await withAdminServer({}, async (base, tokens) => {
    const res = await api(base, "/api/marketplace/admin/categories", {
      token: tokens.tech,
    });
    assert.equal(res.status, 403);
  });
});

await test("9. feature-disabled lockdown returns 503 MARKETPLACE_DISABLED", async () => {
  await withAdminServer(
    { env: { MARKETPLACE_ENABLED: "false" } },
    async (base, tokens) => {
      const res = await api(base, "/api/marketplace/admin/brands", {
        token: tokens.admin,
      });
      assert.equal(res.status, 503);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error.code, "MARKETPLACE_DISABLED");
      assert.equal(
        res.headers.get(MARKETPLACE_API_VERSION_HEADER),
        MARKETPLACE_API_VERSION,
      );
    },
  );
});

await test("10. successful responses contain X-Marketplace-API-Version: 1", async () => {
  await withAdminServer({}, async (base, tokens) => {
    const res = await api(base, "/api/marketplace/admin/brands", {
      token: tokens.admin,
    });
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get(MARKETPLACE_API_VERSION_HEADER),
      MARKETPLACE_API_VERSION,
    );
  });
});

await test("11. brands/categories use marketplace repository schema, not CRM products", async () => {
  let brandsCalled = false;
  let categoriesCalled = false;
  const repo = memoryRepo({
    async listBrands() {
      brandsCalled = true;
      return brandsFixture;
    },
    async listCategories() {
      categoriesCalled = true;
      return categoriesFixture;
    },
    async listProducts() {
      throw new Error("CRM products path must not be used");
    },
  });
  await withAdminServer({ repository: repo }, async (base, tokens) => {
    const brands = await api(base, "/api/marketplace/admin/brands", {
      token: tokens.admin,
    });
    const cats = await api(base, "/api/marketplace/admin/categories", {
      token: tokens.admin,
    });
    assert.equal(brands.status, 200);
    assert.equal(cats.status, 200);
    assert.equal(brandsCalled, true);
    assert.equal(categoriesCalled, true);
    assert.deepEqual(brands.body.data, brandsFixture);
    assert.deepEqual(cats.body.data, categoriesFixture);
    assert.equal(
      brands.body.data.every(
        (b: CatalogueBrandDto) =>
          typeof b.slug === "string" && typeof b.name === "string",
      ),
      true,
    );
    assert.equal(
      cats.body.data.every(
        (c: CatalogueCategoryDto) =>
          typeof c.sortOrder === "number" && typeof c.slug === "string",
      ),
      true,
    );
  });
});

await test("12. repository failures return sanitized envelopes", async () => {
  const repo = memoryRepo({
    async listBrands() {
      throw new CatalogueRepositoryError(
        "CATALOGUE_UNAVAILABLE",
        "Catalogue database is unavailable.",
      );
    },
    async listCategories() {
      throw new Error("ECONNREFUSED postgres://secret@internal/db");
    },
  });
  await withAdminServer({ repository: repo }, async (base, tokens) => {
    const brands = await api(base, "/api/marketplace/admin/brands", {
      token: tokens.admin,
    });
    assert.equal(brands.status, 503);
    assert.equal(brands.body.ok, false);
    assert.equal(brands.body.error.code, "CATALOGUE_UNAVAILABLE");
    assert.equal(
      JSON.stringify(brands.body).includes("postgres://"),
      false,
    );

    const cats = await api(base, "/api/marketplace/admin/categories", {
      token: tokens.admin,
    });
    assert.equal(cats.status, 500);
    assert.equal(cats.body.ok, false);
    assert.equal(cats.body.error.code, "ADMIN_QUERY_FAILED");
    assert.equal(cats.body.error.message.includes("ECONNREFUSED"), false);
    assert.equal(cats.body.error.message.includes("secret"), false);
  });
});

await test("13. existing marketplace public catalogue routes remain unaffected", async () => {
  await withAdminServer({ mountCatalogue: true }, async (base, tokens) => {
    // Public catalogue still works with MARKETPLACE_ENABLED and does not require marketplace permission.
    // Under auth middleware it needs JWT; Sales Manager (no marketplace) can still hit catalogue.
    const cat = await api(base, "/api/marketplace/catalogue/brands", {
      token: tokens.salesmgr,
    });
    assert.equal(cat.status, 200);
    assert.equal(cat.body.ok, true);
    assert.ok(Array.isArray(cat.body.data));
    assert.equal(
      cat.headers.get(MARKETPLACE_API_VERSION_HEADER),
      MARKETPLACE_API_VERSION,
    );

    // Admin still requires marketplace permission
    const denied = await api(base, "/api/marketplace/admin/brands", {
      token: tokens.salesmgr,
    });
    assert.equal(denied.status, 403);
  });
});

await test("14. existing permissions unchanged except additive marketplace key", () => {
  assert.ok(ALL_PERMISSION_KEYS.includes("marketplace"));
  assert.ok(ALL_PERMISSION_KEYS.includes("products"));
  assert.equal(roleHasPermission("Super Admin", "marketplace"), true);
  assert.equal(roleHasPermission("Director", "marketplace"), true);
  assert.equal(roleHasPermission("Admin", "marketplace"), true);
  assert.equal(roleHasPermission("Accounts Manager", "marketplace"), true);
  assert.equal(roleHasPermission("Sales Manager", "marketplace"), false);
  assert.equal(roleHasPermission("Sales Executive", "marketplace"), false);
  assert.equal(roleHasPermission("Technician", "marketplace"), false);
  assert.equal(roleHasPermission("Customer", "marketplace"), false);

  // Accounts Manager gained marketplace only — still no products permission
  assert.equal(roleHasPermission("Accounts Manager", "products"), false);
  assert.ok(ROLE_PERMISSIONS["Accounts Manager"].includes("marketplace"));
  assert.equal(
    ROLE_PERMISSIONS["Accounts Manager"].includes("products"),
    false,
  );

  // Admin still has products (CRM) and now marketplace
  assert.equal(roleHasPermission("Admin", "products"), true);
  assert.ok(ROLE_PERMISSIONS.Admin.includes("marketplace"));

  // Sales Manager matrix unchanged aside from not receiving marketplace
  assert.deepEqual(ROLE_PERMISSIONS["Sales Manager"], [
    "crm_leads",
    "sales_quotes",
    "admin_dashboard",
    "invoices",
    "reports",
  ]);
});

console.log("\nWS2B admin access foundation tests passed.");
