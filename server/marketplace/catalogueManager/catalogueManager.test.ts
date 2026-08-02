/**
 * Catalogue Manager core unit tests (no Docker).
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/marketplace/catalogueManager/catalogueManager.test.ts
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { mapPublishedImageUrls, mapProductDto } from "../catalogue/catalogueMapper.ts";
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
import { parseSetOverrideBody } from "./catalogueManagerValidation.ts";

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

const ACTOR = {
  id: "u-ceo",
  username: "ceo",
  role: "Super Admin",
};

/** Supplier image (cdn.shopify.com — allowlisted supplier host) */
const GOOD = "https://cdn.shopify.com/s/files/1/0000/0001/products/a.jpg";
/** Another supplier image */
const GOOD2 = "https://www.kamalsolar.pk/cdn/shop/products/b.png";
/** Own supabase storage URL (always allowed as own image) */
const OWN_URL = "https://abcxyz.supabase.co/storage/v1/object/public/images/product.jpg";
/** Unapproved URL — not on any allowlist */
const BAD = "https://evil.example/x.jpg";
/** Unapproved non-https */
const BAD_HTTP = "http://cdn.shopify.com/s/files/1/0000/0001/products/a.jpg";

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

  // Manual media preservation — use OWN URL (supabase storage)
  await repo.setManualPrimaryImage("mpprod_1", OWN_URL, ACTOR);
  const locked = await repo.replaceSupplierMedia(
    "mpprod_1",
    [{ url: GOOD2, sortOrder: 0, sourceKey: "kamal:9:9" }],
    "kamal",
  );
  const detailMedia = await repo.getProduct("mpprod_1");
  check(
    "manual primary_image override locks supplier media mutation",
    detailMedia!.primaryImage === OWN_URL &&
      isMediaMutationLocked(
        activeOverridesByField(detailMedia!.overrides),
      ),
  );
  check(
    "manual media row retained",
    locked.some((m) => m.manualControl && m.sourceUrl === OWN_URL),
  );

  // Supplier URL rejected for setManualPrimaryImage (own policy enforced)
  let supplierUrlRejectedForManual = false;
  try {
    await repo.setManualPrimaryImage("mpprod_1", GOOD, ACTOR);
  } catch (err) {
    supplierUrlRejectedForManual = true;
  }
  check("supplier URL rejected for setManualPrimaryImage (own policy)", supplierUrlRejectedForManual);

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

  // mapPublishedImageUrls accepts own (supabase storage) URLs
  const ownMapped = mapPublishedImageUrls([
    {
      source_url: OWN_URL,
      sort_order: 0,
      role: "thumbnail",
      published: true,
      rights_status: "own",
      source_type: "own",
    },
  ]);
  check("public image DTO accepts own supabase storage URL", ownMapped.image === OWN_URL);

  // mapPublishedImageUrls rejects unapproved URLs
  const badMapped = mapPublishedImageUrls([
    {
      source_url: BAD,
      sort_order: 0,
      role: "thumbnail",
      published: true,
      rights_status: "supplier_approved",
      source_type: "supplier",
    },
  ]);
  check("public image DTO rejects unapproved URL", badMapped.image === null);

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

    // Unsafe image URL in override rejected (supplier=evil.example)
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
    check("unsafe override image rejected (javascript:)", bad.status === 400);

    // Non-https supplier URL rejected
    const badHttp = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/products/mpprod_2/overrides`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fieldName: "primary_image",
          value: BAD_HTTP,
        }),
      },
    );
    check("non-https override image rejected", badHttp.status === 400);

    // Non-allowlisted https URL rejected
    const badAllowlist = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/products/mpprod_2/overrides`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fieldName: "primary_image",
          value: BAD,
        }),
      },
    );
    check("unapproved host override image rejected", badAllowlist.status === 400);

    // Supplier URL for primary_image override accepted
    const goodSupplier = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/products/mpprod_2/overrides`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fieldName: "primary_image",
          value: GOOD,
        }),
      },
    );
    check("supplier URL accepted for primary_image override", goodSupplier.status === 201);

    // Own URL (supabase storage) for primary_image override accepted
    const goodOwn = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/products/mpprod_2/overrides`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fieldName: "primary_image",
          value: OWN_URL,
        }),
      },
    );
    check("own supabase URL accepted for primary_image override", goodOwn.status === 201);

    // Wrong type for public_visible override (string instead of boolean)
    const badBoolType = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/products/mpprod_2/overrides`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fieldName: "public_visible",
          value: "true",
        }),
      },
    );
    check("string value for public_visible override rejected", badBoolType.status === 400);

    // Wrong type for featured override (number instead of boolean)
    const badFeaturedType = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/products/mpprod_2/overrides`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fieldName: "featured",
          value: 1,
        }),
      },
    );
    check("number value for featured override rejected", badFeaturedType.status === 400);

    // Correct boolean type for public_visible accepted
    const goodBool = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/products/mpprod_2/overrides`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fieldName: "public_visible",
          value: false,
        }),
      },
    );
    check("boolean false for public_visible override accepted", goodBool.status === 201);

    // Invalid stock_status enum value
    const badStockStatus = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/products/mpprod_2/overrides`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fieldName: "stock_status",
          value: "available",
        }),
      },
    );
    check("invalid stock_status enum rejected", badStockStatus.status === 400);

    // Valid stock_status enum value
    const goodStockStatus = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/products/mpprod_2/overrides`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fieldName: "stock_status",
          value: "in_stock",
        }),
      },
    );
    check("valid stock_status enum accepted", goodStockStatus.status === 201);

    // specifications with non-string values rejected
    const badSpecs = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/products/mpprod_2/overrides`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fieldName: "specifications",
          value: { Capacity: 6000, Brand: "Knox" },
        }),
      },
    );
    check("specifications with numeric value rejected", badSpecs.status === 400);

    // specifications with all string values accepted
    const goodSpecs = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/products/mpprod_2/overrides`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fieldName: "specifications",
          value: { Capacity: "6kW", Brand: "Knox" },
        }),
      },
    );
    check("specifications with string values accepted", goodSpecs.status === 201);

    // gallery_images more than 8 URLs rejected
    const manyUrls = Array.from({ length: 9 }, () => GOOD);
    const badGallery = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/products/mpprod_2/overrides`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fieldName: "gallery_images",
          value: manyUrls,
        }),
      },
    );
    check("gallery_images with >8 URLs rejected", badGallery.status === 400);

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

  // --- parseSetOverrideBody unit tests ---
  // public_visible: string rejected
  let threw = false;
  try { parseSetOverrideBody({ fieldName: "public_visible", value: "false" }); } catch { threw = true; }
  check("parseSetOverrideBody: public_visible string rejected", threw);

  // featured: object rejected
  threw = false;
  try { parseSetOverrideBody({ fieldName: "featured", value: {} }); } catch { threw = true; }
  check("parseSetOverrideBody: featured object rejected", threw);

  // stock_status: invalid enum rejected
  threw = false;
  try { parseSetOverrideBody({ fieldName: "stock_status", value: "available" }); } catch { threw = true; }
  check("parseSetOverrideBody: stock_status invalid enum rejected", threw);

  // stock_status: valid enum passes
  const validStock = parseSetOverrideBody({ fieldName: "stock_status", value: "sold_out" });
  check("parseSetOverrideBody: stock_status sold_out accepted", validStock.value === "sold_out");

  // brand_id: empty string rejected
  threw = false;
  try { parseSetOverrideBody({ fieldName: "brand_id", value: "  " }); } catch { threw = true; }
  check("parseSetOverrideBody: brand_id empty string rejected", threw);

  // brand_id: non-empty string accepted
  const validBrand = parseSetOverrideBody({ fieldName: "brand_id", value: "mpbrand_123" });
  check("parseSetOverrideBody: brand_id non-empty string accepted", validBrand.value === "mpbrand_123");

  // specifications: non-string value rejected
  threw = false;
  try { parseSetOverrideBody({ fieldName: "specifications", value: { X: 1 } }); } catch { threw = true; }
  check("parseSetOverrideBody: specifications non-string value rejected", threw);

  // specifications: too many keys rejected
  const bigSpec = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, "v"]));
  threw = false;
  try { parseSetOverrideBody({ fieldName: "specifications", value: bigSpec }); } catch { threw = true; }
  check("parseSetOverrideBody: specifications >40 keys rejected", threw);

  // gallery_images: >8 URLs rejected
  threw = false;
  try {
    parseSetOverrideBody({ fieldName: "gallery_images", value: Array(9).fill(GOOD) });
  } catch { threw = true; }
  check("parseSetOverrideBody: gallery_images >8 URLs rejected", threw);

  // primary_image: own supabase URL accepted
  const ownOverride = parseSetOverrideBody({ fieldName: "primary_image", value: OWN_URL });
  check("parseSetOverrideBody: own supabase URL accepted for primary_image", ownOverride.value === OWN_URL);

  // primary_image: unapproved URL rejected
  threw = false;
  try { parseSetOverrideBody({ fieldName: "primary_image", value: BAD }); } catch { threw = true; }
  check("parseSetOverrideBody: unapproved URL rejected for primary_image", threw);

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

  // --- mapProductDto unit tests with field_overrides ---
  const baseProductRow = {
    id: "test-p1",
    slug: "test-product",
    title: "Original Title",
    description: "Original description",
    tags: ["solar"],
    featured: false,
    specifications: { Power: "6kW" },
    warranty: "2 years",
    public_visible: true,
    brand: { id: "b1", slug: "knox", name: "Knox", active: true },
    category: { id: "c1", slug: "inverters", name: "Inverters", description: null, sort_order: 1, active: true },
    variants: [{ sku: "SKU1", title: "Default", is_default: true, website_price: "50000", website_price_state: "priced_auto", website_price_source: "kamal", stock_status: "in_stock", active: true }],
    media: [],
    field_overrides: null,
  };

  // No overrides → base values
  const noOvDto = mapProductDto(baseProductRow);
  check("mapProductDto: no overrides returns base title", noOvDto?.title === "Original Title");
  check("mapProductDto: no overrides returns base featured", noOvDto?.featured === false);

  // public_visible false override → product hidden
  const hiddenRow = {
    ...baseProductRow,
    field_overrides: [{ field_name: "public_visible", override_value: false, active: true }],
  };
  const hiddenDto = mapProductDto(hiddenRow);
  check("mapProductDto: public_visible false override hides product", hiddenDto === null);

  // title override applied
  const titleOvRow = {
    ...baseProductRow,
    field_overrides: [{ field_name: "title", override_value: "CEO Title", active: true }],
  };
  const titleOvDto = mapProductDto(titleOvRow);
  check("mapProductDto: title override applied", titleOvDto?.title === "CEO Title");

  // featured override true
  const featuredOvRow = {
    ...baseProductRow,
    field_overrides: [{ field_name: "featured", override_value: true, active: true }],
  };
  const featuredOvDto = mapProductDto(featuredOvRow);
  check("mapProductDto: featured override true applied", featuredOvDto?.featured === true);

  // primary_image override → image field
  const piOvRow = {
    ...baseProductRow,
    field_overrides: [{ field_name: "primary_image", override_value: OWN_URL, active: true }],
  };
  const piOvDto = mapProductDto(piOvRow);
  check("mapProductDto: primary_image override used as image", piOvDto?.image === OWN_URL);

  // inactive override → not applied
  const inactiveOvRow = {
    ...baseProductRow,
    field_overrides: [{ field_name: "title", override_value: "Old CEO Title", active: false }],
  };
  const inactiveOvDto = mapProductDto(inactiveOvRow);
  check("mapProductDto: inactive override not applied", inactiveOvDto?.title === "Original Title");

  // column public_visible=false → hidden (no override)
  const columnHiddenRow = { ...baseProductRow, public_visible: false, field_overrides: null };
  const columnHiddenDto = mapProductDto(columnHiddenRow);
  check("mapProductDto: column public_visible false hides product", columnHiddenDto === null);

  console.log("\nCatalogue Manager core tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
