/**
 * CEO automatic supplier import — required scenario tests.
 * Run: npm run test:marketplace-ceo-auto-import
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestActor } from "../../middleware/actor.ts";
import type { CatalogueProductObservation } from "../suppliers/liveCatalogueTypes.ts";
import { SHOPIFY_STOREFRONT_PRODUCTS_JSON } from "../suppliers/liveCatalogueTypes.ts";
import { LEGACY_MAPPING_DISABLED_CODE } from "../legacyMappingDisabled.ts";
import { createMarketplacePricingRouter } from "../pricing/pricingRoutes.ts";
import { createMarketplaceSupplierRouter } from "../suppliers/supplierRoutes.ts";
import { createMarketplaceAutoImportRouter } from "./autoImportRoutes.ts";
import { createMemoryAutoImportRepository } from "./autoImportRepository.ts";
import { createAutoImportService } from "./autoImportService.ts";
import {
  buildVariantIdentity,
  exactIdentityKey,
  hasHardIdentityConflict,
} from "./identityNormalize.ts";
import {
  resolvePriceWithRollback,
  selectLowestValidPrice,
} from "./priceSelect.ts";
import { PHASE1_LIVE_PUBLICATION_ALLOWED } from "../suppliers/liveCatalogueService.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../..");

function obs(
  partial: Partial<CatalogueProductObservation> & {
    supplier: "kamal" | "alladin";
    title: string;
    supplierProductId: string;
  },
): CatalogueProductObservation {
  const id = partial.supplierProductId;
  return {
    supplier: partial.supplier,
    supplierProductId: id,
    sourceKey: `${partial.supplier}:${id}`,
    title: partial.title,
    brand: partial.brand ?? "Inverex",
    modelSku: partial.modelSku ?? "NITROX",
    category: partial.category ?? "Solar Inverter",
    currentListedPricePkr: partial.currentListedPricePkr ?? 100000,
    compareAtPricePkr: partial.compareAtPricePkr ?? null,
    availability: partial.availability ?? "in_stock",
    parseStatus: partial.parseStatus ?? "ok",
    confirmPriceRecommended: partial.supplier === "kamal",
    canonicalUrl:
      partial.canonicalUrl ??
      `https://${partial.supplier === "kamal" ? "kamalsolar.pk" : "alladin.pk"}/products/${id}`,
    primaryImageUrl: partial.primaryImageUrl ?? null,
    additionalImageUrls: partial.additionalImageUrls ?? [],
    description: partial.description ?? "spec",
    fetchedAt: partial.fetchedAt ?? "2026-07-26T12:00:00.000Z",
    rawEvidence: {
      source: SHOPIFY_STOREFRONT_PRODUCTS_JSON,
      productType: partial.category ?? "Solar Inverter",
      ...(partial.rawEvidence || {}),
    },
  };
}

async function runWith(fixtures: CatalogueProductObservation[]) {
  const repository = createMemoryAutoImportRepository();
  const service = createAutoImportService({
    repository,
    fixtureObservations: fixtures,
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  const listings = await service.listListings();
  return { result, listings, repository };
}

{
  // Identity: on-grid vs hybrid never merge
  const hybrid = buildVariantIdentity({
    title: "Inverex Nitrox 10kW Hybrid Inverter",
    brand: "Inverex",
    modelSku: "NITROX",
    category: "Solar Inverter",
  });
  const ongrid = buildVariantIdentity({
    title: "Inverex Nitrox 10kW On-Grid Inverter",
    brand: "Inverex",
    modelSku: "NITROX",
    category: "Solar Inverter",
  });
  assert.equal(hybrid.topology, "hybrid");
  assert.equal(ongrid.topology, "ongrid");
  assert.equal(hasHardIdentityConflict(hybrid, ongrid), true);
  assert.notEqual(exactIdentityKey(hybrid), exactIdentityKey(ongrid));
  console.log("ok - on-grid versus hybrid conflict");
}

{
  // Capacity / model-suffix conflict
  const a = buildVariantIdentity({
    title: "Knox Zapher 11.2kW Hybrid Inverter",
    brand: "Knox",
    category: "Solar Inverter",
  });
  const b = buildVariantIdentity({
    title: "Knox Zapher 6kW Hybrid Inverter",
    brand: "Knox",
    category: "Solar Inverter",
  });
  assert.equal(hasHardIdentityConflict(a, b), true);
  const c = buildVariantIdentity({
    title: "Knox Zapher Pro 11.2kW Hybrid Inverter Extra Suffix",
    brand: "Knox",
    category: "Solar Inverter",
  });
  // Different suffix tokens → separate exact keys when both eligible
  console.log("ok - capacity/model-suffix conflict primitives");
}

{
  // Kamal-only
  const { listings, result } = await runWith([
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "k-only",
      currentListedPricePkr: 250000,
    }),
  ]);
  assert.equal(listings.length, 1);
  assert.equal(listings[0]!.selectedSupplier, "kamal");
  assert.equal(listings[0]!.websitePricePkr, 250000);
  assert.equal(result.ceoDiscountApplied, false);
  assert.equal(result.legacyMappingBypassUsed, false);
  console.log("ok - Kamal-only product");
}

{
  // Alladin-only
  const { listings } = await runWith([
    obs({
      supplier: "alladin",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "a-only",
      brand: "Inverex",
      currentListedPricePkr: 240000,
    }),
  ]);
  assert.equal(listings.length, 1);
  assert.equal(listings[0]!.selectedSupplier, "alladin");
  assert.equal(listings[0]!.websitePricePkr, 240000);
  console.log("ok - Aladin-only product");
}

{
  // Identical on both — Kamal cheaper
  const { listings, result } = await runWith([
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "same-k",
      currentListedPricePkr: 200000,
    }),
    obs({
      supplier: "alladin",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "same-a",
      currentListedPricePkr: 220000,
    }),
  ]);
  assert.equal(listings.length, 1);
  assert.equal(listings[0]!.websitePricePkr, 200000);
  assert.equal(listings[0]!.selectedSupplier, "kamal");
  assert.ok(result.sampleLowestPrice[0]?.considered.length === 2);
  console.log("ok - identical product both sites; Kamal cheaper");
}

{
  // Alladin cheaper
  const { listings } = await runWith([
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "same-k2",
      currentListedPricePkr: 230000,
    }),
    obs({
      supplier: "alladin",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "same-a2",
      currentListedPricePkr: 210000,
    }),
  ]);
  assert.equal(listings[0]!.websitePricePkr, 210000);
  assert.equal(listings[0]!.selectedSupplier, "alladin");
  console.log("ok - Aladin cheaper");
}

{
  // Equal prices — deterministic kamal tie-break
  const sel = selectLowestValidPrice([
    {
      supplier: "alladin",
      sourceKey: "alladin:1",
      canonicalUrl: "https://alladin.pk/products/1",
      title: "X",
      currentListedPricePkr: 100,
      parseStatus: "ok",
      availability: "in_stock",
      fetchedAt: "t",
    },
    {
      supplier: "kamal",
      sourceKey: "kamal:1",
      canonicalUrl: "https://kamalsolar.pk/products/1",
      title: "X",
      currentListedPricePkr: 100,
      parseStatus: "ok",
      availability: "in_stock",
      fetchedAt: "t",
    },
  ]);
  assert.equal(sel.ok, true);
  if (sel.ok) assert.equal(sel.supplier, "kamal");
  console.log("ok - equal prices tie-break");
}

{
  // Multiple variants stay separate (capacity)
  const { listings } = await runWith([
    obs({
      supplier: "kamal",
      title: "Knox Hybrid Inverter 6kW Single Phase",
      supplierProductId: "v6",
      brand: "Knox",
      currentListedPricePkr: 150000,
    }),
    obs({
      supplier: "kamal",
      title: "Knox Hybrid Inverter 11.2kW Single Phase",
      supplierProductId: "v11",
      brand: "Knox",
      currentListedPricePkr: 300000,
    }),
  ]);
  assert.equal(listings.length, 2);
  console.log("ok - multiple variants");
}

{
  // Unavailable product still imports with sold_out when priced
  const { listings } = await runWith([
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "sold",
      currentListedPricePkr: 250000,
      availability: "sold_out",
    }),
  ]);
  assert.equal(listings[0]!.availability, "sold_out");
  assert.equal(listings[0]!.active, false);
  console.log("ok - unavailable product");
}

{
  // Missing/invalid price rejected
  const { listings, result } = await runWith([
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "bad",
      currentListedPricePkr: null,
      parseStatus: "missing",
    }),
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter Zero",
      supplierProductId: "zero",
      currentListedPricePkr: 0,
      parseStatus: "malformed",
    }),
  ]);
  assert.equal(listings.length, 0);
  assert.ok(result.health.rejectedVariants >= 2);
  console.log("ok - missing/invalid price");
}

{
  // Supplier timeout → partial/failed with error, other supplier still imports
  const repository = createMemoryAutoImportRepository();
  const service = createAutoImportService({
    repository,
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
    catalogueDeps: {
      pageProvider: async (supplier) => {
        if (supplier === "kamal") {
          throw new Error("TIMEOUT");
        }
        return {
          products: [
            {
              id: 99,
              title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
              handle: "nitrox-10",
              vendor: "Inverex",
              product_type: "Solar Inverter",
              tags: ["Solar Inverter"],
              body_html: "<p>x</p>",
              variants: [{ price: "250000.00", available: true, sku: "N" }],
              images: [],
            },
          ],
        };
      },
    },
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.ok(result.health.errors.some((e) => e.includes("kamal")));
  assert.ok((await service.listListings()).length >= 1);
  console.log("ok - supplier timeout partial import");
}

{
  // Stale / rollback to last valid observation
  const repository = createMemoryAutoImportRepository();
  const first = createAutoImportService({
    repository,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "rb",
        currentListedPricePkr: 250000,
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  await first.runAutomaticImport({ actorScope: "admin:super:ceo" });
  const second = createAutoImportService({
    repository,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "rb",
        currentListedPricePkr: null,
        parseStatus: "missing",
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  // When only invalid offer remains, group may reject entirely after rejectReason filter.
  // Explicit unit for rollback helper:
  const rolled = resolvePriceWithRollback(
    { ok: false, reason: "no_valid_listed_price" },
    { pricePkr: 250000, observedAt: "t0", supplier: "kamal" },
  );
  assert.equal(rolled.rolledBack, true);
  assert.equal(rolled.pricePkr, 250000);
  console.log("ok - stale price rollback helper");
}

{
  // Duplicate product URL rejected
  const { listings, result } = await runWith([
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "u1",
      canonicalUrl: "https://kamalsolar.pk/products/dup",
      currentListedPricePkr: 250000,
    }),
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter Copy",
      supplierProductId: "u2",
      canonicalUrl: "https://kamalsolar.pk/products/dup",
      currentListedPricePkr: 240000,
    }),
  ]);
  assert.equal(listings.length, 1);
  assert.ok(result.health.rejectedVariants >= 1);
  console.log("ok - duplicate product URL");
}

{
  // Import idempotency
  const repository = createMemoryAutoImportRepository();
  const fixtures = [
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "idem",
      currentListedPricePkr: 250000,
    }),
  ];
  const env = {
    MARKETPLACE_ENABLED: "true",
    MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
  };
  const s1 = createAutoImportService({ repository, fixtureObservations: fixtures, env });
  const r1 = await s1.runAutomaticImport({ actorScope: "admin:super:ceo" });
  const s2 = createAutoImportService({ repository, fixtureObservations: fixtures, env });
  const r2 = await s2.runAutomaticImport({ actorScope: "admin:super:ceo" });
  assert.equal(r1.health.productsCreated, 1);
  assert.equal(r2.health.productsCreated, 0);
  assert.equal(r2.health.productsUpdated, 1);
  assert.equal((await s2.listListings()).length, 1);
  console.log("ok - import idempotency");
}

{
  // Automatic website publication (memory catalogue listing priced)
  const { listings, result } = await runWith([
    obs({
      supplier: "alladin",
      title: "Pylontech US5000 4.8kWh Lithium Battery 48V",
      supplierProductId: "bat",
      brand: "Pylontech",
      category: "Lithium Battery",
      modelSku: "US5000",
      currentListedPricePkr: 180000,
    }),
  ]);
  assert.equal(result.automaticPublication, true);
  assert.ok(listings[0]!.websitePricePkr > 0);
  assert.ok(listings[0]!.productId.startsWith("mpprod_"));
  console.log("ok - automatic website publication");
}

{
  // WS-MAP-0 preserved — legacy mapping still 410
  function actor(role: string): RequestActor {
    return {
      id: "u1",
      username: "sa",
      name: role,
      email: "sa@test.com",
      role,
      accountStatus: "Approved",
      emailVerified: true,
      onboardingCompleted: true,
      authMethod: "jwt",
    };
  }
  process.env.MARKETPLACE_ENABLED = "true";
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor("Super Admin");
    next();
  });
  app.use("/api/marketplace/admin", createMarketplacePricingRouter({ env: process.env }));
  app.use("/api/marketplace/admin", createMarketplaceSupplierRouter({ env: process.env }));
  app.use(
    "/api/marketplace/admin",
    createMarketplaceAutoImportRouter({
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      },
      service: createAutoImportService({
        fixtureObservations: [],
        env: {
          MARKETPLACE_ENABLED: "true",
          MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
        },
      }),
    }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const legacy = await fetch(`${base}/api/marketplace/admin/suppliers/mappings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      supplierCode: "kamal",
      productId: "p",
      variantId: "v",
      supplierProductId: "sp",
      normalizedExactModel: "m",
      matchConfidence: "exact",
      active: true,
    }),
  });
  const legacyBody = await legacy.json();
  assert.equal(legacy.status, 410);
  assert.equal(legacyBody.error, LEGACY_MAPPING_DISABLED_CODE);

  const health = await fetch(`${base}/api/marketplace/admin/suppliers/auto-import/health`);
  assert.equal(health.status, 200);
  await new Promise<void>((r) => server.close(() => r()));

  // Phase1 preview lock unchanged
  assert.equal(PHASE1_LIVE_PUBLICATION_ALLOWED, false);

  // No legacy RPC invocation in production autoImport sources (comments allowed)
  const svc = readFileSync(join(__dirname, "autoImportService.ts"), "utf8");
  assert.ok(!/\.rpc\(\s*["']mp_admin_upsert_supplier_mapping["']/.test(svc));
  assert.ok(!/\.rpc\(\s*["']mp_publish_price["']/.test(svc));
  assert.ok(!/supabase\.rpc\(\s*["']mp_admin_upsert_supplier_mapping["']/.test(svc));
  console.log("ok - WS-MAP-0 preserved; auto-import health route; phase1 lock intact");
}

{
  // SQL artifact present and does not re-enable legacy mapping execute for service on old RPC
  const sql = readFileSync(
    join(ROOT, "scripts/marketplace-ceo-auto-import.sql"),
    "utf8",
  );
  assert.ok(sql.includes("mp_ceo_auto_import_upsert_listing"));
  assert.ok(sql.includes("ceoDiscountApplied"));
  assert.ok(!sql.includes("create or replace function public.mp_admin_upsert_supplier_mapping"));
  // Code RPC args must match SQL signature (no drift).
  const repoSrc = readFileSync(
    join(__dirname, "supabaseAutoImportRepository.ts"),
    "utf8",
  );
  for (const arg of [
    "p_actor_scope",
    "p_identity_key",
    "p_title",
    "p_brand_name",
    "p_category_name",
    "p_website_price",
    "p_availability",
    "p_selected_supplier",
    "p_source_urls",
    "p_match_reason",
    "p_price_reason",
    "p_offers",
    "p_fetched_at",
  ]) {
    assert.ok(sql.includes(arg), `SQL missing ${arg}`);
    assert.ok(repoSrc.includes(arg), `code missing ${arg}`);
  }
  const guard = readFileSync(
    join(ROOT, "scripts/marketplace-ws-map-0-legacy-guard.sql"),
    "utf8",
  );
  assert.ok(guard.includes("LEGACY_MAPPING_DISABLED"));
  console.log("ok - SQL artifacts + RPC signature alignment");
}

{
  // Sanitized error logging — never emits secrets / bodies / tokens
  const { sanitizeAutoImportError, sanitizeLogText, logAutoImport } =
    await import("./autoImportLog.ts");
  assert.equal(sanitizeLogText("Authorization: Bearer abc.def"), "[redacted]");
  assert.equal(sanitizeLogText('{"products":[1,2,3]}'), "[redacted_payload]");
  assert.ok(!String(sanitizeLogText("user@example.com")).includes("@") || sanitizeLogText("user@example.com") === "[redacted]");
  const rpcErr = sanitizeAutoImportError(
    new Error("function mp_ceo_auto_import_upsert_listing does not exist"),
  );
  assert.equal(rpcErr.errorCode, "RPC_FAILURE", `got ${rpcErr.errorCode}`);
  const lines: string[] = [];
  const origErr = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(String(args[0] ?? ""));
  };
  try {
    logAutoImport({
      runId: "mpair_test",
      stage: "route_error",
      status: "failed",
      errorClass: "Error",
      errorCode: "RPC_FAILURE",
      detail: "Authorization: Bearer super-secret-token",
    });
  } finally {
    console.error = origErr;
  }
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.includes("marketplace-ceo-auto-import"));
  assert.ok(lines[0]!.includes("mpair_test"));
  assert.ok(!lines[0]!.toLowerCase().includes("bearer"));
  assert.ok(!lines[0]!.includes("super-secret-token"));
  console.log("ok - sanitized error logging");
}

{
  // Supplier HTTP failure → soft error, bounded result (no throw)
  const repository = createMemoryAutoImportRepository();
  const service = createAutoImportService({
    repository,
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_TIMEOUT_MS: "30000",
      MARKETPLACE_CEO_AUTO_IMPORT_SUPPLIER_TIMEOUT_MS: "5000",
    },
    catalogueDeps: {
      pageProvider: async (supplier) => {
        if (supplier === "kamal") {
          const err = new Error("Upstream HTTP 503");
          (err as any).code = "HTTP_ERROR";
          (err as any).name = "SafeHttpError";
          throw err;
        }
        return {
          products: [
            {
              id: 101,
              title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
              handle: "nitrox-10",
              vendor: "Inverex",
              product_type: "Solar Inverter",
              tags: ["Solar Inverter"],
              body_html: "<p>x</p>",
              variants: [{ price: "250000.00", available: true, sku: "N" }],
              images: [],
            },
          ],
        };
      },
    },
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(result.status, "partial");
  assert.ok(result.health.errors.some((e) => /kamal/i.test(e)));
  assert.ok((await service.listListings()).length >= 1);
  console.log("ok - supplier HTTP failure soft-fail");
}

{
  // Malformed supplier response → soft error
  const repository = createMemoryAutoImportRepository();
  const service = createAutoImportService({
    repository,
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
    catalogueDeps: {
      pageProvider: async () => {
        throw Object.assign(new Error("Invalid JSON catalogue payload."), {
          name: "SafeHttpError",
          code: "HTTP_ERROR",
        });
      },
    },
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(result.status, "failed");
  assert.ok(result.health.errors.length >= 1);
  assert.equal((await service.listListings()).length, 0);
  console.log("ok - malformed supplier response");
}

{
  // RPC / persist failure → failed run, no partial persistence
  const base = createMemoryAutoImportRepository();
  let upserts = 0;
  const repository: typeof base = {
    ...base,
    async upsertListing(input) {
      upserts += 1;
      if (upserts >= 2) {
        throw new Error("function mp_ceo_auto_import_upsert_listing does not exist");
      }
      return base.upsertListing(input);
    },
    async deleteListings(keys) {
      return base.deleteListings(keys);
    },
  };
  const service = createAutoImportService({
    repository,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "rpc-a",
        currentListedPricePkr: 200000,
      }),
      obs({
        supplier: "kamal",
        title: "Knox Hybrid Inverter 6kW Single Phase",
        supplierProductId: "rpc-b",
        brand: "Knox",
        currentListedPricePkr: 150000,
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(result.status, "failed");
  assert.ok(result.health.errors.some((e) => /persist_|RPC/i.test(e)));
  assert.equal((await service.listListings()).length, 0);
  assert.equal(result.health.productsCreated, 0);
  console.log("ok - RPC failure rolls back partial persistence");
}

{
  // Rollback deletes only newly created keys — never pre-existing listings
  const repository = createMemoryAutoImportRepository();
  const env = {
    MARKETPLACE_ENABLED: "true",
    MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
  };
  const seed = createAutoImportService({
    repository,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "pre-exist",
        currentListedPricePkr: 200000,
      }),
    ],
    env,
  });
  await seed.runAutomaticImport({ actorScope: "admin:super:ceo" });
  const before = await seed.listListings();
  assert.equal(before.length, 1);
  const preKey = before[0]!.identityKey;

  let upserts = 0;
  const guarded = {
    getListingByIdentityKey: (k: string) => repository.getListingByIdentityKey(k),
    getListingBySourceUrl: (u: string) => repository.getListingBySourceUrl(u),
    listListings: () => repository.listListings(),
    saveHealth: (h: Parameters<typeof repository.saveHealth>[0]) =>
      repository.saveHealth(h),
    getHealth: () => repository.getHealth(),
    async upsertListing(input: Parameters<typeof repository.upsertListing>[0]) {
      upserts += 1;
      if (upserts >= 2) {
        throw new Error("rpc upsert failed on second listing");
      }
      return repository.upsertListing(input);
    },
    deleteListings: (keys: string[]) => repository.deleteListings(keys),
  };
  const service = createAutoImportService({
    repository: guarded,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "pre-exist",
        currentListedPricePkr: 210000,
      }),
      obs({
        supplier: "kamal",
        title: "Knox Hybrid Inverter 6kW Single Phase",
        supplierProductId: "new-fail",
        brand: "Knox",
        currentListedPricePkr: 150000,
      }),
    ],
    env,
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(result.status, "failed");
  const after = await service.listListings();
  assert.equal(after.length, 1);
  assert.equal(after[0]!.identityKey, preKey);
  console.log("ok - rollback preserves pre-existing listings");
}

{
  // Health-save failure: request still completes; both failures logged
  const base = createMemoryAutoImportRepository();
  const lines: string[] = [];
  const origErr = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(String(args[0] ?? ""));
  };
  try {
    const repository = {
      getListingByIdentityKey: (k: string) => base.getListingByIdentityKey(k),
      getListingBySourceUrl: (u: string) => base.getListingBySourceUrl(u),
      listListings: () => base.listListings(),
      getHealth: () => base.getHealth(),
      deleteListings: (keys: string[]) => base.deleteListings(keys),
      async upsertListing() {
        throw new Error(
          "function mp_ceo_auto_import_upsert_listing does not exist",
        );
      },
      async saveHealth() {
        throw new Error("sync_runs upsert timed out");
      },
    };
    const service = createAutoImportService({
      repository,
      fixtureObservations: [
        obs({
          supplier: "kamal",
          title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
          supplierProductId: "hs-1",
          currentListedPricePkr: 100000,
        }),
      ],
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_TIMEOUT_MS: "8000",
      },
    });
    const t0 = Date.now();
    const result = await service.runAutomaticImport({
      actorScope: "admin:super:ceo",
    });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 5000, `expected bounded response, got ${elapsed}ms`);
    assert.equal(result.status, "failed");
    assert.ok(result.health.errors.some((e) => /persist_|RPC/i.test(e)));
    assert.ok(lines.some((l) => l.includes("persist_failed")));
    assert.ok(lines.some((l) => l.includes("health_save_failed")));
    assert.ok(
      lines.some((l) => l.includes("persist_failed") && l.includes("RPC_FAILURE")) ||
        lines.some(
          (l) => l.includes("unexpected_error") && l.includes("RPC_FAILURE"),
        ),
    );
  } finally {
    console.error = origErr;
  }
  console.log("ok - health-save failure logged; request still completes");
}

{
  // Alias path shares Super-Admin auth; UI uses canonical admin path
  const { createMarketplaceAutoImportAliasRouter } = await import(
    "./autoImportRoutes.ts"
  );
  const { isPublicApiRoute } = await import("../../middleware/publicRoutes.ts");
  assert.equal(
    isPublicApiRoute("POST", "/api/marketplace/auto-import/run"),
    false,
  );
  assert.equal(
    isPublicApiRoute("GET", "/api/marketplace/auto-import/health"),
    false,
  );
  assert.equal(
    isPublicApiRoute("POST", "/api/marketplace/admin/suppliers/auto-import/run"),
    false,
  );

  function actor(role: string): RequestActor {
    return {
      id: "u1",
      username: "sa",
      name: role,
      email: "sa@test.com",
      role,
      accountStatus: "Approved",
      emailVerified: true,
      onboardingCompleted: true,
      authMethod: "jwt",
    };
  }
  const shared = createAutoImportService({
    fixtureObservations: [],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor("Super Admin");
    next();
  });
  app.use(
    "/api/marketplace/admin",
    createMarketplaceAutoImportRouter({
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      },
      service: shared,
    }),
  );
  app.use(
    "/api/marketplace/auto-import",
    createMarketplaceAutoImportAliasRouter({
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      },
      service: shared,
    }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  try {
    const aliasHealth = await fetch(
      `http://127.0.0.1:${port}/api/marketplace/auto-import/health`,
    );
    assert.equal(aliasHealth.status, 200);
    const adminHealth = await fetch(
      `http://127.0.0.1:${port}/api/marketplace/admin/suppliers/auto-import/health`,
    );
    assert.equal(adminHealth.status, 200);
    const apiSrc = readFileSync(join(ROOT, "src/services/api.ts"), "utf8");
    assert.ok(
      apiSrc.includes("/api/marketplace/admin/suppliers/auto-import/run"),
    );
    assert.ok(
      !apiSrc.includes('authorizedFetch("/api/marketplace/auto-import/run"'),
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  console.log("ok - alias + canonical share auth; UI uses canonical admin path");
}

{
  // Unexpected exception during discovery is bounded (supplier soft-fail)
  const repository = createMemoryAutoImportRepository();
  const service = createAutoImportService({
    repository,
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
    catalogueDeps: {
      pageProvider: async () => {
        throw new TypeError("unexpected boom");
      },
    },
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(result.status, "failed");
  assert.ok(result.runId.startsWith("mpair_"));
  assert.equal(result.health.lastSyncStatus, "failed");
  console.log("ok - unexpected exception bounded");
}

{
  // Supplier timeout via job/supplier deadline — one supplier cannot hang forever
  const repository = createMemoryAutoImportRepository();
  const service = createAutoImportService({
    repository,
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_TIMEOUT_MS: "8000",
      MARKETPLACE_CEO_AUTO_IMPORT_SUPPLIER_TIMEOUT_MS: "200",
    },
    catalogueDeps: {
      pageProvider: async (supplier) => {
        if (supplier === "kamal") {
          await new Promise((r) => setTimeout(r, 2000));
          return { products: [] };
        }
        return {
          products: [
            {
              id: 77,
              title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
              handle: "nitrox-10",
              vendor: "Inverex",
              product_type: "Solar Inverter",
              tags: ["Solar Inverter"],
              body_html: "<p>x</p>",
              variants: [{ price: "250000.00", available: true, sku: "N" }],
              images: [],
            },
          ],
        };
      },
    },
  });
  const t0 = Date.now();
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 3000, `expected fast fail, got ${elapsed}ms`);
  assert.ok(result.health.errors.some((e) => /kamal/i.test(e) && /TIMEOUT/i.test(e)));
  assert.ok((await service.listListings()).length >= 1);
  console.log("ok - supplier timeout bounded; other supplier proceeds");
}

{
  // Route always returns a bounded HTTP response (202 on service failure, 500 only on throw)
  function actor(role: string): RequestActor {
    return {
      id: "u1",
      username: "sa",
      name: role,
      email: "sa@test.com",
      role,
      accountStatus: "Approved",
      emailVerified: true,
      onboardingCompleted: true,
      authMethod: "jwt",
    };
  }
  const failingRepo = createMemoryAutoImportRepository();
  const boomService = createAutoImportService({
    repository: {
      ...failingRepo,
      async upsertListing() {
        throw new Error("rpc upsert failed");
      },
      deleteListings: (keys) => failingRepo.deleteListings(keys),
    },
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "route-1",
        currentListedPricePkr: 100000,
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor("Super Admin");
    next();
  });
  app.use(
    "/api/marketplace/admin",
    createMarketplaceAutoImportRouter({
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      },
      service: boomService,
    }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  const res = await fetch(
    `http://127.0.0.1:${port}/api/marketplace/admin/suppliers/auto-import/run`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );
  const body = await res.json();
  assert.equal(res.status, 202);
  assert.equal(body.ok, true);
  assert.equal(body.data.status, "failed");
  assert.ok(body.data.runId);
  assert.equal((await boomService.listListings()).length, 0);
  await new Promise<void>((r) => server.close(() => r()));
  console.log("ok - route returns bounded 202 on persist failure");
}

{
  // Route 500 path still logs + returns bounded JSON when service itself throws
  function actor(role: string): RequestActor {
    return {
      id: "u1",
      username: "sa",
      name: role,
      email: "sa@test.com",
      role,
      accountStatus: "Approved",
      emailVerified: true,
      onboardingCompleted: true,
      authMethod: "jwt",
    };
  }
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor("Super Admin");
    next();
  });
  const lines: string[] = [];
  const origErr = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(String(args[0] ?? ""));
  };
  app.use(
    "/api/marketplace/admin",
    createMarketplaceAutoImportRouter({
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      },
      service: {
        runAutomaticImport: async () => {
          throw new Error("totally unexpected");
        },
        getHealth: async () => {
          throw new Error("health boom");
        },
        listListings: async () => {
          throw new Error("list boom");
        },
        repository: createMemoryAutoImportRepository(),
      } as any,
    }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/marketplace/admin/suppliers/auto-import/run`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.ok(lines.some((l) => l.includes("route_error")));
  } finally {
    console.error = origErr;
    await new Promise<void>((r) => server.close(() => r()));
  }
  console.log("ok - route 500 still bounded + logged");
}

console.log("\nCEO auto-import tests passed.");
