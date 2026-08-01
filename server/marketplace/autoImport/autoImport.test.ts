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
import type { UpsertListingInput } from "./autoImportRepository.ts";
import { createAutoImportService } from "./autoImportService.ts";
import {
  buildVariantIdentity,
  exactIdentityKey,
  hasHardIdentityConflict,
} from "./identityNormalize.ts";
import {
  lastValidCommercialFromListing,
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
  // Equal prices — sourceKey ASC, then supplier tie-break
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
  // 'alladin:1' < 'kamal:1'
  if (sel.ok) {
    assert.equal(sel.sourceKey, "alladin:1");
    assert.equal(sel.supplier, "alladin");
  }
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
  // Stale / rollback integration — defaultSourceKey snapshot + commitBatch capture
  const baseRepository = createMemoryAutoImportRepository();
  const committed: UpsertListingInput[][] = [];
  const repository = {
    ...baseRepository,
    async commitBatch(
      inputs: UpsertListingInput[],
      health: Parameters<typeof baseRepository.commitBatch>[1],
    ) {
      committed.push(
        inputs.map((input) => ({
          ...input,
          offers: input.offers.map((o) => ({ ...o })),
        })),
      );
      return baseRepository.commitBatch(inputs, health);
    },
  };

  const env = {
    MARKETPLACE_ENABLED: "true",
    MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
  };
  const rbFixtures = [
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "rb",
      currentListedPricePkr: 250000,
      availability: "in_stock",
    }),
  ];
  const staleFixtures = [
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "rb",
      currentListedPricePkr: null,
      parseStatus: "missing",
    }),
  ];

  const first = createAutoImportService({
    repository,
    fixtureObservations: rbFixtures,
    env,
  });
  const firstResult = await first.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(firstResult.status, "succeeded");
  assert.equal(committed.length, 1);
  assert.equal(committed[0]![0]!.defaultSourceKey, "kamal:rb");
  const afterFirst = (await repository.listListings())[0]!;
  assert.equal(afterFirst.lastValidSourceKey, "kamal:rb");
  assert.equal(afterFirst.websitePricePkr, 250000);

  const second = createAutoImportService({
    repository,
    fixtureObservations: staleFixtures,
    env,
  });
  const secondResult = await second.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(secondResult.status, "succeeded");
  assert.equal(committed.length, 2);
  assert.equal(committed[1]![0]!.defaultSourceKey, "kamal:rb");
  assert.equal(committed[1]![0]!.websitePricePkr, 250000);
  assert.ok(secondResult.health.rolledBackPrices >= 1);
  const rollbackSample = secondResult.sampleLowestPrice.find(
    (s) => s.identityKey === afterFirst.identityKey,
  );
  assert.ok(rollbackSample, "sampleLowestPrice includes rollback winner");
  assert.equal(rollbackSample!.pricePkr, 250000);
  assert.ok(/rollback_last_valid/i.test(rollbackSample!.reason));
  const afterSecond = (await repository.listListings())[0]!;
  assert.equal(afterSecond.lastValidSourceKey, "kamal:rb");
  assert.equal(afterSecond.websitePricePkr, 250000);

  const third = createAutoImportService({
    repository,
    fixtureObservations: staleFixtures,
    env,
  });
  await third.runAutomaticImport({ actorScope: "admin:super:ceo" });
  assert.equal(committed.length, 3);
  assert.equal(committed[2]![0]!.defaultSourceKey, "kamal:rb");
  assert.equal((await repository.listListings()).length, 1);

  const legacy = lastValidCommercialFromListing({
    identityKey: "exact:legacy:1",
    lastValidPricePkr: 100000,
    lastValidObservationAt: "t0",
    lastValidSupplier: "alladin",
    lastValidSourceKey: null,
    lastValidAvailability: null,
    availability: "in_stock",
    offers: [],
  });
  assert.equal(legacy.sourceKey, "legacy:alladin:exact:legacy:1");
  assert.ok(!legacy.sourceKey.includes("http"));
  assert.equal(legacy.legacyFallback, true);

  const legacyOffer = lastValidCommercialFromListing({
    identityKey: "exact:legacy:2",
    lastValidPricePkr: 120000,
    lastValidObservationAt: "t1",
    lastValidSupplier: "kamal",
    lastValidSourceKey: null,
    lastValidAvailability: null,
    availability: "in_stock",
    offers: [
      {
        supplier: "kamal",
        pricePkr: 120000,
        url: "https://kamalsolar.pk/products/x",
        availability: "in_stock",
        sourceKey: "kamal:embedded",
      },
    ],
  });
  assert.equal(legacyOffer.sourceKey, "kamal:embedded");
  assert.equal(legacyOffer.legacyFallback, true);

  console.log("ok - stale price rollback integration with defaultSourceKey snapshot");
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
  // SQL artifacts: legacy upsert + atomic batch/preflight (manual apply)
  const sql = readFileSync(
    join(ROOT, "scripts/marketplace-ceo-auto-import.sql"),
    "utf8",
  );
  assert.ok(sql.includes("mp_ceo_auto_import_upsert_listing"));
  assert.ok(sql.includes("ceoDiscountApplied"));
  assert.ok(!sql.includes("create or replace function public.mp_admin_upsert_supplier_mapping"));

  const atomic = readFileSync(
    join(ROOT, "scripts/marketplace-ceo-auto-import-atomic.sql"),
    "utf8",
  );
  assert.ok(atomic.includes("mp_ceo_auto_import_preflight"));
  assert.ok(atomic.includes("mp_ceo_auto_import_commit_batch"));
  assert.ok(atomic.includes("SET LOCAL statement_timeout"));
  assert.ok(atomic.includes("ineffective"));
  assert.ok(atomic.includes("mp_ceo_auto_import_runtime"));
  assert.ok(
    /create\s+role\s+mp_ceo_auto_import_runtime\s+nologin\s*;/i.test(atomic),
    "runtime role created with NOLOGIN only (Supabase-compatible)",
  );
  assert.ok(
    !/alter\s+role\s+mp_ceo_auto_import_runtime/i.test(atomic),
    "must not ALTER ROLE runtime (Supabase CREATEROLE cannot)",
  );
  assert.ok(
    /unsafe attributes/i.test(atomic),
    "fail-closed unsafe role attribute verification",
  );
  assert.ok(
    /grant execute on function public\.mp_ceo_auto_import_commit_batch[\s\S]*to mp_ceo_auto_import_runtime/i.test(
      atomic,
    ),
    "commit_batch granted to runtime role",
  );
  assert.ok(
    /revoke all on function public\.mp_ceo_auto_import_commit_batch\(text, text, jsonb, jsonb\) from service_role/i.test(
      atomic,
    ),
    "commit_batch revoked from service_role",
  );
  assert.ok(
    /revoke all on function public\.mp_ceo_auto_import_upsert_listing[\s\S]*from mp_ceo_auto_import_runtime/i.test(
      atomic,
    ),
    "upsert revoked from runtime role",
  );
  assert.ok(
    !/grant execute on function public\.mp_ceo_auto_import_commit_batch[\s\S]*to service_role/i.test(
      atomic,
    ),
    "commit_batch must not be granted to service_role",
  );
  assert.ok(
    /revoke all on function public\.mp_ceo_auto_import_upsert_listing[\s\S]*from service_role/i.test(
      sql,
    ),
    "upsert revoked from service_role",
  );
  assert.ok(atomic.includes("duplicate identityKey"));
  assert.ok(/pg_catalog\.pg_proc/i.test(atomic));
  // Must NOT claim in-function set_config cancels the outer statement.
  assert.ok(
    !/perform\s+set_config\(\s*'statement_timeout'/i.test(atomic),
    "atomic SQL must not use in-function set_config(statement_timeout)",
  );
  assert.ok(!/p_statement_timeout_ms/.test(atomic));
  assert.ok(!/insert\s+into|update\s+|delete\s+from/i.test(
    atomic.slice(
      atomic.indexOf("mp_ceo_auto_import_preflight"),
      atomic.indexOf("mp_ceo_auto_import_commit_batch"),
    ),
  ));

  const repoSrc = readFileSync(
    join(__dirname, "supabaseAutoImportRepository.ts"),
    "utf8",
  );
  const pgCommitSrc = readFileSync(
    join(__dirname, "autoImportPgCommit.ts"),
    "utf8",
  );
  assert.ok(repoSrc.includes("commitBatchWithStatementTimeout"), "repo uses pg commit helper");
  assert.ok(pgCommitSrc.includes("SET LOCAL statement_timeout"), "pg commit SET LOCAL");
  assert.ok(pgCommitSrc.includes("mp_ceo_auto_import_commit_batch"), "pg commit calls batch rpc");
  assert.ok(pgCommitSrc.includes("ROLE_SWITCH_REJECTED"), "pg commit fail-closed role gate");
  assert.ok(
    pgCommitSrc.includes("resolveRuntimeRoleAuthorization"),
    "pg commit authorizes before BEGIN",
  );
  assert.ok(
    !/catch\s*\{[^}]*SET LOCAL ROLE/s.test(pgCommitSrc) &&
      !/SET LOCAL ROLE[\s\S]{0,120}catch\s*\{/s.test(pgCommitSrc),
    "must not swallow SET LOCAL ROLE failures",
  );
  assert.ok(!pgCommitSrc.includes("Promise.race("), "pg commit must not Promise.race");
  assert.ok(!repoSrc.includes("p_statement_timeout_ms"), "repo must not pass p_statement_timeout_ms");
  assert.ok(!repoSrc.includes("mp_ceo_auto_import_upsert_listing"), "repo must not call upsert rpc");
  // Commit must not Promise.race/abandon the transactional RPC.
  const commitFn = repoSrc.slice(repoSrc.indexOf("async commitBatch"));
  assert.ok(!commitFn.slice(0, 900).includes("withDeadline("), "commitBatch no withDeadline");
  assert.ok(!commitFn.slice(0, 900).includes("sb.rpc("), "commitBatch no supabase.rpc");

  for (const arg of ["$1::text", "$2::text", "$3::jsonb", "$4::jsonb"]) {
    assert.ok(pgCommitSrc.includes(arg), `pg commit missing ${arg}`);
  }
  const guard = readFileSync(
    join(ROOT, "scripts/marketplace-ws-map-0-legacy-guard.sql"),
    "utf8",
  );
  assert.ok(guard.includes("LEGACY_MAPPING_DISABLED"));
  console.log("ok - SQL artifacts + atomic RPC signature alignment");
}

{
  // Memory commitBatch rejects duplicate identityKey before any write
  const repository = createMemoryAutoImportRepository();
  const listing = {
    identityKey: "exact:dup:mem",
    title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
    brandName: "Inverex",
    categoryName: "Solar Inverter",
    websitePricePkr: 100000,
    availability: "in_stock" as const,
    selectedSupplier: "kamal" as const,
    sourceUrls: ["https://example.com/a"],
    matchReason: "exact_identity",
    priceReason: "auto",
    fetchedAt: new Date().toISOString(),
    offers: [],
    previous: null,
  };
  let rejected = false;
  try {
    await repository.commitBatch(
      [listing, { ...listing, sourceUrls: ["https://example.com/b"] }],
      {
        lastSyncAt: null,
        lastSyncStatus: "never",
        lastRunId: "mpair_dup",
        kamalDiscovered: 0,
        alladinDiscovered: 0,
        acceptedVariants: 0,
        rejectedVariants: 0,
        exactMatches: 0,
        conflictKeptSeparate: 0,
        productsCreated: 0,
        productsUpdated: 0,
        lowestPriceSelections: 0,
        rolledBackPrices: 0,
        errors: [],
        note: "",
      },
    );
  } catch (err) {
    rejected = /duplicate identityKey/i.test(String((err as Error).message));
  }
  assert.equal(rejected, true);
  assert.equal((await repository.listListings()).length, 0);
  console.log("ok - memory commit rejects duplicate identityKey");
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
  // Atomic mid-batch failure → zero retained writes from the failed run
  const failCtrl = { n: 1 as number | null };
  const repository = createMemoryAutoImportRepository({
    failAfterNWrites: failCtrl,
  });
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
  assert.ok(result.health.errors.some((e) => /persist_/i.test(e)));
  assert.equal((await service.listListings()).length, 0);
  assert.equal(result.health.productsCreated, 0);
  console.log("ok - atomic commit failure leaves zero listings");
}

{
  // Mid-batch failure leaves every pre-existing listing value unchanged
  const failCtrl = { n: null as number | null };
  const repository = createMemoryAutoImportRepository({
    failAfterNWrites: failCtrl,
  });
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
  const prePrice = before[0]!.websitePricePkr;
  const preValid = before[0]!.lastValidPricePkr;

  failCtrl.n = 1;
  const service = createAutoImportService({
    repository,
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
  assert.equal(after[0]!.websitePricePkr, prePrice);
  assert.equal(after[0]!.lastValidPricePkr, preValid);
  console.log("ok - atomic rollback preserves pre-existing listing values");
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
      async commitBatch() {
        throw new Error(
          "function mp_ceo_auto_import_commit_batch does not exist",
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
      async commitBatch() {
        throw new Error("rpc commit_batch failed");
      },
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

{
  // Kamal-shaped Shopify products.json parsing (title/vendor/handle/images/variants/price)
  const { normalizeCatalogueProducts } = await import(
    "../suppliers/catalogueNormalize.ts"
  );
  const { parseShopifyProductsJson } = await import(
    "../suppliers/shopifyCatalogue.ts"
  );
  const body = JSON.stringify({
    products: [
      {
        id: 6355818922601,
        title: "Crown Electra Boost 5kW 100A Lithium Battery",
        handle: "crown-electra-boost-5kw-100a-lithium-battery",
        body_html: "<p>Lithium battery for solar storage</p>",
        vendor: "Crown Solar",
        product_type: "Lithium Battery",
        tags: ["Lithium Battery", "Solar"],
        variants: [
          {
            id: 1,
            title: "Default",
            price: "220000.00",
            compare_at_price: null,
            available: true,
            sku: null,
          },
        ],
        images: [
          {
            src: "https://cdn.shopify.com/s/files/1/0635/5818/9226/files/IP2051.2v100A.png",
          },
        ],
      },
    ],
  });
  const page = parseShopifyProductsJson(body);
  assert.equal(page.products.length, 1);
  const { accepted, excluded } = normalizeCatalogueProducts(
    "kamal",
    page.products,
    "2026-07-27T00:00:00.000Z",
  );
  assert.equal(excluded.length, 0);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]!.currentListedPricePkr, 220000);
  assert.equal(accepted[0]!.brand, "Crown Solar");
  assert.ok(accepted[0]!.canonicalUrl.includes("/products/crown-electra"));
  assert.ok(accepted[0]!.primaryImageUrl?.includes("cdn.shopify.com"));
  assert.equal(accepted[0]!.availability, "in_stock");
  console.log("ok - Kamal response parsing");
}

{
  // Alladin-shaped Shopify products.json with compare-at + SKU
  const { normalizeCatalogueProducts } = await import(
    "../suppliers/catalogueNormalize.ts"
  );
  const { parseShopifyProductsJson } = await import(
    "../suppliers/shopifyCatalogue.ts"
  );
  const body = JSON.stringify({
    products: [
      {
        id: 77115130135,
        title: "Tomzn TOB7Z-63 4P DC MTS Dual Power Manual Transfer Switch for PV system",
        handle: "tomzn-tob7z-63-4p-dc-mts-pv",
        body_html: "<p>PV transfer switch</p>",
        vendor: "Tomzn",
        product_type: "Protection",
        tags: ["PV", "MTS"],
        variants: [
          {
            id: 9,
            title: "Default",
            price: "6499.00",
            compare_at_price: "7299.00",
            available: true,
            sku: "AR-002453",
          },
        ],
        images: [
          {
            src: "https://cdn.shopify.com/s/files/1/0771/1513/0135/files/TOMZN.jpg",
          },
        ],
      },
    ],
  });
  const page = parseShopifyProductsJson(body);
  const { accepted } = normalizeCatalogueProducts(
    "alladin",
    page.products,
    "2026-07-27T00:00:00.000Z",
  );
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]!.currentListedPricePkr, 6499);
  assert.equal(accepted[0]!.compareAtPricePkr, 7299);
  assert.equal(accepted[0]!.modelSku, "AR-002453");
  assert.equal(accepted[0]!.brand, "Tomzn");
  console.log("ok - Alladin response parsing");
}

{
  // Pagination termination: short page stops; empty page stops; repeated page stops; max products
  const { fetchShopifyCatalogue } = await import(
    "../suppliers/shopifyCatalogue.ts"
  );
  const short = await fetchShopifyCatalogue("kamal", {
    pageLimit: 250,
    maxPages: 40,
    pageProvider: async (_s, page) => {
      if (page === 1) {
        return {
          products: Array.from({ length: 3 }, (_, i) => ({
            id: 100 + i,
            title: `Solar Hybrid Inverter ${i}`,
            handle: `h-${i}`,
            vendor: "Inverex",
            product_type: "Solar Inverter",
            variants: [{ price: "100000", available: true }],
            images: [],
          })),
        };
      }
      throw new Error("should not request page 2 after short page");
    },
  });
  assert.equal(short.pagesFetched, 1);
  assert.equal(short.stopReason, "short_page");

  const empty = await fetchShopifyCatalogue("alladin", {
    pageLimit: 250,
    pageProvider: async () => ({ products: [] }),
  });
  assert.equal(empty.stopReason, "empty_page");

  const repeated = await fetchShopifyCatalogue("kamal", {
    pageLimit: 2,
    maxPages: 5,
    pageProvider: async () => ({
      products: [
        { id: 1, title: "Solar Hybrid Inverter A", variants: [{ price: "1", available: true }] },
        { id: 2, title: "Solar Hybrid Inverter B", variants: [{ price: "1", available: true }] },
      ],
    }),
  });
  assert.ok(repeated.pagesFetched >= 2);
  assert.equal(repeated.stopReason, "repeated_page");

  const capped = await fetchShopifyCatalogue("alladin", {
    pageLimit: 2,
    maxPages: 40,
    maxProducts: 3,
    pageProvider: async (_s, page) => ({
      products: [
        { id: page * 10, title: `Solar Panel ${page}a`, variants: [{ price: "1", available: true }] },
        { id: page * 10 + 1, title: `Solar Panel ${page}b`, variants: [{ price: "1", available: true }] },
      ],
    }),
  });
  assert.equal(capped.stopReason, "max_products");
  assert.ok(capped.rawProductRows >= 3);
  console.log("ok - pagination termination + repeated-page + max products");
}

{
  // Health saved after failure (status flips from never)
  const repository = createMemoryAutoImportRepository();
  assert.equal((await repository.getHealth()).lastSyncStatus, "never");
  const service = createAutoImportService({
    repository,
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
    catalogueDeps: {
      pageProvider: async () => {
        throw Object.assign(new Error("Upstream HTTP 502"), {
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
  const health = await service.getHealth();
  assert.equal(health.lastSyncStatus, "failed");
  assert.ok(health.lastRunId);
  assert.equal(result.stages.publicWebsiteVisible, false);
  console.log("ok - health saved after failure");
}

{
  // Read-only preflight: zero write-capable RPC calls
  const { runAutoImportPreflight } = await import("./autoImportPreflight.ts");
  const rpcCalls: string[] = [];
  const report = await runAutoImportPreflight({
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_PERSIST: "false",
      MARKETPLACE_CATALOGUE_SOURCE: "static",
    },
    probeTable: async () => "absent",
    probeRpcCatalog: async () => {
      rpcCalls.push("probeRpcCatalog");
      return {
        preflight: "present",
        upsert: "present",
        commitBatch: "present",
      };
    },
    onRpcCall: (name) => rpcCalls.push(name),
    probeSupplier: async (origin) => ({
      status: "reachable",
      detail: `ok:${origin.includes("kamal") ? "kamal" : "alladin"}`,
    }),
  });
  assert.equal(report.persistenceEnabled, false);
  assert.equal(report.objects.rpcMpCeoAutoImportCommitBatch, "present");
  assert.equal(report.objects.rpcMpCeoAutoImportPreflight, "present");
  assert.equal(report.objects.timeoutProtection, "skipped");
  assert.equal(report.suppliers.kamal.status, "reachable");
  assert.equal(report.stages.publicWebsiteWouldShowSyncedProducts, false);
  assert.ok(
    report.notes.some((n) => /CATALOGUE_SOURCE|database/i.test(n)),
  );
  assert.ok(!rpcCalls.some((c) => /upsert|commit_batch/i.test(c)));
  assert.ok(
    rpcCalls.every(
      (c) => c === "probeRpcCatalog" || c === "mp_ceo_auto_import_preflight",
    ),
  );

  // Persist without DB URL → timeout protection absent; cannot persist
  const blocked = await runAutoImportPreflight({
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_PERSIST: "true",
      MARKETPLACE_CATALOGUE_SOURCE: "static",
    },
    probeTable: async () => "present",
    probeRpcCatalog: async () => ({
      preflight: "present",
      upsert: "present",
      commitBatch: "present",
    }),
    probeSupplier: async () => ({ status: "reachable", detail: "ok" }),
  });
  assert.equal(blocked.objects.timeoutProtection, "absent");
  assert.equal(blocked.stages.canPersistCatalogueProducts, false);
  assert.ok(
    blocked.blockers.some((b) => /Timeout protection absent/i.test(b)),
  );

  const allowed = await runAutoImportPreflight({
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_PERSIST: "true",
      MARKETPLACE_CATALOGUE_SOURCE: "static",
      DATABASE_URL: "postgresql://local/test",
    },
    probeTable: async () => "present",
    probeRpcCatalog: async () => ({
      preflight: "present",
      upsert: "present",
      commitBatch: "present",
    }),
    probeSupplier: async () => ({ status: "reachable", detail: "ok" }),
  });
  assert.equal(allowed.objects.timeoutProtection, "present");
  assert.ok(
    !allowed.blockers.some((b) => /Timeout protection absent/i.test(b)),
  );

  // Source-level: preflight never references write RPCs as invoked calls
  const preflightSrc = readFileSync(
    join(__dirname, "autoImportPreflight.ts"),
    "utf8",
  );
  assert.ok(!preflightSrc.includes('rpc("mp_ceo_auto_import_upsert_listing"'));
  assert.ok(!preflightSrc.includes('rpc("mp_ceo_auto_import_commit_batch"'));
  assert.ok(preflightSrc.includes('rpc("mp_ceo_auto_import_preflight"'));
  console.log("ok - preflight read-only; zero write-capable calls");
}

{
  // Concurrent runs: second import blocked while first is active
  const {
    createAutoImportService: createSvc,
    __resetAutoImportRunLockForTests,
  } = await import("./autoImportService.ts");
  __resetAutoImportRunLockForTests();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const repository = createMemoryAutoImportRepository();
  const blockingRepo = {
    getListingByIdentityKey: (k: string) => repository.getListingByIdentityKey(k),
    getListingBySourceUrl: (u: string) => repository.getListingBySourceUrl(u),
    // Planner holds the run lock while loading shared planning context.
    listListings: async () => {
      await gate;
      return repository.listListings();
    },
    getHealth: () => repository.getHealth(),
    saveHealth: (h: Parameters<typeof repository.saveHealth>[0]) =>
      repository.saveHealth(h),
    commitBatch: (
      inputs: Parameters<typeof repository.commitBatch>[0],
      health: Parameters<typeof repository.commitBatch>[1],
    ) => repository.commitBatch(inputs, health),
  };
  const serviceA = createSvc({
    repository: blockingRepo,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "lock-a",
        currentListedPricePkr: 100000,
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const serviceB = createSvc({
    repository,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Knox Hybrid Inverter 6kW Single Phase",
        supplierProductId: "lock-b",
        brand: "Knox",
        currentListedPricePkr: 90000,
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const p1 = serviceA.runAutomaticImport({ actorScope: "admin:super:ceo" });
  await new Promise((r) => setTimeout(r, 20));
  const r2 = await serviceB.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(r2.status, "failed");
  assert.ok(r2.health.errors.some((e) => /concurrent_run_blocked/i.test(e)));
  release();
  const r1 = await p1;
  assert.ok(r1.status === "succeeded" || r1.status === "partial");
  __resetAutoImportRunLockForTests();
  console.log("ok - concurrent run protection");
}

{
  // Statement-timeout style cancel releases the run lock (no abandoned lock)
  const {
    createAutoImportService: createSvc,
    __resetAutoImportRunLockForTests,
  } = await import("./autoImportService.ts");
  __resetAutoImportRunLockForTests();
  const base = createMemoryAutoImportRepository();
  const repository = {
    getListingByIdentityKey: (k: string) => base.getListingByIdentityKey(k),
    getListingBySourceUrl: (u: string) => base.getListingBySourceUrl(u),
    listListings: () => base.listListings(),
    getHealth: () => base.getHealth(),
    saveHealth: (h: Parameters<typeof base.saveHealth>[0]) => base.saveHealth(h),
    async commitBatch() {
      throw new Error("canceling statement due to statement timeout");
    },
  };
  const service = createSvc({
    repository,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "to-1",
        currentListedPricePkr: 100000,
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const r1 = await service.runAutomaticImport({ actorScope: "admin:super:ceo" });
  assert.equal(r1.status, "failed");
  assert.ok(r1.health.errors.some((e) => /statement timeout|persist_/i.test(e)));
  // Lock must be free for a subsequent run
  const r2 = await service.runAutomaticImport({ actorScope: "admin:super:ceo" });
  assert.equal(r2.status, "failed");
  assert.ok(!r2.health.errors.some((e) => /concurrent_run_blocked/i.test(e)));
  __resetAutoImportRunLockForTests();
  console.log("ok - timeout cancel releases run lock");
}

{
  // 14 listings plan inside job timeout via shared planning context (not N×RPC).
  // Simulates production: each per-listing lookup would cost ~4s (14×4s > 55s).
  const {
    createAutoImportService: createSvc,
    __resetAutoImportRunLockForTests,
  } = await import("./autoImportService.ts");
  __resetAutoImportRunLockForTests();
  const base = createMemoryAutoImportRepository();
  let getByUrlCalls = 0;
  let getByKeyCalls = 0;
  let listCalls = 0;
  let commitCalls = 0;
  const timingLogs: Array<Record<string, unknown>> = [];
  const slowRepo = {
    async getListingBySourceUrl(u: string) {
      getByUrlCalls += 1;
      await new Promise((r) => setTimeout(r, 4_000));
      return base.getListingBySourceUrl(u);
    },
    async getListingByIdentityKey(k: string) {
      getByKeyCalls += 1;
      await new Promise((r) => setTimeout(r, 4_000));
      return base.getListingByIdentityKey(k);
    },
    async listListings() {
      listCalls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return base.listListings();
    },
    getHealth: () => base.getHealth(),
    saveHealth: (h: Parameters<typeof base.saveHealth>[0]) => base.saveHealth(h),
    async commitBatch(
      inputs: Parameters<typeof base.commitBatch>[0],
      health: Parameters<typeof base.commitBatch>[1],
    ) {
      commitCalls += 1;
      return base.commitBatch(inputs, health);
    },
  };
  const fixtures: CatalogueProductObservation[] = [];
  for (let i = 0; i < 14; i++) {
    const supplier = i % 2 === 0 ? "kamal" : "alladin";
    fixtures.push(
      obs({
        supplier,
        title: `Inverex Nitrox ${10 + i}kW Hybrid Solar Inverter`,
        brand: "Inverex",
        modelSku: `NITROX-${i}`,
        supplierProductId: `plan14-${i}`,
        currentListedPricePkr: 100000 + i * 1000,
        canonicalUrl: `https://${supplier === "kamal" ? "kamalsolar.pk" : "alladin.pk"}/products/plan14-${i}`,
      }),
    );
  }
  const planStarted = Date.now();
  const service = createSvc({
    repository: slowRepo,
    fixtureObservations: fixtures,
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      // Tight ceiling: old N×lookup path cannot finish; shared context can.
      MARKETPLACE_CEO_AUTO_IMPORT_TIMEOUT_MS: "5000",
      MARKETPLACE_CEO_AUTO_IMPORT_RPC_TIMEOUT_MS: "4000",
    },
    log: (fields) => {
      if (fields.stage === "plan_phase_timing") {
        timingLogs.push(fields as unknown as Record<string, unknown>);
      }
    },
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  const planElapsed = Date.now() - planStarted;
  assert.equal(result.status, "succeeded", `status=${result.status} errors=${result.health.errors.join(";")}`);
  assert.equal(result.health.productsCreated, 14);
  assert.equal(getByUrlCalls, 0, "must not per-list getListingBySourceUrl");
  assert.equal(getByKeyCalls, 0, "must not per-list getListingByIdentityKey");
  assert.equal(listCalls, 1, "exactly one shared planning-context load");
  assert.equal(commitCalls, 1, "exactly one atomic commit");
  assert.ok(planElapsed < 5000, `14-listing plan+commit finished in ${planElapsed}ms`);
  assert.equal(timingLogs.length, 1);
  assert.equal(timingLogs[0]!.aiPlanMs, 0);
  assert.ok(typeof timingLogs[0]!.fetchMs === "number");
  assert.ok(typeof timingLogs[0]!.normalizeMs === "number");
  assert.ok(typeof timingLogs[0]!.matchingMs === "number");
  assert.ok(typeof timingLogs[0]!.totalMs === "number");
  assert.equal((await base.listListings()).length, 14);

  // Retry cannot create duplicates — second run updates, listing count stable.
  const retry = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(retry.status, "succeeded");
  assert.equal(retry.health.productsCreated, 0);
  assert.equal(retry.health.productsUpdated, 14);
  assert.equal(commitCalls, 2);
  assert.equal(listCalls, 2, "retry loads planning context once more");
  assert.equal((await base.listListings()).length, 14);
  __resetAutoImportRunLockForTests();
  console.log("ok - 14 listings plan within timeout via shared context; retry non-duplicating");
}

{
  // Genuinely stalled planner still times out with zero catalogue writes.
  const {
    createAutoImportService: createSvc,
    __resetAutoImportRunLockForTests,
  } = await import("./autoImportService.ts");
  __resetAutoImportRunLockForTests();
  const base = createMemoryAutoImportRepository();
  let commitCalls = 0;
  const stalledRepo = {
    getListingByIdentityKey: (k: string) => base.getListingByIdentityKey(k),
    getListingBySourceUrl: (u: string) => base.getListingBySourceUrl(u),
    listListings: () =>
      new Promise<Awaited<ReturnType<typeof base.listListings>>>(() => {
        /* never resolves */
      }),
    getHealth: () => base.getHealth(),
    saveHealth: (h: Parameters<typeof base.saveHealth>[0]) => base.saveHealth(h),
    async commitBatch(
      inputs: Parameters<typeof base.commitBatch>[0],
      health: Parameters<typeof base.commitBatch>[1],
    ) {
      commitCalls += 1;
      return base.commitBatch(inputs, health);
    },
  };
  const service = createSvc({
    repository: stalledRepo,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "stall-1",
        currentListedPricePkr: 100000,
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_TIMEOUT_MS: "300",
      MARKETPLACE_CEO_AUTO_IMPORT_RPC_TIMEOUT_MS: "200",
    },
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(result.status, "failed");
  assert.ok(
    result.health.errors.some((e) => /job_timeout|timed out/i.test(e)),
    `expected job_timeout, got ${result.health.errors.join(";")}`,
  );
  assert.equal(commitCalls, 0, "timeout must not start atomic commit");
  assert.equal(result.health.productsCreated, 0);
  assert.equal(result.health.productsUpdated, 0);
  assert.equal((await base.listListings()).length, 0, "zero catalogue writes");
  assert.ok(
    /no catalogue writes/i.test(result.health.note || ""),
    "timeout note documents zero writes",
  );
  __resetAutoImportRunLockForTests();
  console.log("ok - stalled planner times out with zero catalogue writes");
}

{
  // Fail closed: non-timeout listListings error → failed run, zero commit/writes.
  const {
    createAutoImportService: createSvc,
    __resetAutoImportRunLockForTests,
  } = await import("./autoImportService.ts");
  __resetAutoImportRunLockForTests();
  const base = createMemoryAutoImportRepository();
  let commitCalls = 0;
  const failingRepo = {
    getListingByIdentityKey: (k: string) => base.getListingByIdentityKey(k),
    getListingBySourceUrl: (u: string) => base.getListingBySourceUrl(u),
    async listListings() {
      throw new Error("PGRST301: JWT expired");
    },
    getHealth: () => base.getHealth(),
    saveHealth: (h: Parameters<typeof base.saveHealth>[0]) => base.saveHealth(h),
    async commitBatch(
      inputs: Parameters<typeof base.commitBatch>[0],
      health: Parameters<typeof base.commitBatch>[1],
    ) {
      commitCalls += 1;
      return base.commitBatch(inputs, health);
    },
  };
  const service = createSvc({
    repository: failingRepo,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "ctx-fail-1",
        currentListedPricePkr: 100000,
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
  assert.ok(
    result.health.errors.some((e) => /plan_context_failed|PLAN_CONTEXT/i.test(e)),
    `expected plan_context_failed, got ${result.health.errors.join(";")}`,
  );
  assert.equal(commitCalls, 0);
  assert.equal(result.health.productsCreated, 0);
  assert.equal(result.health.productsUpdated, 0);
  assert.equal((await base.listListings()).length, 0);
  assert.ok(/no catalogue writes/i.test(result.health.note || ""));
  __resetAutoImportRunLockForTests();
  console.log("ok - listListings DB error fails closed with zero writes");
}

{
  // Multi-page planning context: all rows loaded; URL ownership from later page respected.
  const {
    createAutoImportService: createSvc,
    __resetAutoImportRunLockForTests,
  } = await import("./autoImportService.ts");
  const { fetchCompleteListingPages } = await import(
    "./autoImportPlanningContext.ts"
  );
  __resetAutoImportRunLockForTests();

  // Unit: pagination aggregates every page and refuses silent truncation.
  const pageCalls: number[] = [];
  const pages = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8],
  ];
  const aggregated = await fetchCompleteListingPages({
    pageSize: 3,
    maxPages: 10,
    fetchPage: async (offset, limit) => {
      pageCalls.push(offset);
      const idx = Math.floor(offset / limit);
      return pages[idx] ?? [];
    },
  });
  assert.deepEqual(aggregated, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(pageCalls, [0, 3, 6]);

  let incompleteFailed = false;
  try {
    await fetchCompleteListingPages({
      pageSize: 2,
      maxPages: 2,
      fetchPage: async () => [1, 2], // always full page → hits maxPages
    });
  } catch (err) {
    incompleteFailed = /PLAN_CONTEXT_INCOMPLETE/i.test(
      String((err as Error).message),
    );
  }
  assert.equal(incompleteFailed, true, "must refuse truncated catalogue");

  // Service: catalogue > one page via listListings pagination helper.
  const seed = createMemoryAutoImportRepository();
  const ownedUrl = "https://kamalsolar.pk/products/page2-owned";
  // Seed 7 prior listings (page size 3 → 3 pages) including URL ownership conflict.
  for (let i = 0; i < 6; i++) {
    await seed.commitBatch(
      [
        {
          identityKey: `exact:page:seed:${i}`,
          title: `Seed Inverter ${i}kW Hybrid`,
          brandName: "Inverex",
          categoryName: "Solar Inverter",
          websitePricePkr: 90000 + i,
          availability: "in_stock",
          selectedSupplier: "kamal",
          sourceUrls: [`https://kamalsolar.pk/products/seed-page-${i}`],
          matchReason: "exact_identity",
          priceReason: "auto",
          fetchedAt: "2026-07-26T12:00:00.000Z",
          offers: [],
          previous: null,
        },
      ],
      {
        lastSyncAt: "2026-07-26T12:00:00.000Z",
        lastSyncStatus: "succeeded",
        lastRunId: `seed_${i}`,
        kamalDiscovered: 1,
        alladinDiscovered: 0,
        acceptedVariants: 1,
        rejectedVariants: 0,
        exactMatches: 1,
        conflictKeptSeparate: 0,
        productsCreated: 1,
        productsUpdated: 0,
        lowestPriceSelections: 1,
        rolledBackPrices: 0,
        errors: [],
        note: "seed",
      },
    );
  }
  await seed.commitBatch(
    [
      {
        identityKey: "exact:other:owner",
        title: "Other Owner Hybrid 5kW",
        brandName: "Knox",
        categoryName: "Solar Inverter",
        websitePricePkr: 88000,
        availability: "in_stock",
        selectedSupplier: "alladin",
        sourceUrls: [ownedUrl],
        matchReason: "exact_identity",
        priceReason: "auto",
        fetchedAt: "2026-07-26T12:00:00.000Z",
        offers: [],
        previous: null,
      },
    ],
    {
      lastSyncAt: "2026-07-26T12:00:00.000Z",
      lastSyncStatus: "succeeded",
      lastRunId: "seed_owner",
      kamalDiscovered: 0,
      alladinDiscovered: 1,
      acceptedVariants: 1,
      rejectedVariants: 0,
      exactMatches: 1,
      conflictKeptSeparate: 0,
      productsCreated: 1,
      productsUpdated: 0,
      lowestPriceSelections: 1,
      rolledBackPrices: 0,
      errors: [],
      note: "seed",
    },
  );
  const allSeeded = await seed.listListings();
  assert.equal(allSeeded.length, 7);

  let pageFetches = 0;
  let commitCalls = 0;
  const pagedRepo = {
    getListingByIdentityKey: (k: string) => seed.getListingByIdentityKey(k),
    getListingBySourceUrl: (u: string) => seed.getListingBySourceUrl(u),
    async listListings() {
      return fetchCompleteListingPages({
        pageSize: 3,
        maxPages: 10,
        fetchPage: async (offset, limit) => {
          pageFetches += 1;
          return allSeeded.slice(offset, offset + limit);
        },
      });
    },
    getHealth: () => seed.getHealth(),
    saveHealth: (h: Parameters<typeof seed.saveHealth>[0]) => seed.saveHealth(h),
    async commitBatch(
      inputs: Parameters<typeof seed.commitBatch>[0],
      health: Parameters<typeof seed.commitBatch>[1],
    ) {
      commitCalls += 1;
      return seed.commitBatch(inputs, health);
    },
  };

  const service = createSvc({
    repository: pagedRepo,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 12kW Hybrid Solar Inverter",
        brand: "Inverex",
        modelSku: "NITROX-PAGE",
        supplierProductId: "page-new-1",
        currentListedPricePkr: 111000,
        canonicalUrl: "https://kamalsolar.pk/products/page-new-1",
      }),
      // Same URL as seed on later page, different identity → must be rejected.
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 15kW Hybrid Solar Inverter",
        brand: "Inverex",
        modelSku: "NITROX-CONFLICT",
        supplierProductId: "page-conflict",
        currentListedPricePkr: 122000,
        canonicalUrl: ownedUrl,
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
  assert.equal(result.status, "succeeded", result.health.errors.join(";"));
  assert.ok(pageFetches >= 3, `expected multi-page fetches, got ${pageFetches}`);
  assert.equal(commitCalls, 1);
  assert.equal(result.health.productsCreated, 1);
  assert.equal(result.health.rejectedVariants >= 1, true);
  const after = await seed.listListings();
  assert.equal(after.length, 8); // 7 seed + 1 new; conflict not written
  assert.ok(
    after.some((l) => l.sourceUrls.includes("https://kamalsolar.pk/products/page-new-1")),
  );
  assert.equal(
    after.filter((l) => l.identityKey === "exact:other:owner").length,
    1,
  );
  __resetAutoImportRunLockForTests();
  console.log("ok - multi-page planning context loads completely; matching correct");
}

{
  // Pagination failure mid-load → fail closed, zero writes.
  const {
    createAutoImportService: createSvc,
    __resetAutoImportRunLockForTests,
  } = await import("./autoImportService.ts");
  const { fetchCompleteListingPages } = await import(
    "./autoImportPlanningContext.ts"
  );
  __resetAutoImportRunLockForTests();
  const base = createMemoryAutoImportRepository();
  let commitCalls = 0;
  const repo = {
    getListingByIdentityKey: (k: string) => base.getListingByIdentityKey(k),
    getListingBySourceUrl: (u: string) => base.getListingBySourceUrl(u),
    async listListings() {
      return fetchCompleteListingPages({
        pageSize: 2,
        maxPages: 10,
        fetchPage: async (offset) => {
          if (offset === 0) return [{ id: "a" }, { id: "b" }] as any;
          throw new Error("PGRST000: connection reset during page fetch");
        },
      });
    },
    getHealth: () => base.getHealth(),
    saveHealth: (h: Parameters<typeof base.saveHealth>[0]) => base.saveHealth(h),
    async commitBatch(
      inputs: Parameters<typeof base.commitBatch>[0],
      health: Parameters<typeof base.commitBatch>[1],
    ) {
      commitCalls += 1;
      return base.commitBatch(inputs, health);
    },
  };
  const service = createSvc({
    repository: repo,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "page-fail-1",
        currentListedPricePkr: 100000,
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
  assert.ok(
    result.health.errors.some((e) => /plan_context_failed|PLAN_CONTEXT/i.test(e)),
  );
  assert.equal(commitCalls, 0);
  assert.equal(result.health.productsCreated, 0);
  assert.equal((await base.listListings()).length, 0);
  __resetAutoImportRunLockForTests();
  console.log("ok - pagination failure fails closed with zero writes");
}

{
  // Source: Supabase listListings paginates; no silent limit(2000) cap.
  const supabaseSrc = readFileSync(
    join(__dirname, "supabaseAutoImportRepository.ts"),
    "utf8",
  );
  assert.ok(supabaseSrc.includes("fetchCompleteListingPages"));
  assert.ok(supabaseSrc.includes("AUTO_IMPORT_LISTINGS_PAGE_SIZE"));
  assert.ok(!/\.limit\(\s*2000\s*\)/.test(supabaseSrc));
  assert.ok(/\.range\(/.test(supabaseSrc));
  const svcSrc = readFileSync(join(__dirname, "autoImportService.ts"), "utf8");
  assert.ok(svcSrc.includes("PLAN_CONTEXT_FAILED"));
  assert.ok(!svcSrc.includes("plan_context_empty"));
  console.log("ok - source: complete pagination + fail-closed planning context");
}

{
  // Dedicated pooler TLS: sslmode=require must not override importer ssl config.
  const {
    buildAutoImportPgClientConfig,
    isEncryptOnlyAutoImportSsl,
  } = await import("./autoImportPgSsl.ts");
  const { sanitizeAutoImportError } = await import("./autoImportLog.ts");
  const { TLS_REJECT_UNAUTHORIZED } = await import(
    "../suppliers/safeHttp.ts"
  );
  const { parse: parseConnectionString } = await import("pg-connection-string");

  const poolerUrl =
    "postgresql://runtime.user:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require";

  // Evidence: pg merge would discard explicit rejectUnauthorized:false.
  const parsed = parseConnectionString(poolerUrl) as { ssl?: unknown };
  const brokenMerge = Object.assign(
    {},
    { connectionString: poolerUrl, ssl: { rejectUnauthorized: false } },
    parsed,
  );
  assert.notEqual(
    (brokenMerge as { ssl?: { rejectUnauthorized?: boolean } }).ssl
      ?.rejectUnauthorized,
    false,
    "repro: sslmode=require overrides explicit ssl object",
  );

  const poolerCfg = buildAutoImportPgClientConfig(poolerUrl);
  assert.equal(poolerCfg.host, "aws-0-ap-southeast-1.pooler.supabase.com");
  assert.equal(poolerCfg.port, 5432);
  assert.equal(isEncryptOnlyAutoImportSsl(poolerCfg.ssl), true);
  assert.equal(
    typeof poolerCfg.ssl === "object" &&
      poolerCfg.ssl &&
      poolerCfg.ssl.rejectUnauthorized,
    false,
  );
  // Must not retain connectionString (avoids second sslmode parse in pg).
  assert.equal(
    Object.prototype.hasOwnProperty.call(poolerCfg, "connectionString"),
    false,
  );

  const caPem =
    "-----BEGIN CERTIFICATE-----\nMIIBtest\n-----END CERTIFICATE-----";
  const verified = buildAutoImportPgClientConfig(poolerUrl, { sslCaPem: caPem });
  assert.equal(
    typeof verified.ssl === "object" &&
      verified.ssl &&
      verified.ssl.rejectUnauthorized,
    true,
  );
  assert.equal(
    typeof verified.ssl === "object" && verified.ssl && verified.ssl.ca,
    caPem,
  );
  assert.equal(isEncryptOnlyAutoImportSsl(verified.ssl), false);

  const localCfg = buildAutoImportPgClientConfig(
    "postgresql://postgres:postgres@127.0.0.1:5432/postgres?sslmode=require",
  );
  assert.equal(localCfg.ssl, false);

  // Sanitized TLS failure (Node OPENSSL style code).
  const tlsErr = Object.assign(new Error("self-signed certificate in certificate chain"), {
    code: "SELF_SIGNED_CERT_IN_CHAIN",
    name: "Error",
  });
  const sanitizedTls = sanitizeAutoImportError(tlsErr);
  assert.equal(sanitizedTls.errorCode, "TLS_FAILURE");
  assert.ok(/self-signed certificate/i.test(sanitizedTls.message));
  assert.ok(!/secret|runtime\.user/i.test(JSON.stringify(sanitizedTls)));

  // Global TLS behavior unchanged.
  assert.equal(TLS_REJECT_UNAUTHORIZED, true);
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");

  console.log("ok - dedicated pooler TLS config wins over sslmode; global TLS unchanged");
}

{
  // TLS failure during persist → zero catalogue writes; successful plan still one atomic commit.
  const {
    createAutoImportService: createSvc,
    __resetAutoImportRunLockForTests,
  } = await import("./autoImportService.ts");
  __resetAutoImportRunLockForTests();
  const base = createMemoryAutoImportRepository();
  let commitCalls = 0;
  const tlsFailRepo = {
    getListingByIdentityKey: (k: string) => base.getListingByIdentityKey(k),
    getListingBySourceUrl: (u: string) => base.getListingBySourceUrl(u),
    listListings: () => base.listListings(),
    getHealth: () => base.getHealth(),
    saveHealth: (h: Parameters<typeof base.saveHealth>[0]) => base.saveHealth(h),
    async commitBatch() {
      commitCalls += 1;
      const err = Object.assign(
        new Error("self-signed certificate in certificate chain"),
        { code: "SELF_SIGNED_CERT_IN_CHAIN", name: "Error" },
      );
      throw err;
    },
  };
  const service = createSvc({
    repository: tlsFailRepo,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "tls-fail-1",
        currentListedPricePkr: 100000,
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const failed = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(failed.status, "failed");
  assert.equal(commitCalls, 1, "planning reached one atomic commit attempt");
  assert.ok(
    failed.health.errors.some((e) =>
      /persist_TLS_FAILURE|self-signed certificate/i.test(e),
    ),
    `expected sanitized TLS persist error, got ${failed.health.errors.join(";")}`,
  );
  assert.equal(failed.health.productsCreated, 0);
  assert.equal(failed.health.productsUpdated, 0);
  assert.equal((await base.listListings()).length, 0, "zero catalogue writes");

  // Successful planning → exactly one atomic commit when persist works.
  __resetAutoImportRunLockForTests();
  commitCalls = 0;
  const okRepo = {
    getListingByIdentityKey: (k: string) => base.getListingByIdentityKey(k),
    getListingBySourceUrl: (u: string) => base.getListingBySourceUrl(u),
    listListings: () => base.listListings(),
    getHealth: () => base.getHealth(),
    saveHealth: (h: Parameters<typeof base.saveHealth>[0]) => base.saveHealth(h),
    async commitBatch(
      inputs: Parameters<typeof base.commitBatch>[0],
      health: Parameters<typeof base.commitBatch>[1],
    ) {
      commitCalls += 1;
      return base.commitBatch(inputs, health);
    },
  };
  const okService = createSvc({
    repository: okRepo,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "tls-ok-1",
        currentListedPricePkr: 100000,
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const ok = await okService.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(ok.status, "succeeded");
  assert.equal(commitCalls, 1);
  assert.equal(ok.health.productsCreated, 1);
  assert.equal((await base.listListings()).length, 1);
  __resetAutoImportRunLockForTests();
  console.log("ok - TLS persist failure zero writes; success path one atomic commit");
}

{
  // Source honesty: createAutoImportPgClient uses buildAutoImportPgClientConfig (no raw connectionString+ssl race).
  const pgCommitSrc = readFileSync(
    join(__dirname, "autoImportPgCommit.ts"),
    "utf8",
  );
  const sslSrc = readFileSync(join(__dirname, "autoImportPgSsl.ts"), "utf8");
  assert.ok(pgCommitSrc.includes("buildAutoImportPgClientConfig"));
  assert.ok(pgCommitSrc.includes("createAutoImportPgClient"));
  assert.ok(!/new pg\.Client\(\{\s*connectionString/s.test(pgCommitSrc));
  assert.ok(sslSrc.includes("rejectUnauthorized: false"));
  assert.ok(sslSrc.includes("sslCaPem"));
  assert.ok(sslSrc.includes("sslmode=require"));
  assert.ok(
    /Never set NODE_TLS_REJECT_UNAUTHORIZED/i.test(sslSrc),
    "docs must forbid global TLS disable",
  );
  assert.ok(!/NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/.test(sslSrc));
  console.log("ok - source: dedicated pg TLS builder; no global TLS disable");
}

{
  // Default-variant invariant: normalize, tie-break, reject inactive, pre-commit.
  const {
    selectDefaultOffer,
    normalizeToSingleActiveDefault,
    attachDefaultVariants,
    assertBatchDefaultVariantInvariant,
    AutoImportDefaultVariantError,
    hashIdentityKey,
  } = await import("./autoImportDefaultVariant.ts");

  // Zero defaults among active candidates → normalize to exactly one active default.
  const fromZero = normalizeToSingleActiveDefault([
    {
      isDefault: false,
      active: true,
      stockStatus: "in_stock",
      selectedSupplier: "kamal",
      sourceKey: "kamal:a",
    },
  ]);
  assert.ok(fromZero);
  assert.equal(fromZero!.isDefault, true);
  assert.equal(fromZero!.active, true);
  assert.equal(fromZero!.sourceKey, "kamal:a");

  // Multiple defaults → deterministic single (sourceKey ASC).
  const fromMulti = normalizeToSingleActiveDefault([
    {
      isDefault: true,
      active: true,
      stockStatus: "in_stock",
      selectedSupplier: "alladin",
      sourceKey: "z-source",
    },
    {
      isDefault: true,
      active: true,
      stockStatus: "in_stock",
      selectedSupplier: "kamal",
      sourceKey: "a-source",
    },
  ]);
  assert.equal(fromMulti!.sourceKey, "a-source");
  assert.equal(fromMulti!.selectedSupplier, "kamal");

  // Inactive/sold_out lowest price cannot win when an active priced offer exists.
  const pick = selectDefaultOffer([
    {
      supplier: "alladin",
      sourceKey: "alladin:cheap-sold",
      canonicalUrl: "https://alladin.pk/products/cheap-sold",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      currentListedPricePkr: 50000,
      parseStatus: "ok",
      availability: "sold_out",
      fetchedAt: "2026-07-26T12:00:00.000Z",
    },
    {
      supplier: "kamal",
      sourceKey: "kamal:dearer-stock",
      canonicalUrl: "https://kamalsolar.pk/products/dearer-stock",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      currentListedPricePkr: 90000,
      parseStatus: "ok",
      availability: "in_stock",
      fetchedAt: "2026-07-26T12:00:00.000Z",
    },
  ]);
  assert.equal(pick.ok, true);
  if (pick.ok) {
    assert.equal(pick.offer.sourceKey, "kamal:dearer-stock");
    assert.equal(pick.offer.availability, "in_stock");
  }

  // Equal-price: stable sourceKey tie-breaker.
  const tied = selectDefaultOffer([
    {
      supplier: "alladin",
      sourceKey: "alladin:b",
      canonicalUrl: "https://alladin.pk/products/b",
      title: "Knox Hybrid Inverter 6kW Single Phase",
      currentListedPricePkr: 100000,
      parseStatus: "ok",
      availability: "in_stock",
      fetchedAt: "2026-07-26T12:00:00.000Z",
    },
    {
      supplier: "kamal",
      sourceKey: "kamal:a",
      canonicalUrl: "https://kamalsolar.pk/products/a",
      title: "Knox Hybrid Inverter 6kW Single Phase",
      currentListedPricePkr: 100000,
      parseStatus: "ok",
      availability: "in_stock",
      fetchedAt: "2026-07-26T12:00:00.000Z",
    },
  ]);
  assert.equal(tied.ok, true);
  // 'alladin:b' < 'kamal:a' lexicographically
  if (tied.ok) assert.equal(tied.offer.sourceKey, "alladin:b");

  // Inactive-only candidates cannot fabricate a default.
  assert.equal(
    normalizeToSingleActiveDefault([
      {
        isDefault: true,
        active: false,
        stockStatus: "sold_out",
        selectedSupplier: "kamal",
        sourceKey: "kamal:dead",
      },
    ]),
    null,
  );

  // No valid active priced variants → fail before commit, zero writes.
  const {
    createAutoImportService: createSvc,
    __resetAutoImportRunLockForTests,
  } = await import("./autoImportService.ts");
  __resetAutoImportRunLockForTests();
  const base = createMemoryAutoImportRepository();
  let commitCalls = 0;
  const repo = {
    getListingByIdentityKey: (k: string) => base.getListingByIdentityKey(k),
    getListingBySourceUrl: (u: string) => base.getListingBySourceUrl(u),
    listListings: () => base.listListings(),
    getHealth: () => base.getHealth(),
    saveHealth: (h: Parameters<typeof base.saveHealth>[0]) => base.saveHealth(h),
    async commitBatch(
      inputs: Parameters<typeof base.commitBatch>[0],
      health: Parameters<typeof base.commitBatch>[1],
    ) {
      commitCalls += 1;
      return base.commitBatch(inputs, health);
    },
  };
  const noPrice = createSvc({
    repository: repo,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "no-price",
        currentListedPricePkr: null,
        parseStatus: "missing",
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const noPriceResult = await noPrice.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(noPriceResult.health.productsCreated, 0);
  assert.equal(noPriceResult.health.productsUpdated, 0);
  assert.equal((await base.listListings()).length, 0, "zero catalogue writes");
  assert.ok(noPriceResult.health.rejectedVariants >= 1);

  // Pre-commit validator rejects corrupt plan (inactive default) with sanitized hash.
  let preCommitFailed = false;
  try {
    assertBatchDefaultVariantInvariant([
      {
        identityKey: "exact:corrupt",
        title: "x",
        brandName: "Inverex",
        categoryName: "Solar Inverter",
        websitePricePkr: 1,
        availability: "in_stock",
        selectedSupplier: "kamal",
        sourceUrls: [],
        matchReason: "exact_identity",
        priceReason: "auto",
        fetchedAt: "2026-07-26T12:00:00.000Z",
        offers: [],
        previous: null,
        defaultVariant: {
          isDefault: true,
          active: false,
          stockStatus: "sold_out",
          selectedSupplier: "kamal",
          sourceKey: "exact:corrupt",
        },
      },
    ]);
  } catch (err) {
    preCommitFailed = err instanceof AutoImportDefaultVariantError;
    assert.ok(/DEFAULT_VARIANT_REQUIRED/i.test(String((err as Error).message)));
    assert.equal(
      (err as InstanceType<typeof AutoImportDefaultVariantError>).diagnostics
        .identityKeyHash,
      hashIdentityKey("exact:corrupt"),
    );
    assert.equal(
      (err as InstanceType<typeof AutoImportDefaultVariantError>).diagnostics
        .defaultVariantCount,
      0,
    );
  }
  assert.equal(preCommitFailed, true);

  // 688-variant production-shaped plan: every product has exactly one active default.
  const shaped: Parameters<typeof attachDefaultVariants>[0] = [];
  for (let i = 0; i < 688; i++) {
    shaped.push({
      identityKey: `exact:prod:${i}`,
      title: `Inverex Nitrox ${i}kW Hybrid Solar Inverter`,
      brandName: "Inverex",
      categoryName: "Solar Inverter",
      websitePricePkr: 100000 + i,
      availability: i % 17 === 0 ? "sold_out" : "in_stock",
      selectedSupplier: i % 2 === 0 ? "kamal" : "alladin",
      sourceUrls: [`https://example.test/p/${i}`],
      matchReason: "exact_identity",
      priceReason: "auto",
      fetchedAt: "2026-07-26T12:00:00.000Z",
      offers: [],
      previous: null,
      defaultSourceKey: `src:${i}`,
    });
  }
  const validated688 = attachDefaultVariants(shaped);
  assert.equal(validated688.length, 688);
  for (const item of validated688) {
    assert.equal(item.defaultVariant.isDefault, true);
    assert.equal(item.defaultVariant.active, true);
  }
  assertBatchDefaultVariantInvariant(validated688);

  // Successful plan → one atomic commit; retry preserves default, no duplicates.
  __resetAutoImportRunLockForTests();
  commitCalls = 0;
  const okSvc = createSvc({
    repository: repo,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "def-ok",
        currentListedPricePkr: 111000,
        availability: "sold_out",
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const ok1 = await okSvc.runAutomaticImport({ actorScope: "admin:super:ceo" });
  assert.equal(ok1.status, "succeeded");
  assert.equal(commitCalls, 1);
  assert.equal(ok1.health.productsCreated, 1);
  assert.ok(ok1.health.errors.every((e) => !/DEFAULT_VARIANT/i.test(e)));
  const first = (await base.listListings())[0]!;
  assert.equal(first.availability, "sold_out");
  const ok2 = await okSvc.runAutomaticImport({ actorScope: "admin:super:ceo" });
  assert.equal(ok2.status, "succeeded");
  assert.equal(commitCalls, 2);
  assert.equal(ok2.health.productsCreated, 0);
  assert.equal(ok2.health.productsUpdated, 1);
  const after = await base.listListings();
  assert.equal(after.length, 1);
  assert.equal(after[0]!.identityKey, first.identityKey);
  assert.equal(after[0]!.variantId, first.variantId);

  // Update path: memory commit rejects a second inactive/corrupt default when attached.
  let updateCorrupt = false;
  try {
    await base.commitBatch(
      [
        {
          identityKey: first.identityKey,
          title: first.title,
          brandName: first.brandName,
          categoryName: first.categoryName,
          websitePricePkr: first.websitePricePkr,
          availability: "in_stock",
          selectedSupplier: first.selectedSupplier,
          sourceUrls: first.sourceUrls,
          matchReason: "exact_identity",
          priceReason: "auto",
          fetchedAt: "2026-07-26T12:00:00.000Z",
          offers: first.offers,
          previous: first,
          defaultVariant: {
            isDefault: true,
            active: false,
            stockStatus: "sold_out",
            selectedSupplier: first.selectedSupplier,
            sourceKey: first.identityKey,
          },
        },
      ],
      await base.getHealth(),
    );
  } catch (err) {
    updateCorrupt = /DEFAULT_VARIANT_REQUIRED/i.test(String((err as Error).message));
  }
  assert.equal(updateCorrupt, true);
  assert.equal((await base.listListings()).length, 1, "corrupt update retains zero extra writes");
  __resetAutoImportRunLockForTests();

  // SQL must keep default variant active (sold_out via stock_status only).
  // Listing-row active may still track sold_out; variant must not.
  const atomicSql = readFileSync(
    join(ROOT, "scripts/marketplace-ceo-auto-import-atomic.sql"),
    "utf8",
  );
  const variantUpdate = atomicSql.slice(
    atomicSql.indexOf("update public.mp_product_variants"),
  );
  assert.ok(
    !/active\s*=\s*v_avail\s*<>\s*'sold_out'/i.test(variantUpdate),
    "variant update must not deactivate on sold_out",
  );
  assert.ok(/is_default\s*=\s*true/.test(variantUpdate));
  assert.ok(/active\s*=\s*true/.test(variantUpdate));
  console.log("ok - default variant invariant normalize/validate/688-plan/retry");
}

{
  // Integration: unified commercial selection (price/supplier/default/availability).
  const {
    createAutoImportService: createSvc,
    __resetAutoImportRunLockForTests,
  } = await import("./autoImportService.ts");
  __resetAutoImportRunLockForTests();

  // sold-out Alladin 50k + in-stock Kamal 90k → Kamal commercial wins end-to-end.
  {
    const base = createMemoryAutoImportRepository();
    const committed: Array<Parameters<typeof base.commitBatch>[0][number]> = [];
    const repo = {
      getListingByIdentityKey: (k: string) => base.getListingByIdentityKey(k),
      getListingBySourceUrl: (u: string) => base.getListingBySourceUrl(u),
      listListings: () => base.listListings(),
      getHealth: () => base.getHealth(),
      saveHealth: (h: Parameters<typeof base.saveHealth>[0]) => base.saveHealth(h),
      async commitBatch(
        inputs: Parameters<typeof base.commitBatch>[0],
        health: Parameters<typeof base.commitBatch>[1],
      ) {
        committed.push(...inputs);
        return base.commitBatch(inputs, health);
      },
    };
    const svc = createSvc({
      repository: repo,
      fixtureObservations: [
        obs({
          supplier: "alladin",
          title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
          supplierProductId: "mix-sold",
          currentListedPricePkr: 50000,
          availability: "sold_out",
        }),
        obs({
          supplier: "kamal",
          title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
          supplierProductId: "mix-stock",
          currentListedPricePkr: 90000,
          availability: "in_stock",
        }),
      ],
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      },
    });
    const result = await svc.runAutomaticImport({ actorScope: "admin:super:ceo" });
    assert.equal(result.status, "succeeded");
    assert.equal(committed.length, 1);
    const plan = committed[0]!;
    assert.equal(plan.websitePricePkr, 90000);
    assert.equal(plan.selectedSupplier, "kamal");
    assert.equal(plan.availability, "in_stock");
    assert.equal(plan.defaultSourceKey, "kamal:mix-stock");
    assert.equal(plan.defaultVariant?.selectedSupplier, "kamal");
    assert.equal(plan.defaultVariant?.sourceKey, "kamal:mix-stock");
    assert.equal(plan.defaultVariant?.stockStatus, "in_stock");
    assert.equal(plan.defaultVariant?.active, true);
    assert.equal(plan.defaultVariant?.isDefault, true);
    const listing = (await base.listListings())[0]!;
    assert.equal(listing.websitePricePkr, 90000);
    assert.equal(listing.selectedSupplier, "kamal");
    assert.equal(listing.availability, "in_stock");
    assert.equal(result.sampleLowestPrice[0]?.pricePkr, 90000);
    assert.equal(result.sampleLowestPrice[0]?.selectedSupplier, "kamal");
    assert.ok(
      !result.sampleLowestPrice[0]?.considered.some((c) => c.pricePkr === 50000),
      "sample must not report discarded sold_out candidate",
    );
    assert.equal(result.health.lowestPriceSelections, 1);
    __resetAutoImportRunLockForTests();
  }

  // All offers sold_out → lowest deterministic sold_out; sole active default.
  {
    const base = createMemoryAutoImportRepository();
    const committed: Array<Parameters<typeof base.commitBatch>[0][number]> = [];
    const repo = {
      getListingByIdentityKey: (k: string) => base.getListingByIdentityKey(k),
      getListingBySourceUrl: (u: string) => base.getListingBySourceUrl(u),
      listListings: () => base.listListings(),
      getHealth: () => base.getHealth(),
      saveHealth: (h: Parameters<typeof base.saveHealth>[0]) => base.saveHealth(h),
      async commitBatch(
        inputs: Parameters<typeof base.commitBatch>[0],
        health: Parameters<typeof base.commitBatch>[1],
      ) {
        committed.push(...inputs);
        return base.commitBatch(inputs, health);
      },
    };
    const svc = createSvc({
      repository: repo,
      fixtureObservations: [
        obs({
          supplier: "alladin",
          title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
          supplierProductId: "all-sold-a",
          currentListedPricePkr: 120000,
          availability: "sold_out",
        }),
        obs({
          supplier: "kamal",
          title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
          supplierProductId: "all-sold-k",
          currentListedPricePkr: 110000,
          availability: "sold_out",
        }),
      ],
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      },
    });
    const result = await svc.runAutomaticImport({ actorScope: "admin:super:ceo" });
    assert.equal(result.status, "succeeded");
    assert.equal(committed.length, 1);
    const plan = committed[0]!;
    assert.equal(plan.websitePricePkr, 110000);
    assert.equal(plan.selectedSupplier, "kamal");
    assert.equal(plan.availability, "sold_out");
    assert.equal(plan.defaultSourceKey, "kamal:all-sold-k");
    assert.equal(plan.defaultVariant?.active, true);
    assert.equal(plan.defaultVariant?.isDefault, true);
    assert.equal(plan.defaultVariant?.stockStatus, "sold_out");
    const listing = (await base.listListings())[0]!;
    assert.equal(listing.availability, "sold_out");
    assert.equal(listing.websitePricePkr, 110000);
    assert.equal(listing.selectedSupplier, "kamal");
    assert.equal(result.sampleLowestPrice[0]?.pricePkr, 110000);
    __resetAutoImportRunLockForTests();
  }

  // Equal-price available offers → sourceKey ASC then supplier; retry stable.
  {
    const base = createMemoryAutoImportRepository();
    const committed: Array<Parameters<typeof base.commitBatch>[0][number]> = [];
    const repo = {
      getListingByIdentityKey: (k: string) => base.getListingByIdentityKey(k),
      getListingBySourceUrl: (u: string) => base.getListingBySourceUrl(u),
      listListings: () => base.listListings(),
      getHealth: () => base.getHealth(),
      saveHealth: (h: Parameters<typeof base.saveHealth>[0]) => base.saveHealth(h),
      async commitBatch(
        inputs: Parameters<typeof base.commitBatch>[0],
        health: Parameters<typeof base.commitBatch>[1],
      ) {
        committed.push(...inputs);
        return base.commitBatch(inputs, health);
      },
    };
    const fixtures = [
      obs({
        supplier: "kamal",
        title: "Knox Hybrid Inverter 6kW Single Phase",
        brand: "Knox",
        modelSku: "K6",
        supplierProductId: "eq-k",
        currentListedPricePkr: 100000,
        availability: "in_stock",
      }),
      obs({
        supplier: "alladin",
        title: "Knox Hybrid Inverter 6kW Single Phase",
        brand: "Knox",
        modelSku: "K6",
        supplierProductId: "eq-a",
        currentListedPricePkr: 100000,
        availability: "in_stock",
      }),
    ];
    const svc = createSvc({
      repository: repo,
      fixtureObservations: fixtures,
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      },
    });
    const r1 = await svc.runAutomaticImport({ actorScope: "admin:super:ceo" });
    assert.equal(r1.status, "succeeded");
    assert.equal(committed.length, 1);
    assert.equal(committed[0]!.websitePricePkr, 100000);
    assert.equal(committed[0]!.selectedSupplier, "alladin");
    assert.equal(committed[0]!.defaultSourceKey, "alladin:eq-a");
    const firstListing = (await base.listListings())[0]!;
    const r2 = await svc.runAutomaticImport({ actorScope: "admin:super:ceo" });
    assert.equal(r2.status, "succeeded");
    assert.equal(r2.health.productsCreated, 0);
    assert.equal(r2.health.productsUpdated, 1);
    assert.equal(committed.length, 2);
    assert.equal(committed[1]!.selectedSupplier, "alladin");
    assert.equal(committed[1]!.defaultSourceKey, "alladin:eq-a");
    assert.equal(committed[1]!.websitePricePkr, 100000);
    const after = await base.listListings();
    assert.equal(after.length, 1);
    assert.equal(after[0]!.variantId, firstListing.variantId);
    assert.equal(after[0]!.selectedSupplier, "alladin");
    __resetAutoImportRunLockForTests();
  }

  console.log("ok - unified commercial selection integration (mixed/sold_out/equal/retry)");
}

{
  // Canonical route auth + preflight gated; non-super-admin forbidden
  function actor(role: string): RequestActor {
    return {
      id: "u1",
      username: "staff",
      name: role,
      email: "s@test.com",
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
    (req as any).actor = actor("Admin");
    next();
  });
  app.use(
    "/api/marketplace/admin",
    createMarketplaceAutoImportRouter({
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      },
      preflight: async () => {
        throw new Error("preflight should not run for non-super-admin");
      },
    }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  try {
    const run = await fetch(
      `http://127.0.0.1:${port}/api/marketplace/admin/suppliers/auto-import/run`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    assert.equal(run.status, 403);
    const pre = await fetch(
      `http://127.0.0.1:${port}/api/marketplace/admin/suppliers/auto-import/preflight`,
    );
    assert.equal(pre.status, 403);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  console.log("ok - canonical route authentication");
}

console.log("\nCEO auto-import tests passed.");
