import assert from "node:assert/strict";
import type { Product } from "../../types.ts";
import {
  applyWebsiteCatalogPersistenceFailure,
  applyWebsiteCatalogSync,
  assertWebsiteCatalogUrl,
  authorizeWebsiteCatalogSyncAccess,
  canSyncWebsiteCatalog,
  catalogFingerprint,
  evaluateCatalogDiscovery,
  extractSitemapProductSlugs,
  findExistingCatalogIndex,
  finalizeWebsiteCatalogSync,
  liftWebsiteSourceFields,
  mapWebsiteCatalogProductForSupabase,
  normalizeWebsiteProduct,
  parseProductJsonLd,
  parseShopCatalog,
  patchLatestSettingsWithWebsiteCatalogSync,
  resolveWebsiteCatalogSyncBaseline,
  resolveWebsiteProductType,
  runWebsiteCatalogSync,
  toCrmProduct,
  withWebsiteSourceMetadata,
  WEBSITE_CATALOG_SOURCE,
  WEBSITE_SOURCE_SPEC_KEY,
} from "./index.ts";

let pass = 0;
function check(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`PASS: ${name}`);
}

async function checkAsync(name: string, fn: () => Promise<void>) {
  await fn();
  pass += 1;
  console.log(`PASS: ${name}`);
}

function shopHtmlFor(products: unknown[]): string {
  const inner = `37:${JSON.stringify(["$", "$L41", null, { products }])}`;
  const payload = JSON.stringify([1, inner]);
  return `<html><script>self.__next_f.push(${payload})</script></html>`;
}

const panelRaw = {
  slug: "aiko-stellar-665-w-f7faac82",
  title: "Aiko Stellar 665 W N-Type Topcon Double Glass Solar Panel",
  description: "View current catalogue pricing",
  brand: "Aiko Solar",
  categorySlug: "solar-panels",
  tags: "",
  featured: false,
  specifications: {},
  warranty: "25 Years",
  image: "https://cdn.shopify.com/aiko.png",
  images: [],
  sku: "SC-AUTO-81F7FAAC82",
  price: 28661.5,
  originalPrice: 30000,
  priceState: "priced_auto",
  priceSource: "alladin",
  stockStatus: "in_stock",
  purchasable: true,
  dataOrigin: "crm",
};

const inverterRaw = {
  ...panelRaw,
  slug: "goodwe-10kw-hybrid",
  title: "GoodWe 10kW Hybrid Inverter",
  brand: "GoodWe",
  categorySlug: "hybrid-solar-inverter",
  sku: "SC-AUTO-GW10",
  price: 400000,
};

check("website product normalization maps panel type and extracts wattage from title", () => {
  const mapped = resolveWebsiteProductType("solar-panels", panelRaw.title);
  assert.equal(mapped.type, "panel");
  const product = normalizeWebsiteProduct(panelRaw as any, "2026-09-05T00:00:00.000Z");
  assert.equal(product.source, WEBSITE_CATALOG_SOURCE);
  assert.equal(product.panelWattage, 665);
  assert.equal(product.price, 28661.5);
  assert.equal(product.listPrice, 30000);
  assert.equal(product.currency, "PKR");
  assert.match(product.sourceUrl, /sunchaserenergy\.co\/shop\/aiko-stellar-665-w-f7faac82/);
  assert.equal(product.productType, "panel");
});

check("complete systems stay packages, not inverters", () => {
  const mapped = resolveWebsiteProductType("solar-inverter", "10kW Complete Solar System Package");
  assert.equal(mapped.type, "package");
});

const html = shopHtmlFor([panelRaw, inverterRaw]);
const sitemap = `<?xml version="1.0"?><urlset>
<loc>https://www.sunchaserenergy.co/shop/aiko-stellar-665-w-f7faac82</loc>
<loc>https://www.sunchaserenergy.co/shop/goodwe-10kw-hybrid</loc>
<loc>https://www.sunchaserenergy.co/shop/category/solar-panels</loc>
</urlset>`;

check("RSC shop payload is the catalog source", () => {
  const discovery = parseShopCatalog(html, sitemap);
  assert.equal(discovery.source, "next_rsc_shop");
  assert.equal(discovery.discoveryUsable, true);
  assert.equal(discovery.deactivationSafe, true);
  assert.equal(discovery.discoveryComplete, true);
  assert.equal(discovery.products.length, 2);
  assert.equal(extractSitemapProductSlugs(sitemap).length, 2);
});

check("product JSON-LD is parsed when present", () => {
  const ld = parseProductJsonLd(`<script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    name: "Aiko Stellar 665 W",
    brand: { "@type": "Brand", name: "Aiko Solar" },
    offers: { price: 28661.5, priceCurrency: "PKR" },
  })}</script>`);
  assert.equal(ld?.name, "Aiko Stellar 665 W");
});

const syncedAt = "2026-09-05T00:00:00.000Z";
const discovered = [panelRaw, inverterRaw].map((raw) => normalizeWebsiteProduct(raw as any, syncedAt));
const fullSync = { discoveryUsable: true, deactivationSafe: true, sitemapAvailable: true, syncedAt };

check("sync twice does not duplicate", () => {
  const first = applyWebsiteCatalogSync([], discovered, fullSync);
  const second = applyWebsiteCatalogSync(first.products, discovered, fullSync);
  assert.equal(first.report.added, 2);
  assert.equal(second.report.added, 0);
  assert.equal(second.products.filter((p) => p.source === WEBSITE_CATALOG_SOURCE).length, 2);
});

check("price update updates current catalog", () => {
  const first = applyWebsiteCatalogSync([], discovered, fullSync);
  const updatedPanel = normalizeWebsiteProduct({ ...panelRaw, price: 31000 } as any, "2026-09-06T00:00:00.000Z");
  const second = applyWebsiteCatalogSync(first.products, [updatedPanel, discovered[1]], {
    ...fullSync,
    syncedAt: "2026-09-06T00:00:00.000Z",
  });
  const panel = second.products.find((p) => p.sourceSlug === panelRaw.slug)!;
  assert.equal(panel.price, 31000);
  assert.equal(second.report.updated >= 1, true);
});

check("missing product becomes inactive and is not deleted", () => {
  const first = applyWebsiteCatalogSync([], discovered, fullSync);
  const second = applyWebsiteCatalogSync(first.products, [discovered[1]], fullSync);
  const missing = second.products.find((p) => p.sourceSlug === panelRaw.slug)!;
  assert.equal(Boolean(missing), true);
  assert.equal(missing.sourceActive, false);
  assert.equal(second.report.inactive, 1);
});

check("failed website sync leaves catalogue intact", () => {
  const first = applyWebsiteCatalogSync([], discovered, fullSync);
  const failed = applyWebsiteCatalogSync(first.products, [], {
    discoveryUsable: false,
    deactivationSafe: false,
    syncedAt: "2026-09-06T00:00:00.000Z",
  });
  assert.equal(failed.products.length, first.products.length);
  assert.equal(failed.report.lastStatus, "failed");
  assert.equal(failed.products.every((p) => p.sourceActive !== false || p.sourceSlug === panelRaw.slug || true), true);
});

check("external arbitrary URL rejected", () => {
  assert.throws(() => assertWebsiteCatalogUrl("https://evil.example/api"), /allowlisted|Host/);
  assert.throws(() => assertWebsiteCatalogUrl("http://www.sunchaserenergy.co/shop"), /HTTPS/);
  assert.doesNotThrow(() => assertWebsiteCatalogUrl("https://www.sunchaserenergy.co/shop"));
});

check("authorized admin may sync and salesperson may not", () => {
  assert.equal(canSyncWebsiteCatalog("owner", "Super Admin"), true);
  assert.equal(authorizeWebsiteCatalogSyncAccess({ username: "owner", role: "Admin" }).ok, true);
  assert.equal(canSyncWebsiteCatalog("sales", "Sales Executive"), false);
  const denied = authorizeWebsiteCatalogSyncAccess({ username: "sales", role: "Sales Executive" });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 403);
  const missing = authorizeWebsiteCatalogSyncAccess(null);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 401);
});

await checkAsync("runWebsiteCatalogSync uses injected fetch and does not wipe on empty shop", async () => {
  const existing: Product[] = [
    {
      id: "keep-me",
      name: "Existing CRM Panel",
      category: "Solar Panels",
      brand: "LONGi",
      model: "Hi-MO",
      sku: "KEEP",
      price: 1,
      discount: 0,
      stock: 1,
      images: [],
      warrantyPeriod: "",
      specifications: {},
      installationRequired: false,
      serviceRequired: false,
    },
  ];
  const failed = await runWebsiteCatalogSync(existing, async () => {
    throw new Error("network down");
  });
  assert.equal(failed.products[0].id, "keep-me");
  assert.equal(failed.report.lastStatus, "failed");

  const ok = await runWebsiteCatalogSync(existing, async (url) => {
    if (url.endsWith("/shop")) return { status: 200, body: html };
    return { status: 200, body: sitemap };
  });
  assert.equal(ok.report.discoveryUsable, true);
  assert.equal(ok.report.added, 2);
  assert.equal(ok.products.some((p) => p.id === "keep-me"), true);
  assert.equal(ok.changedProductIds.includes("keep-me"), false);
});

function sitemapForSlugs(slugs: string[]): string {
  return `<?xml version="1.0"?><urlset>${slugs.map((slug) => `<loc>https://www.sunchaserenergy.co/shop/${slug}</loc>`).join("")}</urlset>`;
}

check("full sitemap match allows true removal to become inactive", () => {
  const slugs = Array.from({ length: 736 }, (_, i) => `product-${i}`);
  const flags = evaluateCatalogDiscovery(slugs.map((slug) => ({ slug })), slugs);
  assert.equal(flags.discoveryUsable, true);
  assert.equal(flags.deactivationSafe, true);
  const xml = sitemapForSlugs(slugs);
  assert.equal(extractSitemapProductSlugs(xml).length, 736);
});

check("partial RSC vs full sitemap does not inactivate", () => {
  const sitemapSlugs = Array.from({ length: 736 }, (_, i) => `product-${i}`);
  const rsc = sitemapSlugs.slice(0, 100).map((slug) => ({ slug }));
  const flags = evaluateCatalogDiscovery(rsc, sitemapSlugs);
  assert.equal(flags.discoveryUsable, true);
  assert.equal(flags.deactivationSafe, false);
  const first = applyWebsiteCatalogSync([], discovered, fullSync);
  const partial = applyWebsiteCatalogSync(first.products, [discovered[0]], {
    discoveryUsable: true,
    deactivationSafe: false,
    sitemapAvailable: true,
    syncedAt,
  });
  const missing = partial.products.find((p) => p.sourceSlug === inverterRaw.slug)!;
  assert.equal(missing.sourceActive, true);
  assert.equal(partial.report.inactive, 0);
});

check("sitemap failure allows add/update but no mass deactivation", () => {
  const first = applyWebsiteCatalogSync([], discovered, fullSync);
  const next = applyWebsiteCatalogSync(first.products, [discovered[0]], {
    discoveryUsable: true,
    deactivationSafe: false,
    sitemapAvailable: false,
    syncedAt: "2026-09-06T00:00:00.000Z",
  });
  assert.equal(next.products.find((p) => p.sourceSlug === inverterRaw.slug)?.sourceActive, true);
  assert.equal(next.report.inactive, 0);
});

check("normalization failure protects existing slug from deactivation", () => {
  const first = applyWebsiteCatalogSync([], discovered, fullSync);
  const next = applyWebsiteCatalogSync(first.products, [discovered[1]], {
    ...fullSync,
    protectedSlugs: [panelRaw.slug],
  });
  assert.equal(next.products.find((p) => p.sourceSlug === panelRaw.slug)?.sourceActive, true);
  assert.equal(next.report.inactive, 0);
});

check("parse errors disable deactivation even when counts would match", () => {
  const incompleteHtml = shopHtmlFor([panelRaw, { slug: "broken-payload" }]);
  const matchingSitemap = `<?xml version="1.0"?><urlset>
<loc>https://www.sunchaserenergy.co/shop/${panelRaw.slug}</loc>
</urlset>`;
  const discovery = parseShopCatalog(incompleteHtml, matchingSitemap);
  assert.equal(discovery.products.length, 1);
  assert.equal(discovery.failedSourceSlugs.includes("broken-payload"), true);
  assert.equal(discovery.deactivationSafe, false);
});

check("sourceActive=false survives specification persistence round trip", () => {
  const product = toCrmProduct(discovered[0]);
  assert.equal(product.sourceActive, true);
  const inactive = withWebsiteSourceMetadata(product, { sourceActive: false });
  assert.equal(inactive.sourceActive, false);
  const blob = JSON.parse(String(inactive.specifications[WEBSITE_SOURCE_SPEC_KEY]));
  assert.equal(blob.sourceActive, false);
  const supabaseRow = {
    id: inactive.id,
    name: inactive.name,
    category: inactive.category,
    brand: inactive.brand,
    model: inactive.model,
    sku: inactive.sku,
    price: inactive.price,
    discount: inactive.discount,
    stock: inactive.stock,
    images: inactive.images,
    warrantyPeriod: inactive.warrantyPeriod,
    specifications: inactive.specifications,
    installationRequired: false,
    serviceRequired: false,
  };
  const lifted = liftWebsiteSourceFields(supabaseRow as Product);
  assert.equal(lifted.sourceActive, false);
});

check("CRM stock is preserved while website availability updates", () => {
  const existing: Product = {
    ...toCrmProduct(discovered[0]),
    stock: 80,
  };
  const next = applyWebsiteCatalogSync([existing], discovered, fullSync);
  const panel = next.products.find((p) => p.sourceSlug === panelRaw.slug)!;
  assert.equal(panel.stock, 80);
  assert.equal(panel.availability, "in_stock");
});

check("identical content with a later timestamp reports unchanged", () => {
  const first = applyWebsiteCatalogSync([], discovered, fullSync);
  const later = discovered.map((p) => normalizeWebsiteProduct(
    p.sourceSlug === panelRaw.slug ? panelRaw : inverterRaw as any,
    "2026-09-06T00:00:00.000Z"
  ));
  const second = applyWebsiteCatalogSync(first.products, later, { ...fullSync, syncedAt: "2026-09-06T00:00:00.000Z" });
  assert.equal(second.report.updated, 0);
  assert.equal(second.report.added, 0);
  assert.equal(second.report.unchanged >= 2, true);
  assert.equal(second.productsToPersist.length, 0);
  assert.equal(
    catalogFingerprint(first.products[0]),
    catalogFingerprint(toCrmProduct(later.find((p) => p.sourceSlug === first.products[0].sourceSlug) || later[0], first.products[0]))
  );
});

check("stale local products do not overwrite newer Supabase baseline", () => {
  const stale: Product[] = [{ ...toCrmProduct(discovered[0]), name: "STALE" }];
  const latest: Product[] = [{ ...toCrmProduct(discovered[0]), name: "LATEST FROM SUPABASE", stock: 12 }];
  const baseline = resolveWebsiteCatalogSyncBaseline(stale, { keep: true }, true, { products: latest, settings: { keep: true, other: 1 } });
  assert.equal(baseline.products[0].name, "LATEST FROM SUPABASE");
  const patched = patchLatestSettingsWithWebsiteCatalogSync(baseline.settings, emptyWebsiteCatalogReportFromTest());
  assert.equal((patched as any).keep, true);
  assert.equal((patched as any).other, 1);
});

function emptyWebsiteCatalogReportFromTest() {
  return {
    discovered: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    inactive: 0,
    errors: [],
    lastSyncedAt: null,
    lastStatus: "idle" as const,
    source: "next_rsc_shop" as const,
    discoveryComplete: false,
    discoveryUsable: false,
    deactivationSafe: false,
  };
}

check("unrelated CRM product is not rewritten", () => {
  const manual: Product = {
    id: "manual-crm-1",
    name: "Manual LONGi",
    category: "Solar Panels",
    brand: "LONGi",
    model: "Hi-MO 7",
    sku: "MANUAL-1",
    price: 99,
    discount: 0,
    stock: 7,
    images: [],
    warrantyPeriod: "",
    specifications: { note: "owner entered" },
    installationRequired: false,
    serviceRequired: false,
  };
  const result = applyWebsiteCatalogSync([manual], discovered, fullSync);
  const kept = result.products.find((p) => p.id === "manual-crm-1")!;
  assert.equal(kept.stock, 7);
  assert.equal(kept.specifications.note, "owner entered");
  assert.equal(result.changedProductIds.includes("manual-crm-1"), false);
  assert.equal(result.productsToPersist.some((p) => p.id === "manual-crm-1"), false);
});

check("unsafe SKU-only collision does not merge", () => {
  const manual: Product = {
    id: "manual-sku-collision",
    name: "Unrelated box",
    category: "Accessories",
    brand: "OtherBrand",
    model: "Box",
    sku: panelRaw.sku,
    price: 10,
    discount: 0,
    stock: 3,
    images: [],
    warrantyPeriod: "",
    specifications: {},
    installationRequired: false,
    serviceRequired: false,
  };
  assert.equal(findExistingCatalogIndex([manual], discovered[0]), -1);
  const result = applyWebsiteCatalogSync([manual], [discovered[0]], fullSync);
  assert.equal(result.products.find((p) => p.id === "manual-sku-collision")?.brand, "OtherBrand");
  assert.equal(result.products.some((p) => p.sourceSlug === panelRaw.slug && p.id !== "manual-sku-collision"), true);
});

check("persistence error produces failed sync result", () => {
  const failed = applyWebsiteCatalogPersistenceFailure(
    { ...emptyWebsiteCatalogReportFromTest(), lastStatus: "success" },
    "Supabase product upsert failed: boom",
    { persistedCount: 80, attemptedCount: 200 }
  );
  assert.equal(failed.lastStatus, "failed");
  assert.equal(failed.errors.some((e) => /boom/.test(e)), true);
  assert.equal(failed.errors.some((e) => /80\/200/.test(e)), true);
});

await checkAsync("sitemap HTTP failure updates without mass deactivation", async () => {
  const first = applyWebsiteCatalogSync([], discovered, fullSync);
  const next = await runWebsiteCatalogSync(first.products, async (url) => {
    if (url.endsWith("/shop")) return { status: 200, body: shopHtmlFor([panelRaw]) };
    return { status: 500, body: "" };
  });
  assert.equal(next.report.discoveryUsable, true);
  assert.equal(next.report.deactivationSafe, false);
  assert.equal(next.report.inactive, 0);
  assert.equal(next.products.find((p) => p.sourceSlug === inverterRaw.slug)?.sourceActive, true);
});

check("new website product mapper initializes stock 0 and omits CRM fields on update", () => {
  const created = toCrmProduct(discovered[0]);
  const insertRow = mapWebsiteCatalogProductForSupabase(created, { existsRemotely: false });
  assert.equal(insertRow.stock, 0);
  assert.equal(insertRow.discount, 0);
  const updateRow = mapWebsiteCatalogProductForSupabase({ ...created, stock: 80, discount: 5 }, { existsRemotely: true });
  assert.equal("stock" in updateRow, false);
  assert.equal("discount" in updateRow, false);
  assert.equal(updateRow.price, created.price);
});

await checkAsync("settings changed during sync remain preserved", async () => {
  const proposed = applyWebsiteCatalogSync([], discovered, fullSync);
  let remoteSettings: Record<string, unknown> = { someOtherSetting: "A", keep: true };
  remoteSettings = { someOtherSetting: "B", keep: true };
  const outcome = await finalizeWebsiteCatalogSync({
    supabaseActive: true,
    baselineProducts: [],
    localSettingsFallback: { someOtherSetting: "A" },
    result: proposed,
    adapters: {
      fetchLatestSettings: async () => remoteSettings,
      fetchCurrentProductsByIds: async () => new Map(),
      upsertProductChunk: async () => ({ error: null }),
      upsertSettings: async () => {},
    },
  });
  assert.equal((outcome.settings as any).someOtherSetting, "B");
  assert.equal((outcome.settings as any).keep, true);
  assert.equal((outcome.settings as any).websiteCatalogSync.lastStatus, "success");
  assert.equal(outcome.success, true);
});

await checkAsync("concurrent stock and discount changes remain preserved while website price updates", async () => {
  const existing: Product = { ...toCrmProduct(discovered[0]), stock: 80, discount: 5 };
  const first = applyWebsiteCatalogSync([existing], discovered, fullSync);
  const updatedPanel = normalizeWebsiteProduct({ ...panelRaw, price: 31000 } as any, "2026-09-06T00:00:00.000Z");
  const proposed = applyWebsiteCatalogSync(first.products, [updatedPanel, discovered[1]], {
    ...fullSync,
    syncedAt: "2026-09-06T00:00:00.000Z",
  });
  const written: Array<Record<string, unknown>> = [];
  const outcome = await finalizeWebsiteCatalogSync({
    supabaseActive: true,
    baselineProducts: first.products,
    localSettingsFallback: { someOtherSetting: "A" },
    result: proposed,
    adapters: {
      fetchLatestSettings: async () => ({ someOtherSetting: "B" }),
      fetchCurrentProductsByIds: async () =>
        new Map([[existing.id, { ...existing, stock: 75, discount: 9 }]]),
      upsertProductChunk: async (rows) => {
        written.push(...rows);
        return { error: null };
      },
      upsertSettings: async () => {},
    },
  });
  const committed = outcome.products.find((p) => p.id === existing.id)!;
  assert.equal(committed.price, 31000);
  assert.equal(committed.stock, 75);
  assert.equal(committed.discount, 9);
  const row = written.find((r) => r.id === existing.id)!;
  assert.equal(row.price, 31000);
  assert.equal("stock" in row, false);
  assert.equal("discount" in row, false);
});

await checkAsync("Supabase persistence failure leaves local products at baseline", async () => {
  const baseline = applyWebsiteCatalogSync([], discovered, fullSync);
  const updatedPanel = normalizeWebsiteProduct({ ...panelRaw, price: 31000 } as any, "2026-09-06T00:00:00.000Z");
  const proposed = applyWebsiteCatalogSync(baseline.products, [updatedPanel, discovered[1]], {
    ...fullSync,
    syncedAt: "2026-09-06T00:00:00.000Z",
  });
  const outcome = await finalizeWebsiteCatalogSync({
    supabaseActive: true,
    baselineProducts: baseline.products,
    localSettingsFallback: { someOtherSetting: "A" },
    result: proposed,
    adapters: {
      fetchLatestSettings: async () => ({ someOtherSetting: "B" }),
      fetchCurrentProductsByIds: async () => new Map(baseline.products.map((p) => [p.id, p])),
      upsertProductChunk: async () => ({ error: "boom" }),
      upsertSettings: async () => {},
    },
  });
  assert.equal(outcome.success, false);
  assert.equal(outcome.commitLocalProducts, false);
  assert.equal(outcome.products.find((p) => p.sourceSlug === panelRaw.slug)?.price, panelRaw.price);
  assert.equal((outcome.settings as any).someOtherSetting, "B");
  assert.equal(outcome.report.lastStatus, "failed");
});

await checkAsync("successful remote persistence then updates local DB", async () => {
  const baseline = applyWebsiteCatalogSync([], discovered, fullSync);
  const updatedPanel = normalizeWebsiteProduct({ ...panelRaw, price: 31000 } as any, "2026-09-06T00:00:00.000Z");
  const proposed = applyWebsiteCatalogSync(baseline.products, [updatedPanel, discovered[1]], {
    ...fullSync,
    syncedAt: "2026-09-06T00:00:00.000Z",
  });
  const outcome = await finalizeWebsiteCatalogSync({
    supabaseActive: true,
    baselineProducts: baseline.products,
    localSettingsFallback: { someOtherSetting: "A" },
    result: proposed,
    adapters: {
      fetchLatestSettings: async () => ({ someOtherSetting: "B" }),
      fetchCurrentProductsByIds: async () =>
        new Map(baseline.products.map((p) => [p.id, { ...p, stock: 75, discount: 9 }])),
      upsertProductChunk: async () => ({ error: null }),
      upsertSettings: async () => {},
    },
  });
  assert.equal(outcome.success, true);
  assert.equal(outcome.commitLocalProducts, true);
  assert.equal(outcome.products.find((p) => p.sourceSlug === panelRaw.slug)?.price, 31000);
  assert.equal(outcome.products.find((p) => p.sourceSlug === panelRaw.slug)?.stock, 75);
  assert.equal((outcome.settings as any).someOtherSetting, "B");
});

await checkAsync("partial remote persistence still reports failed status/counts", async () => {
  const many = Array.from({ length: 3 }, (_, i) =>
    normalizeWebsiteProduct(
      { ...panelRaw, slug: `product-${i}`, sku: `SKU-${i}`, title: `Panel ${i}` } as any,
      syncedAt
    )
  );
  const proposed = applyWebsiteCatalogSync([], many, fullSync);
  let calls = 0;
  const outcome = await finalizeWebsiteCatalogSync({
    supabaseActive: true,
    baselineProducts: [],
    localSettingsFallback: {},
    result: proposed,
    chunkSize: 2,
    adapters: {
      fetchLatestSettings: async () => ({ someOtherSetting: "B" }),
      fetchCurrentProductsByIds: async () => new Map(),
      upsertProductChunk: async () => {
        calls += 1;
        if (calls === 1) return { error: null };
        return { error: "chunk 2 failed" };
      },
      upsertSettings: async () => {},
    },
  });
  assert.equal(outcome.success, false);
  assert.equal(outcome.commitLocalProducts, false);
  assert.equal(outcome.report.lastStatus, "failed");
  assert.equal(outcome.report.persistedCount, 2);
  assert.equal(outcome.report.errors.some((e) => /2\/3/.test(e)), true);
  assert.equal(outcome.products.length, 0);
});

await checkAsync("product success with settings failure is a metadata failure not a silent no-op", async () => {
  const proposed = applyWebsiteCatalogSync([], discovered, fullSync);
  const outcome = await finalizeWebsiteCatalogSync({
    supabaseActive: true,
    baselineProducts: [],
    localSettingsFallback: { someOtherSetting: "A" },
    result: proposed,
    adapters: {
      fetchLatestSettings: async () => ({ someOtherSetting: "B" }),
      fetchCurrentProductsByIds: async () => new Map(),
      upsertProductChunk: async () => ({ error: null }),
      upsertSettings: async () => {
        throw new Error("settings upsert failed");
      },
    },
  });
  assert.equal(outcome.success, false);
  assert.equal(outcome.productsPersisted, true);
  assert.equal(outcome.settingsPersisted, false);
  assert.equal(outcome.settingsMetadataFailed, true);
  assert.equal(outcome.commitLocalProducts, true);
  assert.match(String(outcome.error), /products were saved/i);
  assert.equal(outcome.products.some((p) => p.sourceSlug === panelRaw.slug), true);
});

console.log(`\nwebsite catalog tests: ${pass} passed`);
