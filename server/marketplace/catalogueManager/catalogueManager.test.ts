/**
 * Catalogue Manager core unit tests (no Docker).
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/marketplace/catalogueManager/catalogueManager.test.ts
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { mapPublishedImageUrls } from "../catalogue/catalogueMapper.ts";
import { createCatalogueManagerRouter } from "./catalogueManagerRoutes.ts";
import {
  activeOverridesByField,
  isMediaMutationLocked,
  resolveEffectiveValue,
} from "./fieldOverrides.ts";
import {
  createMemoryCatalogueManagerRepository,
  type MemProduct,
} from "./memoryCatalogueManagerRepository.ts";

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

const ACTOR = {
  id: "u-ceo",
  username: "ceo",
  role: "Super Admin",
};

function sampleProduct(id = "mpprod_1"): MemProduct {
  return {
    id,
    brandId: "mpbrand_knox",
    brandName: "Knox",
    categoryId: "mpcat_inv",
    categoryName: "Solar Inverter",
    title: "Supplier Title",
    slug: "supplier-title",
    description: "Supplier description",
    shortDescription: null,
    model: "K-1",
    seoTitle: null,
    seoDescription: null,
    datasheetUrl: null,
    warranty: "5 Years",
    specifications: { Capacity: "6kW" },
    tags: ["hybrid"],
    active: true,
    publicVisible: true,
    featured: false,
    stockStatus: "in_stock",
    websitePrice: 100000,
    compareAtPrice: null,
    selectedSupplier: "kamal",
    sourceUrls: ["https://kamalsolar.pk/products/x"],
    identityKey: "kamal:1:1",
    lastSupplierSyncAt: "2026-08-01T00:00:00.000Z",
    lastManualEditAt: null,
    supplier: {
      title: "Supplier Title",
      description: "Supplier description",
      shortDescription: null,
      model: "K-1",
      warranty: "5 Years",
      datasheetUrl: null,
      seoTitle: null,
      seoDescription: null,
      specifications: { Capacity: "6kW" },
      publicVisible: true,
      featured: false,
    },
  };
}

async function withServer(
  repo: ReturnType<typeof createMemoryCatalogueManagerRepository>,
  actorRole: string,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { actor?: unknown }).actor = {
      id: "u1",
      username: "tester",
      role: actorRole,
      accountStatus: "Approved",
    };
    next();
  });
  app.use(
    "/api/marketplace/admin/catalogue-manager",
    createCatalogueManagerRouter({
      env: { MARKETPLACE_ENABLED: "true" },
      repository: repo,
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
  const GOOD =
    "https://cdn.shopify.com/s/files/1/0000/0001/products/a.jpg";
  const GOOD2 =
    "https://www.kamalsolar.pk/cdn/shop/products/b.png";
  const BAD = "https://evil.example/x.jpg";

  // --- Effective value resolution ---
  const empty = activeOverridesByField([]);
  const base = resolveEffectiveValue({
    field: "title",
    supplierValue: "S",
    fallback: "F",
    overrides: empty,
  });
  check("supplier wins without override", base.source === "supplier" && base.value === "S");

  const repo = createMemoryCatalogueManagerRepository();
  repo.seedProduct!(sampleProduct());
  await repo.setOverride(
    "mpprod_1",
    { fieldName: "title", value: "CEO Title" },
    ACTOR,
  );
  const detail = await repo.getProduct("mpprod_1");
  check(
    "manual title override is effective",
    detail!.titleLayered.effective === "CEO Title" &&
      detail!.titleLayered.source === "manual",
  );

  // Simulate resync updating supplier baseline without clearing override
  const p = sampleProduct();
  p.supplier.title = "New Supplier Title";
  p.title = "New Supplier Title";
  // re-seed keeping overrides: memory repo keeps overrides array
  repo.seedProduct!(p);
  const afterSync = await repo.getProduct("mpprod_1");
  check(
    "resync does not erase title override",
    afterSync!.titleLayered.effective === "CEO Title",
  );

  await repo.clearOverride("mpprod_1", "title", ACTOR);
  const cleared = await repo.getProduct("mpprod_1");
  check(
    "clear override returns to supplier",
    cleared!.titleLayered.effective === "New Supplier Title" &&
      cleared!.titleLayered.source === "supplier",
  );

  // --- Media identity / idempotency / unsafe URL ---
  const media1 = await repo.replaceSupplierMedia(
    "mpprod_1",
    [
      { url: GOOD, sortOrder: 0, sourceKey: "kamal:1:1" },
      { url: GOOD2, sortOrder: 1, sourceKey: "kamal:1:1" },
      { url: BAD, sortOrder: 2 },
      { url: GOOD, sortOrder: 3 },
    ],
    "kamal",
  );
  check("unsafe URL rejected from media sync", media1.every((m) => m.sourceUrl !== BAD));
  check("primary + gallery without dupes", media1.filter((m) => m.published).length === 2);

  const media2 = await repo.replaceSupplierMedia(
    "mpprod_1",
    [
      { url: GOOD, sortOrder: 0, sourceKey: "kamal:1:1" },
      { url: GOOD2, sortOrder: 1, sourceKey: "kamal:1:1" },
    ],
    "kamal",
  );
  check(
    "media sync idempotent same ids",
    media2.filter((m) => m.published).map((m) => m.id).join() ===
      media1.filter((m) => m.published).map((m) => m.id).join(),
  );

  // Manual media preservation
  await repo.setManualPrimaryImage("mpprod_1", GOOD, ACTOR);
  const locked = await repo.replaceSupplierMedia(
    "mpprod_1",
    [{ url: GOOD2, sortOrder: 0, sourceKey: "kamal:9:9" }],
    "kamal",
  );
  const detailMedia = await repo.getProduct("mpprod_1");
  check(
    "manual primary_image override locks supplier media mutation",
    detailMedia!.primaryImage === GOOD &&
      isMediaMutationLocked(
        activeOverridesByField(detailMedia!.overrides),
      ),
  );
  check(
    "manual media row retained",
    locked.some((m) => m.manualControl && m.sourceUrl === GOOD),
  );

  // Cross-product identity
  repo.seedProduct!(sampleProduct("mpprod_2"));
  await repo.replaceSupplierMedia(
    "mpprod_2",
    [{ url: GOOD, sortOrder: 0, sourceKey: "alladin:2:2" }],
    "alladin",
  );
  const m1 = await repo.listMedia("mpprod_1");
  const m2 = await repo.listMedia("mpprod_2");
  check(
    "same CDN URL gets distinct media ids per product",
    m1.some((x) => x.sourceUrl === GOOD) &&
      m2.some((x) => x.sourceUrl === GOOD) &&
      m1.find((x) => x.sourceUrl === GOOD)!.id !==
        m2.find((x) => x.sourceUrl === GOOD)!.id,
  );

  // Publish / unpublish filtering
  await repo.bulkPublish(
    { productIds: ["mpprod_1"], publicVisible: false },
    ACTOR,
  );
  const hidden = await repo.getProduct("mpprod_1");
  check("bulk unpublish sets publicVisible false", hidden!.publicVisible === false);
  const listed = await repo.listProducts({
    limit: 50,
    offset: 0,
    publicVisible: true,
  });
  check(
    "publish filter excludes unpublished",
    listed.items.every((i) => i.id !== "mpprod_1"),
  );

  // Reject ledger
  await repo.recordReject({
    runId: "mpair_test",
    supplier: "alladin",
    sourceKey: "alladin:9:9",
    supplierProductId: "9",
    canonicalUrl: "https://alladin.pk/products/x",
    title: "Blender",
    identityKey: null,
    reason: "excluded_non_solar_retail",
    stage: "normalize",
    detail: {},
  });
  const recon = await repo.reconciliation({
    discoveredProducts: 1158,
    normalizedAcceptedObservations: 694,
  });
  check("reject ledger counted", recon.rejectLedgerRows >= 1);
  check("crm products metric labeled uniquely", recon.crmProducts >= 2);
  check(
    "metric notes present",
    typeof recon.metricNotes.crmProducts === "string",
  );

  // Audit events
  const audit = await repo.listAudit("mpprod_1");
  check("audit events created for mutations", audit.length >= 1);

  // Mapper public image DTO + missing fallback
  const mapped = mapPublishedImageUrls([
    {
      source_url: GOOD,
      sort_order: 0,
      role: "thumbnail",
      published: true,
      rights_status: "supplier_approved",
      source_type: "supplier",
    },
  ]);
  check("public image DTO maps allowlisted url", mapped.image === GOOD);
  check(
    "missing-image fallback null",
    mapPublishedImageUrls([]).image === null,
  );

  // Admin authorization
  await withServer(repo, "Admin", async (base) => {
    const res = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/products`,
    );
    check("non-super-admin forbidden", res.status === 403);
  });

  await withServer(repo, "Super Admin", async (base) => {
    const res = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/reconciliation`,
    );
    const body = await res.json();
    check("super-admin reconciliation ok", res.status === 200 && body.ok === true);

    const bad = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/products/mpprod_2/overrides`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fieldName: "primary_image",
          value: "javascript:alert(1)",
        }),
      },
    );
    check("unsafe override image rejected", bad.status === 400);

    const bulk = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/products/bulk/publish`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productIds: [], publicVisible: true }),
      },
    );
    check("bulk validation rejects empty ids", bulk.status === 400);
  });

  // Legacy compatibility: product without new fields still lists
  repo.seedProduct!({
    ...sampleProduct("mpprod_legacy"),
    lastSupplierSyncAt: null,
    shortDescription: null,
    seoTitle: null,
    publicVisible: true,
  });
  const legacyList = await repo.listProducts({ limit: 100, offset: 0 });
  check(
    "legacy row compatible in list",
    legacyList.items.some((i) => i.id === "mpprod_legacy"),
  );

  console.log("\nCatalogue Manager core tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
