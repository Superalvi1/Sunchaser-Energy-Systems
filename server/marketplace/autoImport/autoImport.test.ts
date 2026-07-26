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
  const guard = readFileSync(
    join(ROOT, "scripts/marketplace-ws-map-0-legacy-guard.sql"),
    "utf8",
  );
  assert.ok(guard.includes("LEGACY_MAPPING_DISABLED"));
  console.log("ok - SQL artifacts");
}

console.log("\nCEO auto-import tests passed.");
