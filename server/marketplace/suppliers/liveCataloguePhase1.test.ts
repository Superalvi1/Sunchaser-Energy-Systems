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
  isAllowedSupplierImageUrl,
  normalizeSupplierImageUrl,
  SafeHttpError,
  safeFetchText,
  SUPPLIER_CATALOGUE_HOSTS,
} from "./safeHttp.ts";
import {
  buildProductsJsonUrl,
  fetchShopifyCatalogue,
  parseShopifyProductsJson,
} from "./shopifyCatalogue.ts";
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
  assert.equal(
    classifySupplierCategory({
      title: "Knox Hybrid Solar Inverter",
      productType: "Solar Inverter",
    }).accepted,
    true,
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
      title: "China VFD Inverter 5.5kW",
      productType: "VFD Inverter",
    }).accepted,
    true,
  );
  assert.equal(
    classifySupplierCategory({
      title: "Air Fryer Deluxe",
      productType: "Air Fryer",
    }).accepted,
    false,
  );
  console.log("PASS: category filter relevant vs excluded");
}

{
  // Pagination via pageProvider — continue while page is full, stop on short/empty.
  const fullPage = {
    products: Array.from({ length: 3 }, (_, i) => ({
      id: 1000 + i,
      title: `Solar Inverter PageItem ${i}`,
      handle: `solar-inverter-${i}`,
      vendor: "Test",
      product_type: "Solar Inverter",
      tags: ["Solar Inverter"],
      body_html: "<p>test</p>",
      variants: [
        { id: 2000 + i, price: "1000.00", compare_at_price: null, available: true, sku: `SKU${i}` },
      ],
      images: [
        { src: "https://cdn.shopify.com/s/files/1/test.png", position: 1 },
      ],
    })),
  };
  let pages = 0;
  const catalogue = await fetchShopifyCatalogue("kamal", {
    pageProvider: async (_s, page) => {
      pages += 1;
      if (page <= 2) return fullPage;
      return { products: [] };
    },
    pageLimit: 3,
    maxPages: 5,
  });
  assert.equal(catalogue.accessMethod, SHOPIFY_STOREFRONT_PRODUCTS_JSON);
  assert.equal(catalogue.pagesFetched, 3); // 2 full + 1 empty
  assert.equal(catalogue.products.length, 6);
  assert.equal(pages, 3);

  const short = await fetchShopifyCatalogue("alladin", {
    pageProvider: fixturePageProvider,
    pageLimit: 250,
  });
  assert.equal(short.pagesFetched, 1); // short page stops without needing empty fetch
  console.log("PASS: pagination discovery");
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
        lookupFn: async () => ["1.2.3.4"],
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://127.0.0.1/steal" },
          }),
      }),
    (e: unknown) =>
      e instanceof SafeHttpError &&
      (e.code === "HOST_DENIED" || e.code === "PRIVATE_IP" || e.code === "REDIRECT_DENIED"),
  );

  let attempts = 0;
  await assert.rejects(
    () =>
      safeFetchText("https://alladin.pk/products.json", {
        lookupFn: async () => ["1.2.3.4"],
        maxRetries: 2,
        sleepFn: async () => {},
        fetchImpl: async () => {
          attempts += 1;
          throw new Error("network down");
        },
      }),
    (e: unknown) => e instanceof SafeHttpError && e.code === "NETWORK_ERROR",
  );
  assert.equal(attempts, 3);

  await assert.rejects(
    () =>
      safeFetchText("https://alladin.pk/products.json", {
        lookupFn: async () => ["1.2.3.4"],
        timeoutMs: 20,
        maxRetries: 0,
        fetchImpl: async (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      }),
    (e: unknown) => e instanceof SafeHttpError && e.code === "TIMEOUT",
  );

  await assert.rejects(
    () =>
      safeFetchText("https://alladin.pk/products.json", {
        lookupFn: async () => ["1.2.3.4"],
        maxBytes: 32,
        maxRetries: 0,
        fetchImpl: async () =>
          new Response("x".repeat(100), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      }),
    (e: unknown) => e instanceof SafeHttpError && e.code === "RESPONSE_TOO_LARGE",
  );

  console.log("PASS: SSRF / redirect / retry / timeout / oversized");
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
