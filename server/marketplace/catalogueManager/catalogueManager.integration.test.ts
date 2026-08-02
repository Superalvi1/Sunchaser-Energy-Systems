/**
 * Catalogue Manager integration tests (memory repo + shared state + mapper).
 *
 * Tests:
 *   - Mutations persist across new repository instances that share state
 *   - Public DTO uses overrides (mapProductDto with field_overrides)
 *   - public_visible=false override hides product in public catalogue
 *   - Clearing override restores supplier title
 *   - bulkCategory calls setOverride (blocks sync override re-write)
 *   - isMediaMutationLocked / isFieldProtected semantics
 *
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/marketplace/catalogueManager/catalogueManager.integration.test.ts
 */
import assert from "node:assert/strict";
import {
  createMemoryCatalogueManagerRepository,
  createMemSharedState,
  type MemProduct,
} from "./memoryCatalogueManagerRepository.ts";
import {
  activeOverridesByField,
  isMediaMutationLocked,
} from "./fieldOverrides.ts";
import { mapProductDto } from "../catalogue/catalogueMapper.ts";
import type { ProductRow } from "../catalogue/catalogueMapper.ts";

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

const ACTOR = { id: "u-ceo", username: "ceo", role: "Super Admin" };

// Configure own-storage host before importing image-policy functions.
process.env.MARKETPLACE_SUPABASE_STORAGE_HOST = "projxyz.supabase.co";

const OWN_URL = "https://projxyz.supabase.co/storage/v1/object/public/images/product.jpg";
const SUPPLIER_URL = "https://cdn.shopify.com/s/files/1/0000/0001/products/a.jpg";

function baseProduct(id = "p1"): MemProduct {
  return {
    id,
    brandId: "b1",
    brandName: "Knox",
    categoryId: "c1",
    categoryName: "Inverters",
    title: "Supplier Title",
    slug: "supplier-title",
    description: "Supplier description",
    shortDescription: null,
    model: "K-1",
    seoTitle: null,
    seoDescription: null,
    datasheetUrl: null,
    warranty: "1 year",
    specifications: { Watts: "500W" },
    tags: ["solar"],
    active: true,
    publicVisible: true,
    featured: false,
    stockStatus: "in_stock",
    websitePrice: 50000,
    compareAtPrice: null,
    selectedSupplier: "kamal",
    sourceUrls: [],
    identityKey: "kamal:p1",
    lastSupplierSyncAt: null,
    lastManualEditAt: null,
    supplier: {
      title: "Supplier Title",
      description: "Supplier description",
      shortDescription: null,
      model: "K-1",
      warranty: "1 year",
      datasheetUrl: null,
      seoTitle: null,
      seoDescription: null,
      specifications: { Watts: "500W" },
      publicVisible: true,
      featured: false,
    },
  };
}

function productRow(overrides?: Array<{ field_name: string; override_value: unknown; active: boolean }>): ProductRow {
  return {
    id: "pub-p1",
    slug: "pub-product",
    title: "Supplier Title",
    description: "Supplier description",
    tags: ["solar"],
    featured: false,
    specifications: { Watts: "500W" },
    warranty: "1 year",
    public_visible: true,
    brand: { id: "b1", slug: "knox", name: "Knox", active: true },
    category: { id: "c1", slug: "inverters", name: "Inverters", description: null, sort_order: 1, active: true },
    variants: [{
      sku: "SKU1",
      title: "Default",
      is_default: true,
      website_price: "50000",
      website_price_state: "priced_auto",
      website_price_source: "kamal",
      stock_status: "in_stock",
      active: true,
    }],
    media: [],
    field_overrides: overrides ?? null,
  };
}

async function main(): Promise<void> {
  // ── Shared state: mutations persist across repository instances ──────────
  const sharedState = createMemSharedState();
  const repo1 = createMemoryCatalogueManagerRepository(sharedState);
  const repo2 = createMemoryCatalogueManagerRepository(sharedState);

  repo1.seedProduct!(baseProduct("p1"));

  await repo1.setOverride("p1", { fieldName: "title", value: "Shared CEO Title" }, ACTOR);

  // repo2 sees the override set by repo1 (shared state)
  const p1FromRepo2 = await repo2.getProduct("p1");
  check(
    "mutations persist across instances sharing state",
    p1FromRepo2?.titleLayered.effective === "Shared CEO Title",
  );

  // repo2 can clear the override and repo1 sees it
  await repo2.clearOverride("p1", "title", ACTOR);
  const p1AfterClear = await repo1.getProduct("p1");
  check(
    "clear via shared repo2 visible in repo1",
    p1AfterClear?.titleLayered.effective === "Supplier Title" &&
      p1AfterClear?.titleLayered.source === "supplier",
  );

  // ── public_visible=false override hides product ──────────────────────────
  await repo1.setOverride("p1", { fieldName: "public_visible", value: false }, ACTOR);
  const hiddenListed = await repo1.listProducts({ limit: 50, offset: 0, publicVisible: true });
  check(
    "public_visible=false override hides product from filtered list",
    hiddenListed.items.every((i) => i.id !== "p1"),
  );

  // ── Clearing public_visible override restores visibility ─────────────────
  await repo1.clearOverride("p1", "public_visible", ACTOR);
  const restoredListed = await repo1.listProducts({ limit: 50, offset: 0, publicVisible: true });
  check(
    "clearing public_visible override restores visibility",
    restoredListed.items.some((i) => i.id === "p1"),
  );

  // ── bulkCategory sets override (blocks sync re-write) ────────────────────
  await repo1.bulkCategory({ productIds: ["p1"], categoryId: "c2" }, ACTOR);
  const afterBulkCat = await repo1.getProduct("p1");
  check(
    "bulkCategory updates categoryId",
    afterBulkCat?.categoryId === "c2",
  );
  // Verify override is set for category_id (isMediaMutationLocked checks image fields)
  const catOvs = activeOverridesByField(afterBulkCat?.overrides ?? []);
  check(
    "bulkCategory sets category_id override (blocks sync)",
    catOvs.has("category_id"),
  );

  // ── isMediaMutationLocked semantics ──────────────────────────────────────
  const noLock = activeOverridesByField([
    { fieldName: "title", value: "X", active: true },
  ]);
  check("isMediaMutationLocked false when no image overrides", !isMediaMutationLocked(noLock));

  const piLock = activeOverridesByField([
    { fieldName: "primary_image", value: OWN_URL, active: true },
  ]);
  check("isMediaMutationLocked true when primary_image override present", isMediaMutationLocked(piLock));

  const giLock = activeOverridesByField([
    { fieldName: "gallery_images", value: [SUPPLIER_URL], active: true },
  ]);
  check("isMediaMutationLocked true when gallery_images override present", isMediaMutationLocked(giLock));

  // ── mapProductDto: public DTO override integration ────────────────────────

  // No overrides
  const dtNoOv = mapProductDto(productRow());
  check("mapProductDto no overrides: base title", dtNoOv?.title === "Supplier Title");
  check("mapProductDto no overrides: public (not hidden)", dtNoOv !== null);

  // public_visible false override → null
  const dtHidden = mapProductDto(
    productRow([{ field_name: "public_visible", override_value: false, active: true }]),
  );
  check("mapProductDto public_visible false override → null", dtHidden === null);

  // title override
  const dtTitle = mapProductDto(
    productRow([{ field_name: "title", override_value: "CEO Override Title", active: true }]),
  );
  check("mapProductDto title override applied", dtTitle?.title === "CEO Override Title");

  // Clearing title override (inactive) → supplier title
  const dtClearedTitle = mapProductDto(
    productRow([{ field_name: "title", override_value: "CEO Override Title", active: false }]),
  );
  check("mapProductDto inactive title override → supplier title", dtClearedTitle?.title === "Supplier Title");

  // featured override
  const dtFeatured = mapProductDto(
    productRow([{ field_name: "featured", override_value: true, active: true }]),
  );
  check("mapProductDto featured=true override applied", dtFeatured?.featured === true);

  // primary_image override → image field
  const dtPi = mapProductDto(
    productRow([{ field_name: "primary_image", override_value: OWN_URL, active: true }]),
  );
  check("mapProductDto primary_image override → image field", dtPi?.image === OWN_URL);

  // stock_status override → defaultVariant.stockStatus
  const dtStock = mapProductDto(
    productRow([{ field_name: "stock_status", override_value: "sold_out", active: true }]),
  );
  check("mapProductDto stock_status override → defaultVariant.stockStatus", dtStock?.defaultVariant.stockStatus === "sold_out");

  // specifications override
  const specOv = { Power: "8kW", Brand: "Knox" };
  const dtSpec = mapProductDto(
    productRow([{ field_name: "specifications", override_value: specOv, active: true }]),
  );
  check("mapProductDto specifications override applied", dtSpec?.specifications.Power === "8kW");

  // warranty override
  const dtWarranty = mapProductDto(
    productRow([{ field_name: "warranty", override_value: "5 years", active: true }]),
  );
  check("mapProductDto warranty override applied", dtWarranty?.warranty === "5 years");

  // Multiple overrides combined
  const dtMultiple = mapProductDto(
    productRow([
      { field_name: "title", override_value: "Combined CEO Title", active: true },
      { field_name: "featured", override_value: true, active: true },
    ]),
  );
  check("mapProductDto multiple overrides applied", dtMultiple?.title === "Combined CEO Title" && dtMultiple?.featured === true);

  // replaceSupplierMedia is blocked when primary_image override is active
  repo1.seedProduct!(baseProduct("p2"));
  await repo1.setOverride("p2", { fieldName: "primary_image", value: OWN_URL }, ACTOR);
  const beforeSync = await repo1.listMedia("p2");
  await repo1.replaceSupplierMedia("p2", [{ url: SUPPLIER_URL, sortOrder: 0 }], "kamal");
  const afterSync = await repo1.listMedia("p2");
  check(
    "replaceSupplierMedia blocked when primary_image override active",
    beforeSync.length === afterSync.length &&
      afterSync.every((m) => m.sourceUrl !== SUPPLIER_URL || m.manualControl),
  );

  console.log("\nCatalogue Manager integration tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
