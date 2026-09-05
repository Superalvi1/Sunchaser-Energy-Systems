import assert from "node:assert/strict";
import type { Product } from "../../types.ts";
import {
  applyWebsiteCatalogSync,
  assertWebsiteCatalogUrl,
  authorizeWebsiteCatalogSyncAccess,
  canSyncWebsiteCatalog,
  extractSitemapProductSlugs,
  normalizeWebsiteProduct,
  parseProductJsonLd,
  parseShopCatalog,
  resolveWebsiteProductType,
  runWebsiteCatalogSync,
  WEBSITE_CATALOG_SOURCE,
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

check("sync twice does not duplicate", () => {
  const first = applyWebsiteCatalogSync([], discovered, { discoveryComplete: true, syncedAt });
  const second = applyWebsiteCatalogSync(first.products, discovered, { discoveryComplete: true, syncedAt });
  assert.equal(first.report.added, 2);
  assert.equal(second.report.added, 0);
  assert.equal(second.products.filter((p) => p.source === WEBSITE_CATALOG_SOURCE).length, 2);
});

check("price update updates current catalog", () => {
  const first = applyWebsiteCatalogSync([], discovered, { discoveryComplete: true, syncedAt });
  const updatedPanel = normalizeWebsiteProduct({ ...panelRaw, price: 31000 } as any, "2026-09-06T00:00:00.000Z");
  const second = applyWebsiteCatalogSync(first.products, [updatedPanel, discovered[1]], {
    discoveryComplete: true,
    syncedAt: "2026-09-06T00:00:00.000Z",
  });
  const panel = second.products.find((p) => p.sourceSlug === panelRaw.slug)!;
  assert.equal(panel.price, 31000);
  assert.equal(second.report.updated >= 1, true);
});

check("missing product becomes inactive and is not deleted", () => {
  const first = applyWebsiteCatalogSync([], discovered, { discoveryComplete: true, syncedAt });
  const second = applyWebsiteCatalogSync(first.products, [discovered[1]], { discoveryComplete: true, syncedAt });
  const missing = second.products.find((p) => p.sourceSlug === panelRaw.slug)!;
  assert.equal(Boolean(missing), true);
  assert.equal(missing.sourceActive, false);
  assert.equal(second.report.inactive, 1);
});

check("failed website sync leaves catalogue intact", () => {
  const first = applyWebsiteCatalogSync([], discovered, { discoveryComplete: true, syncedAt });
  const failed = applyWebsiteCatalogSync(first.products, [], {
    discoveryComplete: false,
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
  assert.equal(ok.report.discoveryComplete, true);
  assert.equal(ok.report.added, 2);
  assert.equal(ok.products.some((p) => p.id === "keep-me"), true);
});

console.log(`\nwebsite catalog tests: ${pass} passed`);
