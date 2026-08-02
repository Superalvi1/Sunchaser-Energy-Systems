/**
 * P0 publication gate: MARKETPLACE_CATALOGUE_SOURCE selects static vs database
 * for every public catalogue consumer.
 *
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/marketplace/catalogue/catalogueSourceGate.test.ts
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createCatalogueRouter } from "./catalogueRoutes.ts";
import { createStaticCatalogueRepository } from "./staticCatalogueRepository.ts";
import type { CatalogueRepository } from "./catalogueRepository.ts";
import type { CatalogueProductDto } from "./catalogueTypes.ts";
import { WS1_SEED_PRODUCTS, WS1_SEED_SLUGS } from "./catalogueSeedData.ts";
import {
  publicWouldShowSyncedProducts,
  readCatalogueSource,
  readMarketplaceConfig,
} from "../marketplaceConfig.ts";
import { findLegacySnapshotGaps } from "../autoImport/legacySnapshotDiagnostic.ts";
import type { AutoImportListingRecord } from "../autoImport/autoImportTypes.ts";

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

const DB_ONLY_SLUG = "auto-import-db-only-product-xyz";
const DB_ONLY_PRODUCT: CatalogueProductDto = {
  slug: DB_ONLY_SLUG,
  title: "Auto-imported DB-only Product",
  description: "Auto-imported from public supplier catalogues (CEO-authorized).",
  brand: { slug: "alladin-store", name: "Alladin Store" },
  category: {
    slug: "wire-clip",
    name: "Wire Clip",
    description: null,
    sortOrder: 1,
  },
  tags: ["auto-import", "alladin"],
  featured: false,
  specifications: {},
  warranty: null,
  image: null,
  images: [],
  defaultVariant: {
    sku: "SC-AUTO-DBONLY",
    title: "Default",
    isDefault: true,
    websitePrice: 699,
    websitePriceState: "priced_auto",
    websitePriceSource: "alladin",
    stockStatus: "in_stock",
  },
};

function trackingRepo(
  base: CatalogueRepository,
  counter: { calls: number },
): CatalogueRepository {
  return {
    async listCategories() {
      counter.calls += 1;
      return base.listCategories();
    },
    async listBrands() {
      counter.calls += 1;
      return base.listBrands();
    },
    async listProducts(filters) {
      counter.calls += 1;
      return base.listProducts(filters);
    },
    async getProductBySlug(slug) {
      counter.calls += 1;
      return base.getProductBySlug(slug);
    },
  };
}

function buildDatabaseRepo(): CatalogueRepository {
  const staticRepo = createStaticCatalogueRepository();
  return {
    async listCategories() {
      return staticRepo.listCategories();
    },
    async listBrands() {
      return staticRepo.listBrands();
    },
    async listProducts(filters) {
      const seed = await staticRepo.listProducts(filters);
      const extra =
        (!filters.category || filters.category === DB_ONLY_PRODUCT.category.slug) &&
        (!filters.brand || filters.brand === DB_ONLY_PRODUCT.brand.slug) &&
        (filters.featured === undefined ||
          filters.featured === DB_ONLY_PRODUCT.featured)
          ? [DB_ONLY_PRODUCT]
          : [];
      return [...seed, ...extra];
    },
    async getProductBySlug(slug) {
      if (slug === DB_ONLY_SLUG) return DB_ONLY_PRODUCT;
      return staticRepo.getProductBySlug(slug);
    },
  };
}

async function withServer(
  env: NodeJS.ProcessEnv,
  factories: {
    createStaticRepository?: () => CatalogueRepository;
    createDatabaseRepository?: () => CatalogueRepository;
  },
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(
    "/api/marketplace/catalogue",
    createCatalogueRouter({
      env,
      createStaticRepository: factories.createStaticRepository,
      createDatabaseRepository: factories.createDatabaseRepository,
    }),
  );
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
  // Config fail-closed
  check(
    "unset catalogue source → static",
    readCatalogueSource({}) === "static",
  );
  check(
    "empty catalogue source → static",
    readCatalogueSource({ MARKETPLACE_CATALOGUE_SOURCE: "" }) === "static",
  );
  check(
    "invalid catalogue source → static",
    readCatalogueSource({ MARKETPLACE_CATALOGUE_SOURCE: "live-db" }) === "static",
  );
  check(
    "DATABASE uppercase not accepted unless exact database",
    readCatalogueSource({ MARKETPLACE_CATALOGUE_SOURCE: "DATABASE" }) ===
      "database",
  );
  check(
    "publicWouldShowSyncedProducts false for static",
    publicWouldShowSyncedProducts(readMarketplaceConfig({})) === false,
  );
  check(
    "publicWouldShowSyncedProducts true for database",
    publicWouldShowSyncedProducts(
      readMarketplaceConfig({ MARKETPLACE_CATALOGUE_SOURCE: "database" }),
    ) === true,
  );

  // A: static — seed returned, DB repo not called, DB-only slug 404
  {
    const dbCalls = { calls: 0 };
    const staticCalls = { calls: 0 };
    await withServer(
      {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CATALOGUE_SOURCE: "static",
      },
      {
        createStaticRepository: () =>
          trackingRepo(createStaticCatalogueRepository(), staticCalls),
        createDatabaseRepository: () =>
          trackingRepo(buildDatabaseRepo(), dbCalls),
      },
      async (base) => {
        const pub = await fetch(`${base}/api/marketplace/catalogue/publication`);
        const pubBody = await pub.json();
        check("A publication HTTP 200", pub.status === 200);
        check(
          "A effective source static",
          pubBody.data.effectivePublicCatalogueSource === "static",
        );
        check(
          "A publicWouldShowSyncedProducts false",
          pubBody.data.publicWouldShowSyncedProducts === false,
        );

        const list = await fetch(`${base}/api/marketplace/catalogue/products`);
        const listBody = await list.json();
        check("A products HTTP 200", list.status === 200);
        check(
          "A returns WS1 seed count",
          Array.isArray(listBody.data) &&
            listBody.data.length === WS1_SEED_PRODUCTS.length,
        );
        check(
          "A no auto-import tags",
          listBody.data.every(
            (p: CatalogueProductDto) => !(p.tags || []).includes("auto-import"),
          ),
        );
        check(
          "A no DB-only product in list",
          !listBody.data.some((p: CatalogueProductDto) => p.slug === DB_ONLY_SLUG),
        );
        check("A database repository not called", dbCalls.calls === 0);
        check("A static repository was called", staticCalls.calls > 0);

        const detail = await fetch(
          `${base}/api/marketplace/catalogue/products/${DB_ONLY_SLUG}`,
        );
        const detailBody = await detail.json();
        check("A DB-only slug HTTP 404", detail.status === 404);
        check(
          "A DB-only slug PRODUCT_NOT_FOUND",
          detailBody.error?.code === "PRODUCT_NOT_FOUND",
        );
        check("A DB repo still unused after slug miss", dbCalls.calls === 0);

        const seedSlug = WS1_SEED_SLUGS[0]!;
        const seedDetail = await fetch(
          `${base}/api/marketplace/catalogue/products/${seedSlug}`,
        );
        check("A seed slug resolves", seedDetail.status === 200);

        const cats = await fetch(`${base}/api/marketplace/catalogue/categories`);
        const brands = await fetch(`${base}/api/marketplace/catalogue/brands`);
        const featured = await fetch(
          `${base}/api/marketplace/catalogue/products?featured=true`,
        );
        check("A categories ok", cats.status === 200);
        check("A brands ok", brands.status === 200);
        check("A featured ok", featured.status === 200);
        check("A DB repo unused after all consumers", dbCalls.calls === 0);
      },
    );
  }

  // B: database — DB products returned, DB-only slug resolves
  {
    const dbCalls = { calls: 0 };
    await withServer(
      {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CATALOGUE_SOURCE: "database",
      },
      {
        createStaticRepository: () => createStaticCatalogueRepository(),
        createDatabaseRepository: () =>
          trackingRepo(buildDatabaseRepo(), dbCalls),
      },
      async (base) => {
        const pub = await fetch(`${base}/api/marketplace/catalogue/publication`);
        const pubBody = await pub.json();
        check(
          "B effective source database",
          pubBody.data.effectivePublicCatalogueSource === "database",
        );
        check(
          "B publicWouldShowSyncedProducts true",
          pubBody.data.publicWouldShowSyncedProducts === true,
        );

        const list = await fetch(`${base}/api/marketplace/catalogue/products`);
        const listBody = await list.json();
        check("B products HTTP 200", list.status === 200);
        check(
          "B includes DB-only product",
          listBody.data.some((p: CatalogueProductDto) => p.slug === DB_ONLY_SLUG),
        );
        check("B database repository called", dbCalls.calls > 0);

        const detail = await fetch(
          `${base}/api/marketplace/catalogue/products/${DB_ONLY_SLUG}`,
        );
        const detailBody = await detail.json();
        check("B DB-only slug HTTP 200", detail.status === 200);
        check("B DB-only slug matches", detailBody.data?.slug === DB_ONLY_SLUG);
      },
    );
  }

  // C: unset / invalid → fail closed to static, DB not called
  for (const [label, envExtra] of [
    ["unset", {}],
    ["invalid", { MARKETPLACE_CATALOGUE_SOURCE: "postgres" }],
    ["whitespace", { MARKETPLACE_CATALOGUE_SOURCE: "  " }],
  ] as const) {
    const dbCalls = { calls: 0 };
    await withServer(
      { MARKETPLACE_ENABLED: "true", ...envExtra },
      {
        createStaticRepository: () => createStaticCatalogueRepository(),
        createDatabaseRepository: () =>
          trackingRepo(buildDatabaseRepo(), dbCalls),
      },
      async (base) => {
        const pub = await fetch(`${base}/api/marketplace/catalogue/publication`);
        const pubBody = await pub.json();
        check(
          `C ${label} source static`,
          pubBody.data.effectivePublicCatalogueSource === "static",
        );
        check(
          `C ${label} publicWouldShowSyncedProducts false`,
          pubBody.data.publicWouldShowSyncedProducts === false,
        );
        const list = await fetch(`${base}/api/marketplace/catalogue/products`);
        const listBody = await list.json();
        check(
          `C ${label} seed count`,
          listBody.data.length === WS1_SEED_PRODUCTS.length,
        );
        check(`C ${label} DB repo not called`, dbCalls.calls === 0);
        const missing = await fetch(
          `${base}/api/marketplace/catalogue/products/${DB_ONLY_SLUG}`,
        );
        check(`C ${label} DB-only 404`, missing.status === 404);
      },
    );
  }

  // D: legacy snapshot diagnostic (read-only) identifies gaps
  {
    const listings = [
      {
        identityKey: "knox|zapher pv18000||inverter|hybrid|11.2|1||",
        productId: "p1",
        variantId: "v1",
        slug: "knox-zapher-11-2",
        title: "Knox Zapher 11.2kW",
        brandName: "Knox",
        categoryName: "Solar Inverter",
        websitePricePkr: 335000,
        availability: "in_stock",
        selectedSupplier: "kamal",
        sourceUrls: ["https://kamalsolar.pk/products/x"],
        matchReason: "exact_identity",
        priceReason: "single_supplier_kamal",
        lastSyncedAt: "2026-07-27T07:22:27.794Z",
        lastValidPricePkr: 335000,
        lastValidSupplier: "kamal",
        lastValidObservationAt: "2026-07-27T07:22:27.794Z",
        lastValidSourceKey: null,
        lastValidAvailability: null,
        active: true,
        offers: [
          {
            supplier: "kamal",
            pricePkr: 335000,
            url: "https://kamalsolar.pk/products/x",
            availability: "in_stock",
          },
        ],
      },
      {
        identityKey: "ok|product||inverter|hybrid|5|||",
        productId: "p2",
        variantId: "v2",
        slug: "ok-product",
        title: "OK Product",
        brandName: "Knox",
        categoryName: "Solar Inverter",
        websitePricePkr: 100000,
        availability: "in_stock",
        selectedSupplier: "kamal",
        sourceUrls: ["https://kamalsolar.pk/products/ok"],
        matchReason: "exact_identity",
        priceReason: "single_supplier_kamal",
        lastSyncedAt: "2026-08-02T15:13:29.661Z",
        lastValidPricePkr: 100000,
        lastValidSupplier: "kamal",
        lastValidObservationAt: "2026-08-02T15:13:29.661Z",
        lastValidSourceKey: "kamal:123",
        lastValidAvailability: "in_stock",
        active: true,
        offers: [
          {
            supplier: "kamal",
            pricePkr: 100000,
            url: "https://kamalsolar.pk/products/ok",
            availability: "in_stock",
            sourceKey: "kamal:123",
          },
        ],
      },
    ] as AutoImportListingRecord[];

    const diag = findLegacySnapshotGaps(listings);
    check("D diagnostic finds one gap", diag.count === 1);
    check(
      "D diagnostic identity",
      diag.issues[0]?.identityKey.includes("zapher") === true,
    );
    check(
      "D correction plan not applied",
      diag.correctionPlan.status === "prepared_not_applied",
    );
    check(
      "D planned legacy sourceKey",
      diag.issues[0]?.plannedLegacySourceKey.startsWith("legacy:kamal:") ===
        true,
    );
  }

  console.log("catalogueSourceGate.test.ts: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
