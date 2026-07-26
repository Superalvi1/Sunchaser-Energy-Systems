/**
 * Phase 1 live supplier catalogue tests — fixtures, SSRF, preview RBAC, no publish.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { AddressInfo } from "node:net";
import { EVIDENCE_BLOCKER_VARIANT_IDS } from "./adapterTypes.ts";
import { classifySupplierCategory } from "./categoryFilter.ts";
import {
  normalizeCatalogueProducts,
  parseMoneyPkr,
} from "./catalogueNormalize.ts";
import { createLiveCatalogueService } from "./liveCatalogueService.ts";
import { PHASE1_LIVE_PUBLICATION_ALLOWED } from "./liveCatalogueService.ts";
import { SHOPIFY_STOREFRONT_PRODUCTS_JSON } from "./liveCatalogueTypes.ts";
import {
  assertSafeAbsoluteUrl,
  createPinnedLookup,
  isAllowedSupplierImageUrl,
  normalizeSupplierImageUrl,
  SafeHttpError,
  safeFetchText,
  selectPinnedAddress,
  SUPPLIER_CATALOGUE_HOSTS,
  TLS_REJECT_UNAUTHORIZED,
  type PinnedHttpsRequestArgs,
} from "./safeHttp.ts";
import {
  buildProductsJsonUrl,
  dedupeShopifyProducts,
  fetchShopifyCatalogue,
  parseShopifyProductsJson,
  supplierProductSourceKey,
} from "./shopifyCatalogue.ts";
import { classifyInverterToken } from "./categoryFilter.ts";
import { createMarketplaceSupplierRouter } from "./supplierRoutes.ts";
import type { SupplierRepository } from "./supplierRepository.ts";
import { createSupplierIngestionService } from "./supplierIngestionService.ts";
import { createKamalAdapter } from "./kamalAdapter.ts";
import {
  isEvidenceBlockerVariant,
  isMappingPublishEligible,
} from "./evidenceBlockers.ts";
import { SupplierError } from "./supplierTypes.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const kamalFixture = readFileSync(
  join(__dirname, "fixtures/kamal-products-page1.sanitized.json"),
  "utf8",
);
const alladinFixture = readFileSync(
  join(__dirname, "fixtures/alladin-products-page1.sanitized.json"),
  "utf8",
);
const emptyFixture = readFileSync(
  join(__dirname, "fixtures/products-empty.sanitized.json"),
  "utf8",
);

function fixturePageProvider(supplier: "kamal" | "alladin", page: number) {
  if (page === 1) {
    return supplier === "kamal" ? kamalFixture : alladinFixture;
  }
  return emptyFixture;
}

function memoryRepo(overrides: Partial<SupplierRepository> = {}): SupplierRepository {
  const publishCalls: string[] = [];
  const jobs: Array<{ status: string; meta?: Record<string, unknown> }> = [];
  let running = false;
  const repo: SupplierRepository = {
    async listActiveMappings() {
      return [
        {
          id: "map_kamal_exact",
          supplierId: "mpsup_kamal",
          supplierCode: "kamal",
          productId: "prod_1",
          variantId: "var_1",
          supplierProductId: String(
            JSON.parse(kamalFixture).products[0].id,
          ),
          supplierVariantId: null,
          supplierSku: null,
          normalizedExactModel: "exact-model",
          matchConfidence: "exact",
          matchLocked: false,
          active: true,
          supplierUrl: null,
          matchEvidence: {},
        },
        {
          id: "map_blocker",
          supplierId: "mpsup_kamal",
          supplierCode: "kamal",
          productId: "prod_blocker",
          variantId: EVIDENCE_BLOCKER_VARIANT_IDS[0],
          supplierProductId: "blocker-sp",
          supplierVariantId: null,
          supplierSku: null,
          normalizedExactModel: "blocker",
          matchConfidence: "exact",
          matchLocked: true,
          active: true,
          supplierUrl: null,
          matchEvidence: { blocker: true },
        },
      ];
    },
    async getPricingConfig() {
      return { maxIncreasePct: 15, maxDecreasePct: 25, stalenessHours: 72 };
    },
    async getVariantWebsitePrice() {
      return null;
    },
    async startJob(_trigger, _scope, meta) {
      if (running) {
        throw new SupplierError(
          409,
          "CONFLICT",
          "Overlapping job already running.",
        );
      }
      running = true;
      jobs.push({ status: "running", meta });
      return { runId: `run_${jobs.length}` };
    },
    async finishJob(runId, status, _scope, _err, meta) {
      running = false;
      jobs.push({ status, meta: { runId, ...meta } });
    },
    async insertObservation() {
      return { observationId: "obs1", productId: "p", variantId: "v" };
    },
    async createAlert() {
      return { alertId: "a1" };
    },
    async listAlerts() {
      return [];
    },
    async publishPrice(variantId) {
      publishCalls.push(variantId);
      return { websitePriceState: "priced_auto", websitePriceSource: "kamal" };
    },
    async upsertMapping() {
      return { mappingId: "m1", matchLocked: false };
    },
    ...overrides,
  };
  (repo as any).__publishCalls = publishCalls;
  (repo as any).__jobs = jobs;
  (repo as any).__setRunning = (v: boolean) => {
    running = v;
  };
  return repo;
}

async function withServer(
  env: NodeJS.ProcessEnv,
  repo: SupplierRepository,
  liveCatalogue: ReturnType<typeof createLiveCatalogueService>,
  fn: (base: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = String(req.headers["x-test-role"] || "");
    if (role) {
      (req as any).actor = {
        id: "u1",
        username: role === "Super Admin" ? "superadmin" : "tester",
        name: role,
        email: "tester@example.com",
        role,
        accountStatus: "Approved",
        emailVerified: true,
        onboardingCompleted: true,
        authMethod: "jwt",
      };
    }
    next();
  });
  app.use(
    "/api/marketplace/admin",
    createMarketplaceSupplierRouter({ env, repository: repo, liveCatalogue }),
  );
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

{
  // Money parsing — current vs compare-at never swapped by parser.
  assert.deepEqual(parseMoneyPkr("120,000.00"), { value: 120000, status: "ok" });
  assert.equal(parseMoneyPkr("0").status, "malformed");
  assert.equal(parseMoneyPkr("N/A").status, "malformed");
  assert.equal(parseMoneyPkr(null).status, "missing");
  assert.equal(parseMoneyPkr("").status, "missing");
  console.log("PASS: money parsing / malformed / zero / missing");
}

{
  const kamalPage = parseShopifyProductsJson(kamalFixture);
  const { accepted, excluded } = normalizeCatalogueProducts(
    "kamal",
    kamalPage.products,
    "2026-07-26T00:00:00.000Z",
  );
  assert.ok(accepted.length >= 5);
  assert.ok(excluded.length >= 1); // synthetic non-solar or unclassified may appear
  const withCompare = accepted.find((p) => p.compareAtPricePkr != null);
  if (withCompare) {
    assert.notEqual(
      withCompare.currentListedPricePkr,
      withCompare.compareAtPricePkr,
    );
  }
  const zero = accepted.find((p) => p.title.includes("Zero Price"));
  assert.ok(zero);
  assert.equal(zero!.parseStatus, "malformed");
  assert.equal(zero!.confirmPriceRecommended, true);
  const bad = accepted.find((p) => p.title.includes("Malformed Price"));
  assert.ok(bad);
  assert.equal(bad!.parseStatus, "malformed");
  for (const p of accepted) {
    assert.equal(p.confirmPriceRecommended, true);
    if (p.primaryImageUrl) {
      assert.ok(isAllowedSupplierImageUrl(p.primaryImageUrl));
    }
    assert.ok(!JSON.stringify(p.rawEvidence).includes("<html"));
  }
  console.log("PASS: kamal fixture normalize / confirmPrice / images / no HTML bodies");
}

{
  const alladinPage = parseShopifyProductsJson(alladinFixture);
  const { accepted, excluded } = normalizeCatalogueProducts(
    "alladin",
    alladinPage.products,
    "2026-07-26T00:00:00.000Z",
  );
  assert.ok(accepted.length >= 3);
  assert.ok(excluded.some((e) => e.reason.startsWith("excluded_")));
  for (const p of accepted) {
    assert.equal(p.confirmPriceRecommended, false);
    assert.equal(p.supplier, "alladin");
  }
  const sold = accepted.find((p) => p.availability === "sold_out");
  assert.ok(sold, "expected sold_out stock signal in Alladin fixture");
  const withCompare = accepted.find(
    (p) => p.compareAtPricePkr != null && p.currentListedPricePkr != null,
  );
  assert.ok(withCompare);
  assert.notEqual(withCompare!.currentListedPricePkr, withCompare!.compareAtPricePkr);
  console.log("PASS: alladin fixture normalize / category exclusions / stock / compare-at");
}

{
  // True-positive solar / hybrid / VFD inverters
  assert.equal(
    classifySupplierCategory({
      title: "Knox Hybrid Solar Inverter",
      productType: "Solar Inverter",
    }).accepted,
    true,
  );
  assert.equal(
    classifySupplierCategory({
      title: "China VFD Inverter 5.5kW",
      productType: "VFD Inverter",
    }).accepted,
    true,
  );
  assert.equal(
    classifySupplierCategory({
      title: "GoodWe On-Grid Inverter 10kW",
      productType: "On-Grid Inverter",
    }).accepted,
    true,
  );
  // False-positive / ambiguous inverters (no solar context)
  assert.equal(
    classifySupplierCategory({
      title: "APC UPS Pure Sine Wave Inverter 1500VA",
      productType: "UPS",
    }).accepted,
    false,
  );
  assert.equal(
    classifyInverterToken({
      title: "APC UPS Pure Sine Wave Inverter 1500VA",
      productType: "UPS",
    })?.reason,
    "excluded_non_solar_inverter",
  );
  assert.equal(
    classifySupplierCategory({
      title: "Car Power Inverter 12V to 220V 2000W",
      productType: "Power Inverter",
    }).accepted,
    false,
  );
  assert.equal(
    classifySupplierCategory({
      title: "Generic Power Inverter 3000W",
      productType: "Inverter",
    }).reason,
    "excluded_ambiguous_inverter",
  );
  assert.equal(
    classifySupplierCategory({
      title: "Security Camera 4MP",
      productType: "Security Camera",
    }).accepted,
    false,
  );
  assert.equal(
    classifySupplierCategory({
      title: "Air Fryer Deluxe",
      productType: "Air Fryer",
    }).accepted,
    false,
  );
  console.log("PASS: category filter solar true-positives / inverter false-positives");
}

{
  // Pagination via pageProvider — distinct IDs per page; stop on empty.
  let pages = 0;
  const catalogue = await fetchShopifyCatalogue("kamal", {
    pageProvider: async (_s, page) => {
      pages += 1;
      if (page <= 2) {
        return {
          products: Array.from({ length: 3 }, (_, i) => ({
            id: page * 1000 + i,
            title: `Solar Inverter Page${page} Item ${i}`,
            handle: `solar-inverter-${page}-${i}`,
            vendor: "Test",
            product_type: "Solar Inverter",
            tags: ["Solar Inverter"],
            body_html: "<p>test</p>",
            variants: [
              {
                id: page * 2000 + i,
                price: "1000.00",
                compare_at_price: null,
                available: true,
                sku: `SKU${page}-${i}`,
              },
            ],
            images: [
              { src: "https://cdn.shopify.com/s/files/1/test.png", position: 1 },
            ],
          })),
        };
      }
      return { products: [] };
    },
    pageLimit: 3,
    maxPages: 5,
  });
  assert.equal(catalogue.accessMethod, SHOPIFY_STOREFRONT_PRODUCTS_JSON);
  assert.equal(catalogue.pagesFetched, 3); // 2 full + 1 empty
  assert.equal(catalogue.products.length, 6);
  assert.equal(catalogue.duplicateCount, 0);
  assert.equal(pages, 3);

  const short = await fetchShopifyCatalogue("alladin", {
    pageProvider: fixturePageProvider,
    pageLimit: 250,
  });
  assert.equal(short.pagesFetched, 1); // short page stops without needing empty fetch
  console.log("PASS: pagination discovery");
}

{
  // Deduplication across pages
  const page1 = {
    id: 42,
    title: "Solar Inverter A",
    product_type: "Solar Inverter",
    variants: [{ id: 1, price: "100.00", available: true }],
    images: [{ src: "https://cdn.shopify.com/s/files/1/a.png" }],
  };
  const page2Newer = {
    id: 42,
    title: "Solar Inverter A v2",
    product_type: "Solar Inverter",
    variants: [{ id: 1, price: "120.00", available: true }],
    images: [{ src: "https://cdn.shopify.com/s/files/1/b.png" }],
  };
  const malformed = {
    title: "Missing ID duplicate",
    product_type: "Solar Inverter",
    variants: [{ price: "1.00", available: true }],
  } as any;
  const multi = dedupeShopifyProducts("kamal", [
    page1,
    page1,
    page2Newer,
    malformed,
    { ...page1, id: 99, title: "Other" },
  ]);
  assert.equal(multi.products.length, 2);
  assert.equal(multi.duplicateCount, 2);
  assert.equal(String(multi.products.find((p) => String(p.id) === "42")?.title), "Solar Inverter A v2");
  assert.ok(multi.warnings.some((w) => w.includes("price conflict")));

  // Adjacent-page duplicates via fetchShopifyCatalogue
  const adj = await fetchShopifyCatalogue("kamal", {
    pageLimit: 1,
    maxPages: 5,
    pageProvider: async (_s, page) => {
      if (page === 1) return { products: [page1] };
      if (page === 2) return { products: [page2Newer] };
      return { products: [] };
    },
  });
  assert.equal(adj.rawProductRows, 2);
  assert.equal(adj.products.length, 1);
  assert.equal(adj.duplicateCount, 1);
  assert.equal(adj.products[0].variants?.[0]?.price, "120.00");

  // Same numeric ID from different suppliers must not collide
  const kamalD = dedupeShopifyProducts("kamal", [page1]);
  const alladinD = dedupeShopifyProducts("alladin", [
    { ...page1, title: "Alladin same numeric id" },
  ]);
  assert.equal(supplierProductSourceKey("kamal", 42), "kamal:42");
  assert.equal(supplierProductSourceKey("alladin", 42), "alladin:42");
  assert.equal(kamalD.products[0].title, "Solar Inverter A");
  assert.equal(alladinD.products[0].title, "Alladin same numeric id");

  // Valid then malformed duplicate — keep valid
  const keepValid = dedupeShopifyProducts("kamal", [
    page1,
    { id: 42 } as any, // malformed-ish empty variant ok but id present — newest wins if id present
  ]);
  assert.equal(keepValid.products.length, 1);
  const keepValid2 = dedupeShopifyProducts("kamal", [page1, malformed, malformed]);
  assert.equal(keepValid2.products.length, 1);
  assert.equal(keepValid2.products[0].title, "Solar Inverter A");

  // Preview counts use unique products only
  const live = createLiveCatalogueService({
    repository: memoryRepo(),
    env: {
      MARKETPLACE_WS4_KAMAL_LIVE_ENABLED: "true",
      MARKETPLACE_WS4_KAMAL_AUTHORIZED_METHOD: SHOPIFY_STOREFRONT_PRODUCTS_JSON,
    } as any,
    catalogueDeps: {
      pageLimit: 1,
      pageProvider: async (_s, page) => {
        if (page === 1) {
          return {
            products: [
              page1,
              {
                id: 7,
                title: "UPS Pure Sine Inverter",
                product_type: "UPS",
                variants: [{ price: "50.00", available: true }],
                images: [{ src: "https://cdn.shopify.com/s/files/1/u.png" }],
              },
            ],
          };
        }
        if (page === 2) return { products: [page2Newer] };
        return { products: [] };
      },
    },
  });
  const preview = await live.runLivePreview({
    actorScope: "admin:super:u1",
    suppliers: ["kamal"],
  });
  assert.equal(preview.productsDiscovered, 2); // unique 42 + 7, not 3 raw rows
  assert.equal(preview.publishedCount, 0);
  assert.ok(preview.warnings.some((w) => w.includes("duplicate")));
  console.log("PASS: pagination dedupe / conflicts / cross-supplier IDs / preview unique counts");
}

{
  assert.equal(
    buildProductsJsonUrl("https://kamalsolar.pk", 2),
    "https://kamalsolar.pk/products.json?limit=250&page=2",
  );
  assert.throws(
    () => assertSafeAbsoluteUrl("http://kamalsolar.pk/products.json", SUPPLIER_CATALOGUE_HOSTS),
    (e: unknown) => e instanceof SafeHttpError && e.code === "PROTOCOL_DENIED",
  );
  assert.throws(
    () =>
      assertSafeAbsoluteUrl(
        "https://evil.example/products.json",
        SUPPLIER_CATALOGUE_HOSTS,
      ),
    (e: unknown) => e instanceof SafeHttpError && e.code === "HOST_DENIED",
  );
  assert.equal(isAllowedSupplierImageUrl("data:image/png;base64,xxx"), false);
  assert.equal(isAllowedSupplierImageUrl("file:///tmp/x.png"), false);
  assert.equal(isAllowedSupplierImageUrl("http://127.0.0.1/x.png"), false);
  assert.equal(
    normalizeSupplierImageUrl("//cdn.shopify.com/s/files/1/x.png"),
    "https://cdn.shopify.com/s/files/1/x.png",
  );
  assert.equal(
    isAllowedSupplierImageUrl("https://cdn.shopify.com/s/files/1/x.png"),
    true,
  );

  // Private IPv4 / IPv6 blocked at validation (before connection)
  await assert.rejects(
    () =>
      safeFetchText("https://kamalsolar.pk/products.json", {
        lookupFn: async () => ["127.0.0.1"],
      }),
    (e: unknown) => e instanceof SafeHttpError && e.code === "PRIVATE_IP",
  );
  await assert.rejects(
    () =>
      safeFetchText("https://kamalsolar.pk/products.json", {
        lookupFn: async () => ["::1"],
      }),
    (e: unknown) => e instanceof SafeHttpError && e.code === "PRIVATE_IP",
  );
  await assert.rejects(
    () =>
      safeFetchText("https://kamalsolar.pk/products.json", {
        lookupFn: async () => ["169.254.1.1"],
      }),
    (e: unknown) => e instanceof SafeHttpError && e.code === "PRIVATE_IP",
  );

  // TLS hostname verification remains enabled (never NODE_TLS_REJECT_UNAUTHORIZED=0)
  assert.equal(TLS_REJECT_UNAUTHORIZED, true);
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);

  // Connection path uses only validated address (pinned lookup)
  const pinnedIps: string[] = [];
  const { address } = selectPinnedAddress(["203.0.113.10", "2001:db8::1"]);
  assert.equal(address, "203.0.113.10");
  createPinnedLookup(["203.0.113.10"], (ip) => pinnedIps.push(ip))(
    "evil-rebinding.example",
    {},
    () => {},
  );
  assert.deepEqual(pinnedIps, ["203.0.113.10"]);
  // Node net/https often calls lookup with { all: true }
  let allForm: unknown = null;
  createPinnedLookup(["203.0.113.10"])(
    "evil-rebinding.example",
    { all: true },
    (_err: unknown, addresses: unknown) => {
      allForm = addresses;
    },
  );
  assert.deepEqual(allForm, [{ address: "203.0.113.10", family: 4 }]);

  // DNS answer changing between validation and connection cannot redirect request:
  // lookupFn is called per hop; pinnedRequest receives that hop's validated set only.
  let lookupCalls = 0;
  const seenValidated: string[][] = [];
  await safeFetchText("https://kamalsolar.pk/products.json", {
    lookupFn: async () => {
      lookupCalls += 1;
      // Even if a later system DNS would flip, we only pass this validated set.
      return lookupCalls === 1 ? ["203.0.113.50"] : ["127.0.0.1"];
    },
    maxRetries: 0,
    pinnedRequestFn: async (args: PinnedHttpsRequestArgs) => {
      seenValidated.push([...args.validatedAddresses]);
      assert.equal(args.url.hostname, "kamalsolar.pk");
      assert.equal(args.url.protocol, "https:");
      // TLS hostname verification remains enabled in production pinnedHttpsRequest
      // (rejectUnauthorized: true). This harness asserts hostname is preserved.
      return {
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        body: '{"products":[]}',
      };
    },
  });
  assert.equal(lookupCalls, 1);
  assert.deepEqual(seenValidated, [["203.0.113.50"]]);

  // Redirect destinations receive fresh validation + binding
  const redirectValidated: string[][] = [];
  let hop = 0;
  await safeFetchText("https://kamalsolar.pk/products.json", {
    lookupFn: async (hostname) => {
      if (hostname === "kamalsolar.pk") return ["203.0.113.1"];
      if (hostname === "alladin.pk") return ["203.0.113.2"];
      throw new Error("unexpected host " + hostname);
    },
    maxRetries: 0,
    pinnedRequestFn: async (args) => {
      redirectValidated.push([args.url.hostname, ...args.validatedAddresses]);
      hop += 1;
      if (hop === 1) {
        return {
          status: 302,
          headers: new Headers({ location: "https://alladin.pk/products.json" }),
          body: "",
        };
      }
      return {
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        body: '{"products":[]}',
      };
    },
  });
  assert.deepEqual(redirectValidated, [
    ["kamalsolar.pk", "203.0.113.1"],
    ["alladin.pk", "203.0.113.2"],
  ]);

  // Redirect to private host denied
  await assert.rejects(
    () =>
      safeFetchText("https://kamalsolar.pk/products.json", {
        lookupFn: async () => ["203.0.113.1"],
        maxRetries: 0,
        pinnedRequestFn: async () => ({
          status: 302,
          headers: new Headers({ location: "https://127.0.0.1/steal" }),
          body: "",
        }),
      }),
    (e: unknown) =>
      e instanceof SafeHttpError &&
      (e.code === "HOST_DENIED" || e.code === "PRIVATE_IP"),
  );

  // Retry never bypasses address validation
  let attempts = 0;
  let retryLookups = 0;
  await assert.rejects(
    () =>
      safeFetchText("https://alladin.pk/products.json", {
        lookupFn: async () => {
          retryLookups += 1;
          return ["203.0.113.9"];
        },
        maxRetries: 2,
        sleepFn: async () => {},
        pinnedRequestFn: async (args) => {
          attempts += 1;
          assert.deepEqual(args.validatedAddresses, ["203.0.113.9"]);
          throw new SafeHttpError("NETWORK_ERROR", "network down");
        },
      }),
    (e: unknown) => e instanceof SafeHttpError && e.code === "NETWORK_ERROR",
  );
  assert.equal(attempts, 3);
  assert.equal(retryLookups, 3);

  await assert.rejects(
    () =>
      safeFetchText("https://alladin.pk/products.json", {
        lookupFn: async () => ["203.0.113.9"],
        timeoutMs: 20,
        maxRetries: 0,
        pinnedRequestFn: async () => {
          throw new SafeHttpError("TIMEOUT", "Request timed out.");
        },
      }),
    (e: unknown) => e instanceof SafeHttpError && e.code === "TIMEOUT",
  );

  await assert.rejects(
    () =>
      safeFetchText("https://alladin.pk/products.json", {
        lookupFn: async () => ["203.0.113.9"],
        maxBytes: 32,
        maxRetries: 0,
        pinnedRequestFn: async () => {
          throw new SafeHttpError("RESPONSE_TOO_LARGE", "Response exceeds max size.");
        },
      }),
    (e: unknown) => e instanceof SafeHttpError && e.code === "RESPONSE_TOO_LARGE",
  );

  console.log("PASS: SSRF / DNS pin / redirect / retry / timeout / oversized");
}

{
  for (const id of EVIDENCE_BLOCKER_VARIANT_IDS) {
    assert.equal(isEvidenceBlockerVariant(id), true);
  }
  assert.equal(
    isMappingPublishEligible({
      id: "x",
      supplierId: "s",
      supplierCode: "kamal",
      productId: "p",
      variantId: EVIDENCE_BLOCKER_VARIANT_IDS[0],
      supplierProductId: "sp",
      supplierVariantId: null,
      supplierSku: null,
      normalizedExactModel: "m",
      matchConfidence: "exact",
      matchLocked: true,
      active: true,
      supplierUrl: null,
      matchEvidence: {},
    }),
    false,
  );
  console.log("PASS: evidence blockers remain locked");
}

{
  assert.equal(PHASE1_LIVE_PUBLICATION_ALLOWED, false);
  const repo = memoryRepo();
  const live = createLiveCatalogueService({
    repository: repo,
    env: {
      MARKETPLACE_WS4_KAMAL_LIVE_ENABLED: "true",
      MARKETPLACE_WS4_KAMAL_AUTHORIZED_METHOD: SHOPIFY_STOREFRONT_PRODUCTS_JSON,
      MARKETPLACE_WS4_ALLADIN_LIVE_ENABLED: "true",
      MARKETPLACE_WS4_ALLADIN_AUTHORIZED_METHOD: SHOPIFY_STOREFRONT_PRODUCTS_JSON,
    } as any,
    catalogueDeps: { pageProvider: fixturePageProvider },
  });

  const result = await live.runLivePreview({
    actorScope: "admin:super:u1",
  });
  assert.equal(result.productionReady, false);
  assert.equal(result.publishedCount, 0);
  assert.ok(result.productsDiscovered > 0);
  assert.ok(result.relevantProductsAccepted > 0);
  assert.ok(result.imageUrlsFound > 0);
  assert.ok(result.matchedProducts >= 1);
  assert.ok(result.unmatchedProducts >= 1);
  assert.ok(result.invalidPrices >= 1);
  assert.equal((repo as any).__publishCalls.length, 0);
  assert.ok(result.suppliers.every((s) => s.ok));

  // Partial failure: one supplier transport error must not discard the other.
  const livePartial = createLiveCatalogueService({
    repository: memoryRepo(),
    env: {
      MARKETPLACE_WS4_KAMAL_LIVE_ENABLED: "true",
      MARKETPLACE_WS4_KAMAL_AUTHORIZED_METHOD: SHOPIFY_STOREFRONT_PRODUCTS_JSON,
      MARKETPLACE_WS4_ALLADIN_LIVE_ENABLED: "true",
      MARKETPLACE_WS4_ALLADIN_AUTHORIZED_METHOD: SHOPIFY_STOREFRONT_PRODUCTS_JSON,
    } as any,
    catalogueDeps: {
      pageProvider: async (supplier, page) => {
        if (supplier === "alladin") throw new Error("alladin boom");
        return fixturePageProvider(supplier, page);
      },
    },
  });
  const partial = await livePartial.runLivePreview({
    actorScope: "admin:super:u1",
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.publishedCount, 0);
  assert.ok(partial.suppliers.find((s) => s.supplier === "kamal")?.ok);
  assert.equal(partial.suppliers.find((s) => s.supplier === "alladin")?.ok, false);

  // Overlap lock
  const lock = { held: true };
  const liveBusy = createLiveCatalogueService({
    repository: memoryRepo(),
    overlapLock: lock,
    env: {
      MARKETPLACE_WS4_KAMAL_LIVE_ENABLED: "true",
      MARKETPLACE_WS4_KAMAL_AUTHORIZED_METHOD: SHOPIFY_STOREFRONT_PRODUCTS_JSON,
    } as any,
    catalogueDeps: { pageProvider: fixturePageProvider },
  });
  await assert.rejects(
    () => liveBusy.runLivePreview({ actorScope: "admin:super:u1" }),
    (e: any) => e.code === "CONFLICT",
  );

  console.log("PASS: live preview summary / partial failure / overlap / no publish");
}

{
  // Adapter live path uses fixtures via pageProvider; confirmPrice + no website_price write.
  const kamal = createKamalAdapter({
    env: {
      MARKETPLACE_WS4_KAMAL_LIVE_ENABLED: "true",
      MARKETPLACE_WS4_KAMAL_AUTHORIZED_METHOD: SHOPIFY_STOREFRONT_PRODUCTS_JSON,
    } as any,
    catalogueDeps: { pageProvider: fixturePageProvider },
  });
  assert.equal(kamal.isLiveEnabled(), true);
  const productId = String(JSON.parse(kamalFixture).products[0].id);
  const obs = await kamal.fetchObservation({
    id: "map1",
    supplierId: "mpsup_kamal",
    supplierCode: "kamal",
    productId: "p1",
    variantId: "v1",
    supplierProductId: productId,
    supplierVariantId: null,
    supplierSku: null,
    normalizedExactModel: "m",
    matchConfidence: "exact",
    matchLocked: false,
    active: true,
    supplierUrl: null,
    matchEvidence: {},
  });
  assert.equal(obs.ok, true);
  if (obs.ok) {
    assert.equal(obs.observation.evidence.source, SHOPIFY_STOREFRONT_PRODUCTS_JSON);
    assert.equal(obs.observation.evidence.confirmPriceRecommended, true);
  }

  const repo = memoryRepo();
  const ingestion = createSupplierIngestionService({
    repository: repo,
    kamalAdapter: kamal,
    env: {
      MARKETPLACE_WS4_KAMAL_LIVE_ENABLED: "true",
      MARKETPLACE_WS4_KAMAL_AUTHORIZED_METHOD: SHOPIFY_STOREFRONT_PRODUCTS_JSON,
    } as any,
  });
  const run = await ingestion.runPriceCheck({
    trigger: "manual",
    actorScope: "admin:super:u1",
    changedBy: "u1",
  });
  assert.equal(run.productionReady, false);
  assert.equal(run.variantsPublished, 0);
  assert.equal((repo as any).__publishCalls.length, 0);
  console.log("PASS: live adapter observation + no publication / no website_price write");
}

{
  const repo = memoryRepo();
  const live = createLiveCatalogueService({
    repository: repo,
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_WS4_KAMAL_LIVE_ENABLED: "true",
      MARKETPLACE_WS4_KAMAL_AUTHORIZED_METHOD: SHOPIFY_STOREFRONT_PRODUCTS_JSON,
      MARKETPLACE_WS4_ALLADIN_LIVE_ENABLED: "true",
      MARKETPLACE_WS4_ALLADIN_AUTHORIZED_METHOD: SHOPIFY_STOREFRONT_PRODUCTS_JSON,
    } as any,
    catalogueDeps: { pageProvider: fixturePageProvider },
  });

  await withServer(
    {
      MARKETPLACE_ENABLED: "true",
    } as any,
    repo,
    live,
    async (base) => {
      const deniedRoles = ["Customer", "Sales Manager", "Admin", ""];
      for (const role of deniedRoles) {
        const res = await fetch(`${base}/api/marketplace/admin/suppliers/live-preview`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(role ? { "x-test-role": role } : {}),
          },
          body: "{}",
        });
        assert.ok([401, 403].includes(res.status), `role=${role} status=${res.status}`);
      }

      const spoof = await fetch(`${base}/api/marketplace/admin/suppliers/live-preview`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-role": "Super Admin",
          "x-actor-role": "Super Admin",
        },
        body: JSON.stringify({ role: "Super Admin" }),
      });
      assert.equal(spoof.status, 400);

      const ok = await fetch(`${base}/api/marketplace/admin/suppliers/live-preview`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-role": "Super Admin",
        },
        body: JSON.stringify({ suppliers: ["kamal"] }),
      });
      assert.equal(ok.status, 202);
      const body = await ok.json();
      assert.equal(body.ok, true);
      assert.equal(body.data.publishedCount, 0);
      assert.equal(body.data.productionReady, false);
      assert.ok(body.data.relevantProductsAccepted > 0);
    },
  );
  console.log("PASS: live-preview RBAC + spoofing + Super Admin preview");
}

console.log("ALL PASS: liveCataloguePhase1");
