/**
 * WS1 public catalogue repository contract tests (no Docker).
 * Mocks the Supabase client to verify v2 RPC-only access, DTO mapping,
 * fail-closed response validation, media URL defence in the RPC DTO mapping
 * path, and the public price policy.
 *
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/marketplace/catalogue/catalogueRepository.test.ts
 */
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseCatalogueRepository,
  CatalogueRepositoryError,
} from "./catalogueRepository.ts";
import type {
  CatalogueDefaultVariantDto,
  CatalogueProductDto,
} from "./catalogueTypes.ts";

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

const VALID_PRODUCT: CatalogueProductDto = {
  slug: "knox-krypton-eco-6-2kw-hybrid",
  title: "Knox Krypton Eco 6.2KW IP-21 PV6600 Hybrid Solar Inverter",
  description: "Test description.",
  shortDescription: null,
  model: null,
  brand: { slug: "knox", name: "Knox" },
  category: {
    slug: "solar-inverters",
    name: "Solar Inverters",
    description: null,
    sortOrder: 1,
  },
  tags: ["knox", "hybrid"],
  featured: true,
  specifications: { Power: "6.2KW" },
  warranty: "2 Years Official Warranty",
  seoTitle: null,
  seoDescription: null,
  datasheetUrl: null,
  image: null,
  images: [],
  defaultVariant: {
    sku: "SC-KNOX_KRYPTON_ECO_6_2KW_HYBRID",
    title: "Default",
    isDefault: true,
    websitePrice: 111000,
    websitePriceState: "priced_auto",
    websitePriceSource: "seed",
    stockStatus: "unknown",
  },
};

const V2_RPCS = new Set([
  "mp_public_catalogue_list_v2",
  "mp_public_catalogue_get_by_slug_v2",
  "mp_public_catalogue_categories_v2",
  "mp_public_catalogue_brands_v2",
]);

function buildMockClient(
  rpcHandler: (name: string, args: Record<string, unknown>) => unknown,
): SupabaseClient {
  return {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      const result = rpcHandler(name, args ?? {});
      return result as ReturnType<SupabaseClient["rpc"]>;
    },
    from: () => {
      throw new Error("Direct table reads are not allowed");
    },
  } as unknown as SupabaseClient;
}

function repoWithRows(rows: unknown) {
  return createSupabaseCatalogueRepository(
    () => buildMockClient(() => ({ data: rows, error: null })),
    () => true,
  );
}

function productWithVariant(
  overrides: Partial<CatalogueDefaultVariantDto>,
): CatalogueProductDto {
  return {
    ...VALID_PRODUCT,
    defaultVariant: { ...VALID_PRODUCT.defaultVariant, ...overrides },
  };
}

function productWithMedia(
  image: string | null,
  images: string[],
): CatalogueProductDto {
  return { ...VALID_PRODUCT, image, images };
}

async function expectErrorCode(
  name: string,
  code: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
    check(name, false);
  } catch (err) {
    check(
      name,
      err instanceof CatalogueRepositoryError && err.code === code,
    );
  }
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  // listProducts: v2 RPC call shape, mapping, pagination
  // ---------------------------------------------------------------------------
  {
    let capturedName: string | null = null;
    let capturedArgs: Record<string, unknown> | null = null;
    const repo = createSupabaseCatalogueRepository(
      () =>
        buildMockClient((name, args) => {
          capturedName = name;
          capturedArgs = args;
          return {
            data: [{ product: VALID_PRODUCT, total: 1 }],
            error: null,
          };
        }),
      () => true,
    );

    const page = await repo.listProducts({
      category: "solar-inverters",
      brand: "knox",
      featured: true,
      limit: 10,
      offset: 5,
    });

    check("listProducts calls mp_public_catalogue_list_v2", capturedName === "mp_public_catalogue_list_v2");
    check("listProducts passes category slug", capturedArgs?.p_category_slug === "solar-inverters");
    check("listProducts passes brand slug", capturedArgs?.p_brand_slug === "knox");
    check("listProducts passes featured flag", capturedArgs?.p_featured_only === true);
    check("listProducts passes bounded limit", capturedArgs?.p_limit === 10);
    check("listProducts passes offset", capturedArgs?.p_offset === 5);
    check("listProducts maps DTO", page.items.length === 1);
    check("listProducts preserves slug", page.items[0]?.slug === VALID_PRODUCT.slug);
    check("listProducts preserves total", page.total === 1);
    check("listProducts preserves limit", page.limit === 10);
    check("listProducts preserves offset", page.offset === 5);
    check("listProducts defaultVariant isDefault true", page.items[0]?.defaultVariant.isDefault === true);
    check("listProducts no media returns null/empty", page.items[0]?.image === null && page.items[0]?.images.length === 0);
  }

  // ---------------------------------------------------------------------------
  // listProducts: empty page sentinel still returns total
  // ---------------------------------------------------------------------------
  {
    const repo = repoWithRows([{ product: null, total: 42 }]);
    const page = await repo.listProducts({ limit: 10, offset: 100 });
    check("empty page has zero items", page.items.length === 0);
    check("empty page preserves total", page.total === 42);
  }

  // ---------------------------------------------------------------------------
  // Fail closed: malformed product payloads throw (never silently dropped)
  // ---------------------------------------------------------------------------
  {
    const badProduct = {
      ...VALID_PRODUCT,
      defaultVariant: { ...VALID_PRODUCT.defaultVariant, isDefault: false },
    };
    const repo = repoWithRows([{ product: badProduct, total: 1 }]);
    await expectErrorCode(
      "malformed product throws CATALOGUE_RESPONSE_INVALID",
      "CATALOGUE_RESPONSE_INVALID",
      () => repo.listProducts({}),
    );
  }

  // ---------------------------------------------------------------------------
  // Fail closed: invalid totals
  // ---------------------------------------------------------------------------
  {
    await expectErrorCode(
      "non-numeric total throws CATALOGUE_RESPONSE_INVALID",
      "CATALOGUE_RESPONSE_INVALID",
      () => repoWithRows([{ product: VALID_PRODUCT, total: "42" }]).listProducts({}),
    );
    await expectErrorCode(
      "negative total throws CATALOGUE_RESPONSE_INVALID",
      "CATALOGUE_RESPONSE_INVALID",
      () => repoWithRows([{ product: VALID_PRODUCT, total: -1 }]).listProducts({}),
    );
    await expectErrorCode(
      "fractional total throws CATALOGUE_RESPONSE_INVALID",
      "CATALOGUE_RESPONSE_INVALID",
      () => repoWithRows([{ product: VALID_PRODUCT, total: 1.5 }]).listProducts({}),
    );
    await expectErrorCode(
      "NaN total throws CATALOGUE_RESPONSE_INVALID",
      "CATALOGUE_RESPONSE_INVALID",
      () => repoWithRows([{ product: VALID_PRODUCT, total: Number.NaN }]).listProducts({}),
    );
  }

  // ---------------------------------------------------------------------------
  // Fail closed: row shape and response shape
  // ---------------------------------------------------------------------------
  {
    await expectErrorCode(
      "row without total throws CATALOGUE_RESPONSE_INVALID",
      "CATALOGUE_RESPONSE_INVALID",
      () => repoWithRows([{ product: VALID_PRODUCT }]).listProducts({}),
    );
    await expectErrorCode(
      "non-object row throws CATALOGUE_RESPONSE_INVALID",
      "CATALOGUE_RESPONSE_INVALID",
      () => repoWithRows(["junk"]).listProducts({}),
    );
    await expectErrorCode(
      "non-array RPC response throws CATALOGUE_RESPONSE_INVALID",
      "CATALOGUE_RESPONSE_INVALID",
      () => repoWithRows({ product: VALID_PRODUCT }).listProducts({}),
    );
    await expectErrorCode(
      "total smaller than item count throws CATALOGUE_RESPONSE_INVALID",
      "CATALOGUE_RESPONSE_INVALID",
      () =>
        repoWithRows([
          { product: { ...VALID_PRODUCT, slug: "aaa", title: "Aaa" }, total: 1 },
          { product: { ...VALID_PRODUCT, slug: "bbb", title: "Bbb" }, total: 1 },
        ]).listProducts({}),
    );
  }

  // ---------------------------------------------------------------------------
  // listProducts: RPC transport error surfaces as controlled error
  // ---------------------------------------------------------------------------
  {
    const repo = createSupabaseCatalogueRepository(
      () => buildMockClient(() => ({ data: null, error: { message: "db down" } })),
      () => true,
    );
    await expectErrorCode(
      "database error code is CATALOGUE_QUERY_FAILED",
      "CATALOGUE_QUERY_FAILED",
      () => repo.listProducts({}),
    );
  }

  // ---------------------------------------------------------------------------
  // getProductBySlug: v2 RPC, exact lookup, unknown slug, transport error
  // ---------------------------------------------------------------------------
  {
    let capturedName: string | null = null;
    let capturedArgs: Record<string, unknown> | null = null;
    const repo = createSupabaseCatalogueRepository(
      () =>
        buildMockClient((name, args) => {
          capturedName = name;
          capturedArgs = args;
          return { data: [{ product: VALID_PRODUCT }], error: null };
        }),
      () => true,
    );
    const product = await repo.getProductBySlug(VALID_PRODUCT.slug);
    check("getProductBySlug calls mp_public_catalogue_get_by_slug_v2", capturedName === "mp_public_catalogue_get_by_slug_v2");
    check("getProductBySlug passes slug", capturedArgs?.p_slug === VALID_PRODUCT.slug);
    check("getProductBySlug maps DTO", product?.slug === VALID_PRODUCT.slug);
  }

  {
    const repo = repoWithRows([]);
    const product = await repo.getProductBySlug("does-not-exist");
    check("unknown slug returns null", product === null);
  }

  {
    await expectErrorCode(
      "slug row shape invalid throws CATALOGUE_RESPONSE_INVALID",
      "CATALOGUE_RESPONSE_INVALID",
      () => repoWithRows([{ wrong: true }]).getProductBySlug("any"),
    );
    await expectErrorCode(
      "slug malformed product throws CATALOGUE_RESPONSE_INVALID",
      "CATALOGUE_RESPONSE_INVALID",
      () =>
        repoWithRows([
          { product: { ...VALID_PRODUCT, title: "" } },
        ]).getProductBySlug("any"),
    );
    const repo = createSupabaseCatalogueRepository(
      () => buildMockClient(() => ({ data: null, error: { message: "db down" } })),
      () => true,
    );
    await expectErrorCode(
      "slug database error code is CATALOGUE_QUERY_FAILED",
      "CATALOGUE_QUERY_FAILED",
      () => repo.getProductBySlug(VALID_PRODUCT.slug),
    );
  }

  // ---------------------------------------------------------------------------
  // categories / brands: v2 RPCs, mapping, fail-closed shape validation
  // ---------------------------------------------------------------------------
  {
    let capturedName: string | null = null;
    const repo = createSupabaseCatalogueRepository(
      () =>
        buildMockClient((name) => {
          capturedName = name;
          return {
            data: [
              {
                category: {
                  slug: "solar-inverters",
                  name: "Solar Inverters",
                  description: null,
                  sortOrder: 1,
                },
              },
            ],
            error: null,
          };
        }),
      () => true,
    );
    const cats = await repo.listCategories();
    check("listCategories calls mp_public_catalogue_categories_v2", capturedName === "mp_public_catalogue_categories_v2");
    check("listCategories maps DTO", cats.length === 1 && cats[0]?.slug === "solar-inverters");

    await expectErrorCode(
      "category row shape invalid throws CATALOGUE_RESPONSE_INVALID",
      "CATALOGUE_RESPONSE_INVALID",
      () => repoWithRows([{ wrong: true }]).listCategories(),
    );
    await expectErrorCode(
      "category DTO invalid throws CATALOGUE_RESPONSE_INVALID",
      "CATALOGUE_RESPONSE_INVALID",
      () =>
        repoWithRows([
          { category: { slug: "", name: "Bad", description: null, sortOrder: 1 } },
        ]).listCategories(),
    );
    await expectErrorCode(
      "categories non-array throws CATALOGUE_RESPONSE_INVALID",
      "CATALOGUE_RESPONSE_INVALID",
      () => repoWithRows({}).listCategories(),
    );
  }

  {
    let capturedName: string | null = null;
    const repo = createSupabaseCatalogueRepository(
      () =>
        buildMockClient((name) => {
          capturedName = name;
          return {
            data: [{ brand: { slug: "knox", name: "Knox" } }],
            error: null,
          };
        }),
      () => true,
    );
    const brands = await repo.listBrands();
    check("listBrands calls mp_public_catalogue_brands_v2", capturedName === "mp_public_catalogue_brands_v2");
    check("listBrands maps DTO", brands.length === 1 && brands[0]?.slug === "knox");

    await expectErrorCode(
      "brand row shape invalid throws CATALOGUE_RESPONSE_INVALID",
      "CATALOGUE_RESPONSE_INVALID",
      () => repoWithRows([{ wrong: true }]).listBrands(),
    );
    await expectErrorCode(
      "brand DTO invalid throws CATALOGUE_RESPONSE_INVALID",
      "CATALOGUE_RESPONSE_INVALID",
      () => repoWithRows([{ brand: { slug: "", name: "" } }]).listBrands(),
    );
  }

  // ---------------------------------------------------------------------------
  // Pagination bounds: repository does not request more than RPC page size
  // ---------------------------------------------------------------------------
  {
    const calls: Array<{ limit: number; offset: number }> = [];
    const repo = createSupabaseCatalogueRepository(
      () =>
        buildMockClient((_name, args) => {
          calls.push({ limit: args.p_limit as number, offset: args.p_offset as number });
          return {
            data: [{ product: VALID_PRODUCT, total: 1 }],
            error: null,
          };
        }),
      () => true,
    );
    await repo.listProducts({ limit: 1200, offset: 0 });
    check("large caller limit is capped to RPC page size", calls[0]?.limit === 500);
    check("first page offset is zero", calls[0]?.offset === 0);
  }

  // ---------------------------------------------------------------------------
  // Stable ordering: repository preserves RPC order
  // ---------------------------------------------------------------------------
  {
    const ordered: CatalogueProductDto[] = [
      { ...VALID_PRODUCT, slug: "aaa-product", title: "Aaa Product" },
      { ...VALID_PRODUCT, slug: "bbb-product", title: "Bbb Product" },
    ];
    const repo = repoWithRows(ordered.map((p) => ({ product: p, total: 2 })));
    const page = await repo.listProducts({});
    check("repository preserves RPC ordering", page.items[0]?.slug === "aaa-product" && page.items[1]?.slug === "bbb-product");
  }

  // ---------------------------------------------------------------------------
  // No confidential fields
  // ---------------------------------------------------------------------------
  {
    const leakyProduct = {
      ...VALID_PRODUCT,
      defaultVariant: {
        ...VALID_PRODUCT.defaultVariant,
        actual_purchase_cost: 50000,
      },
    };
    const repo = repoWithRows([{ product: leakyProduct, total: 1 }]);
    await expectErrorCode(
      "confidential field error code is CATALOGUE_DTO_LEAK",
      "CATALOGUE_DTO_LEAK",
      () => repo.listProducts({}),
    );
  }

  // ---------------------------------------------------------------------------
  // Database mode uses only the four v2 public RPCs
  // ---------------------------------------------------------------------------
  {
    const repo = createSupabaseCatalogueRepository(
      () =>
        buildMockClient((name) => {
          if (!V2_RPCS.has(name)) {
            throw new Error(`Unexpected RPC call: ${name}`);
          }
          if (name === "mp_public_catalogue_categories_v2") {
            return { data: [], error: null };
          }
          if (name === "mp_public_catalogue_brands_v2") {
            return { data: [], error: null };
          }
          return { data: [], error: null };
        }),
      () => true,
    );
    await repo.listProducts({});
    await repo.getProductBySlug("any");
    await repo.listCategories();
    await repo.listBrands();
    check("database mode uses only v2 public RPCs", true);
  }

  // ---------------------------------------------------------------------------
  // Media defence in the actual RPC DTO mapping path
  // (row-level gates — approver/approval timestamp/receipt/unpublished — are
  //  enforced inside the v2 SQL and asserted by catalogueSqlContract.test.ts)
  // ---------------------------------------------------------------------------
  {
    const mediaCase = async (product: CatalogueProductDto) => {
      const page = await repoWithRows([{ product, total: 1 }]).listProducts({});
      return page.items[0];
    };

    const http = await mediaCase(productWithMedia("http://cdn.shopify.com/img.jpg", []));
    check("RPC media: HTTP URL is removed", http?.image === null && http?.images.length === 0);

    const malicious = await mediaCase(productWithMedia("https://evil.com/img.jpg", []));
    check("RPC media: malicious hostname is removed", malicious?.image === null);

    const deceptive = await mediaCase(
      productWithMedia("https://cdn.shopify.com.evil.com/img.jpg", []),
    );
    check("RPC media: deceptive hostname suffix is removed", deceptive?.image === null);

    const invalid = await mediaCase(productWithMedia("not a valid url", []));
    check("RPC media: invalid URL is removed", invalid?.image === null);

    const absent = await mediaCase(productWithMedia(null, []));
    check("RPC media: null URL stays null/empty", absent?.image === null && absent?.images.length === 0);

    const approved = await mediaCase(
      productWithMedia("https://cdn.shopify.com/s/files/primary.jpg", []),
    );
    check(
      "RPC media: approved allowlisted URL is preserved",
      approved?.image === "https://cdn.shopify.com/s/files/primary.jpg",
    );

    const gallery = await mediaCase(
      productWithMedia("https://cdn.shopify.com/a.jpg", [
        "https://kamalsolar.pk/b.jpg",
        "https://evil.com/c.jpg",
      ]),
    );
    check(
      "RPC media: gallery keeps only allowlisted URLs in order",
      gallery?.image === "https://cdn.shopify.com/a.jpg" &&
        gallery?.images.length === 1 &&
        gallery?.images[0] === "https://kamalsolar.pk/b.jpg",
    );
  }

  // ---------------------------------------------------------------------------
  // Public price policy matrix (RPC DTO mapping path)
  // ---------------------------------------------------------------------------
  {
    const priceCase = async (overrides: Partial<CatalogueDefaultVariantDto>) => {
      const page = await repoWithRows([
        { product: productWithVariant(overrides), total: 1 },
      ]).listProducts({});
      return page.items[0]?.defaultVariant;
    };

    const inStockAuto = await priceCase({
      websitePrice: 111000,
      websitePriceState: "priced_auto",
      stockStatus: "in_stock",
    });
    check("price matrix: in_stock + priced_auto exposes price", inStockAuto?.websitePrice === 111000);

    const inStockOverride = await priceCase({
      websitePrice: 222000,
      websitePriceState: "priced_override",
      stockStatus: "in_stock",
    });
    check("price matrix: in_stock + priced_override exposes price", inStockOverride?.websitePrice === 222000);

    const unknownStock = await priceCase({
      websitePrice: 111000,
      websitePriceState: "priced_auto",
      stockStatus: "unknown",
    });
    check("price matrix: unknown stock hides price", unknownStock?.websitePrice === null);

    const soldOut = await priceCase({
      websitePrice: 111000,
      websitePriceState: "priced_auto",
      stockStatus: "sold_out",
    });
    check("price matrix: sold_out hides price", soldOut?.websitePrice === null);

    const backorder = await priceCase({
      websitePrice: 111000,
      websitePriceState: "priced_override",
      stockStatus: "backorder",
    });
    check("price matrix: backorder hides price", backorder?.websitePrice === null);

    const confirm = await priceCase({
      websitePrice: 111000,
      websitePriceState: "confirm_price",
      stockStatus: "in_stock",
    });
    check(
      "price matrix: confirm_price hides price but preserves state",
      confirm?.websitePrice === null && confirm?.websitePriceState === "confirm_price",
    );

    const nullPrice = await priceCase({
      websitePrice: null,
      websitePriceState: "priced_auto",
      stockStatus: "in_stock",
    });
    check("price matrix: null price stays null", nullPrice?.websitePrice === null);

    const zeroPrice = await priceCase({
      websitePrice: 0,
      websitePriceState: "priced_auto",
      stockStatus: "in_stock",
    });
    check("price matrix: zero price is hidden", zeroPrice?.websitePrice === null);

    const negativePrice = await priceCase({
      websitePrice: -5,
      websitePriceState: "priced_auto",
      stockStatus: "in_stock",
    });
    check("price matrix: negative price is hidden", negativePrice?.websitePrice === null);
  }

  console.log("catalogueRepository.test.ts: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
