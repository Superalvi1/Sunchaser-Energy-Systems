import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CatalogueProductObservation } from "../suppliers/liveCatalogueTypes.ts";
import { createMemoryAutoImportRepository } from "./autoImportRepository.ts";
import {
  __resetAutoImportRunLockForTests,
  createAutoImportService,
} from "./autoImportService.ts";
import { selectKamalFirstInStockPrice } from "./priceSelect.ts";

const ENV = {
  MARKETPLACE_ENABLED: "true",
  MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
};

function observation(input: {
  supplier: "kamal" | "alladin";
  id: string;
  price: number;
  availability?: CatalogueProductObservation["availability"];
  title?: string;
}): CatalogueProductObservation {
  const title = input.title ?? "Inverex Nitrox 10kW Hybrid Solar Inverter";
  return {
    supplier: input.supplier,
    sourceKey: `${input.supplier}:${input.id}`,
    supplierProductId: input.id,
    title,
    brand: "Inverex",
    modelSku: "NITROX-10KW",
    category: "inverter",
    currentListedPricePkr: input.price,
    compareAtPricePkr: null,
    availability: input.availability ?? "in_stock",
    confirmPriceRecommended: false,
    canonicalUrl: `https://${input.supplier === "kamal" ? "kamalsolar.pk" : "alladin.pk"}/products/${input.id}`,
    primaryImageUrl: `https://cdn.example/${input.id}.jpg`,
    additionalImageUrls: [],
    description: "supplier description",
    parseStatus: "ok",
    fetchedAt: "2026-08-20T00:00:00.000Z",
    rawEvidence: { productType: "inverter" },
  };
}

{
  const selected = selectKamalFirstInStockPrice([
    {
      supplier: "kamal",
      sourceKey: "kamal:k",
      canonicalUrl: "https://kamalsolar.pk/products/k",
      title: "X",
      currentListedPricePkr: 250_000,
      parseStatus: "ok",
      availability: "in_stock",
      fetchedAt: "2026-08-20T00:00:00.000Z",
    },
    {
      supplier: "alladin",
      sourceKey: "alladin:a",
      canonicalUrl: "https://alladin.pk/products/a",
      title: "X",
      currentListedPricePkr: 200_000,
      parseStatus: "ok",
      availability: "in_stock",
      fetchedAt: "2026-08-20T00:00:00.000Z",
    },
  ]);
  assert.equal(selected.ok, true);
  if (selected.ok) {
    assert.equal(selected.supplier, "kamal");
    assert.equal(selected.pricePkr, 250_000);
    assert.equal(selected.reason, "kamal_first_in_stock");
  }
}

{
  const selected = selectKamalFirstInStockPrice([
    {
      supplier: "kamal",
      sourceKey: "kamal:k",
      canonicalUrl: "https://kamalsolar.pk/products/k",
      title: "X",
      currentListedPricePkr: 250_000,
      parseStatus: "ok",
      availability: "sold_out",
      fetchedAt: "2026-08-20T00:00:00.000Z",
    },
    {
      supplier: "alladin",
      sourceKey: "alladin:a",
      canonicalUrl: "https://alladin.pk/products/a",
      title: "X",
      currentListedPricePkr: 210_000,
      parseStatus: "ok",
      availability: "in_stock",
      fetchedAt: "2026-08-20T00:00:00.000Z",
    },
  ]);
  assert.equal(selected.ok, true);
  if (selected.ok) {
    assert.equal(selected.supplier, "alladin");
    assert.equal(selected.pricePkr, 210_000);
    assert.equal(selected.reason, "alladin_fallback_in_stock");
  }
}

{
  __resetAutoImportRunLockForTests();
  const repository = createMemoryAutoImportRepository();
  const seed = createAutoImportService({
    repository,
    env: ENV,
    fixtureObservations: [observation({ supplier: "kamal", id: "seed", price: 220_000 })],
  });
  const seeded = await seed.runAutomaticImport({ actorScope: "admin:super:test" });
  assert.equal(seeded.health.productsCreated, 1);
  const before = (await repository.listListings())[0]!;

  const daily = createAutoImportService({
    repository,
    env: ENV,
    fixtureObservations: [
      observation({ supplier: "kamal", id: "seed", price: 240_000 }),
      observation({ supplier: "alladin", id: "same", price: 190_000 }),
      observation({
        supplier: "kamal",
        id: "untracked",
        price: 100_000,
        title: "Untracked Solis 5kW Inverter",
      }),
    ],
  });
  const synced = await daily.runAutomaticImport({
    actorScope: "system:daily-price-test",
    mode: "price_only",
  });
  const listings = await repository.listListings();
  assert.equal(synced.status, "succeeded");
  assert.equal(synced.health.productsCreated, 0);
  assert.equal(synced.health.productsUpdated, 1);
  assert.equal(listings.length, 1, "price-only mode must not create untracked products");
  assert.equal(listings[0]!.websitePricePkr, 240_000);
  assert.equal(listings[0]!.selectedSupplier, "kamal");
  assert.equal(listings[0]!.title, before.title);
  assert.equal(listings[0]!.categoryName, before.categoryName);
  assert.equal(listings[0]!.availability, before.availability);
  assert.equal(listings[0]!.active, before.active);
}

console.log("ok - daily price-only sync is Kamal-first and existing-listing-only");

{
  const sql = readFileSync(
    join(process.cwd(), "scripts/marketplace-ceo-auto-import-atomic.sql"),
    "utf8",
  );
  assert.match(sql, /PRICE_ONLY_REQUIRES_EXISTING_LISTING/);
  assert.match(
    sql,
    /availability\s*=\s*case when v_price_only then availability else v_avail end/i,
  );
  assert.match(
    sql,
    /stock_status\s*=\s*case when v_price_only then stock_status else v_avail end/i,
  );
  const existingUpdateStart = sql.indexOf(
    "if not v_price_only then",
    sql.indexOf("v_variant_id := v_existing.variant_id"),
  );
  const existingUpdateEnd = sql.indexOf(
    "-- Optional Catalogue Manager column",
    existingUpdateStart,
  );
  assert.ok(existingUpdateStart >= 0 && existingUpdateEnd > existingUpdateStart);
  assert.match(
    sql.slice(existingUpdateStart, existingUpdateEnd),
    /update public\.mp_products/i,
  );
  assert.match(
    sql,
    /if not v_price_only\s+and to_regprocedure\('public\.mp_ceo_auto_import_sync_product_media/i,
  );
}

console.log("ok - SQL price-only mode preserves product metadata and inventory");
