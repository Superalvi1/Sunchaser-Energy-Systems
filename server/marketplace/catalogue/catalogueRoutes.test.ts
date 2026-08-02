/**
 * WS1 catalogue route tests (no Docker).
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/marketplace/catalogue/catalogueRoutes.test.ts
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createCatalogueRouter } from "./catalogueRoutes.ts";
import {
  WS1_SEED_CATEGORY_SLUGS,
  WS1_SEED_PRODUCTS,
} from "./catalogueSeedData.ts";
import type { CatalogueRepository } from "./catalogueRepository.ts";
import type {
  CatalogueBrandDto,
  CatalogueCategoryDto,
  CatalogueProductDto,
} from "./catalogueTypes.ts";
import { MARKETPLACE_API_VERSION_HEADER } from "./catalogueTypes.ts";

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

function buildMemoryRepo(): CatalogueRepository {
  const categories: CatalogueCategoryDto[] = WS1_SEED_CATEGORY_SLUGS.map(
    (slug, i) => ({
      slug,
      name: slug,
      description: null,
      sortOrder: i + 1,
    }),
  );
  const brands: CatalogueBrandDto[] = Array.from(
    new Map(
      WS1_SEED_PRODUCTS.map((p) => [
        p.brandSlug,
        { slug: p.brandSlug, name: p.brandName },
      ]),
    ).values(),
  );
  const products: CatalogueProductDto[] = WS1_SEED_PRODUCTS.map((p) => ({
    slug: p.slug,
    title: p.title,
    description: p.description,
    brand: { slug: p.brandSlug, name: p.brandName },
    category: {
      slug: p.categorySlug,
      name: p.categorySlug,
      description: null,
      sortOrder: 0,
    },
    tags: p.tags,
    featured: p.featured,
    specifications: { ...p.specifications },
    warranty: p.warranty,
    image: null,
    images: [],
    defaultVariant: {
      sku: p.sku,
      title: "Default",
      isDefault: true,
      websitePrice: p.websitePrice,
      websitePriceState: "priced_auto",
      websitePriceSource: "seed",
      stockStatus: "unknown",
    },
  }));

  return {
    async listCategories() {
      return categories;
    },
    async listBrands() {
      return brands;
    },
    async listProducts(filters) {
      return products.filter((p) => {
        if (filters.featured !== undefined && p.featured !== filters.featured) {
          return false;
        }
        if (filters.category && p.category.slug !== filters.category) return false;
        if (filters.brand && p.brand.slug !== filters.brand) return false;
        return true;
      });
    },
    async getProductBySlug(slug) {
      return products.find((p) => p.slug === slug) ?? null;
    },
  };
}

async function withServer(
  env: NodeJS.ProcessEnv,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(
    "/api/marketplace/catalogue",
    createCatalogueRouter({ env, repository: buildMemoryRepo() }),
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
  await withServer({ MARKETPLACE_ENABLED: "false" }, async (base) => {
    const res = await fetch(`${base}/api/marketplace/catalogue/products`);
    const body = await res.json();
    check("disabled returns HTTP 503", res.status === 503);
    check("disabled envelope ok=false", body.ok === false);
    check(
      "disabled code MARKETPLACE_DISABLED",
      body.error?.code === "MARKETPLACE_DISABLED",
    );
    check(
      "disabled includes API version header",
      res.headers.get(MARKETPLACE_API_VERSION_HEADER) === "1",
    );
  });

  await withServer({ MARKETPLACE_ENABLED: "true" }, async (base) => {
    const list = await fetch(`${base}/api/marketplace/catalogue/products`);
    const listBody = await list.json();
    check("enabled products HTTP 200", list.status === 200);
    check("enabled products ok=true", listBody.ok === true);
    check("enabled products count 30", Array.isArray(listBody.data) && listBody.data.length === 30);
    check(
      "enabled API version header",
      list.headers.get(MARKETPLACE_API_VERSION_HEADER) === "1",
    );

    const serialized = JSON.stringify(listBody.data);
    check(
      "DTO has no cost/margin/delivery fields",
      !serialized.includes("actual_purchase_cost") &&
        !serialized.includes("actualPurchaseCost") &&
        !serialized.includes("delivery_charge") &&
        !serialized.includes("deliveryCharge") &&
        !serialized.includes("delivery_fee") &&
        !serialized.includes("margin") &&
        !serialized.includes("supplier_public_price"),
    );
    check(
      "seed DTO image is null without media",
      listBody.data.every(
        (p: CatalogueProductDto) => p.image === null && Array.isArray(p.images),
      ),
    );

    const featured = await fetch(
      `${base}/api/marketplace/catalogue/products?featured=true`,
    );
    const featuredBody = await featured.json();
    check("featured filter ok", featuredBody.ok === true);
    check(
      "featured filter only featured",
      featuredBody.data.every((p: CatalogueProductDto) => p.featured === true),
    );

    const brand = await fetch(
      `${base}/api/marketplace/catalogue/products?brand=knox`,
    );
    const brandBody = await brand.json();
    check("brand filter ok", brandBody.ok === true);
    check(
      "brand filter matches",
      brandBody.data.every((p: CatalogueProductDto) => p.brand.slug === "knox"),
    );

    const category = await fetch(
      `${base}/api/marketplace/catalogue/products?category=solar-panels`,
    );
    const categoryBody = await category.json();
    check("category filter ok", categoryBody.ok === true);
    check(
      "category filter matches",
      categoryBody.data.every(
        (p: CatalogueProductDto) => p.category.slug === "solar-panels",
      ),
    );

    const detail = await fetch(
      `${base}/api/marketplace/catalogue/products/knox-krypton-eco-6-2kw-hybrid`,
    );
    const detailBody = await detail.json();
    check("detail HTTP 200", detail.status === 200);
    check("detail ok", detailBody.ok === true);
    check(
      "detail slug",
      detailBody.data?.slug === "knox-krypton-eco-6-2kw-hybrid",
    );
    check(
      "detail default variant seed fields",
      detailBody.data?.defaultVariant?.websitePriceSource === "seed" &&
        detailBody.data?.defaultVariant?.websitePriceState === "priced_auto" &&
        detailBody.data?.defaultVariant?.stockStatus === "unknown",
    );

    const missing = await fetch(
      `${base}/api/marketplace/catalogue/products/does-not-exist-product`,
    );
    const missingBody = await missing.json();
    check("unknown slug HTTP 404", missing.status === 404);
    check("unknown slug ok=false", missingBody.ok === false);
    check(
      "unknown slug code PRODUCT_NOT_FOUND",
      missingBody.error?.code === "PRODUCT_NOT_FOUND",
    );
    check(
      "unknown slug API version header",
      missing.headers.get(MARKETPLACE_API_VERSION_HEADER) === "1",
    );

    const cats = await fetch(`${base}/api/marketplace/catalogue/categories`);
    const catsBody = await cats.json();
    check("categories ok", catsBody.ok === true);
    check(
      "categories include six seed slugs",
      WS1_SEED_CATEGORY_SLUGS.every((slug) =>
        catsBody.data.some((c: CatalogueCategoryDto) => c.slug === slug),
      ),
    );

    const brandsRes = await fetch(`${base}/api/marketplace/catalogue/brands`);
    const brandsBody = await brandsRes.json();
    check("brands ok", brandsBody.ok === true);
    check("brands non-empty", brandsBody.data.length >= 15);
  });

  console.log("catalogueRoutes.test.ts: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
