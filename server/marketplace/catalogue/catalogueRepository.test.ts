/**
 * WS1 public catalogue repository contract tests (no Docker).
 * Mocks the Supabase client to verify RPC-only access, DTO mapping,
 * defensive validation, and media semantics.
 *
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/marketplace/catalogue/catalogueRepository.test.ts
 */
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseCatalogueRepository,
  CatalogueRepositoryError,
} from "./catalogueRepository.ts";
import type { CatalogueProductDto } from "./catalogueTypes.ts";
import { mapPublishedImageUrls } from "./catalogueMapper.ts";

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

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  // listProducts: full response mapping and pagination
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

    check("listProducts calls mp_public_catalogue_list", capturedName === "mp_public_catalogue_list");
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
  // listProducts: empty page still returns total
  // ---------------------------------------------------------------------------
  {
    const repo = createSupabaseCatalogueRepository(
      () =>
        buildMockClient(() => ({
          data: [{ product: null, total: 42 }],
          error: null,
        })),
      () => true,
    );
    const page = await repo.listProducts({ limit: 10, offset: 100 });
    check("empty page has zero items", page.items.length === 0);
    check("empty page preserves total", page.total === 42);
  }

  // ---------------------------------------------------------------------------
  // listProducts: invalid payload is rejected
  // ---------------------------------------------------------------------------
  {
    const badProduct = { ...VALID_PRODUCT, defaultVariant: { ...VALID_PRODUCT.defaultVariant, isDefault: false } };
    const repo = createSupabaseCatalogueRepository(
      () =>
        buildMockClient(() => ({
          data: [{ product: badProduct, total: 1 }],
          error: null,
        })),
      () => true,
    );
    const page = await repo.listProducts({});
    check("invalid product payload is dropped", page.items.length === 0);
  }

  // ---------------------------------------------------------------------------
  // listProducts: RPC error is surfaced as controlled repository error
  // ---------------------------------------------------------------------------
  {
    const repo = createSupabaseCatalogueRepository(
      () =>
        buildMockClient(() => ({
          data: null,
          error: { message: "db down" },
        })),
      () => true,
    );
    try {
      await repo.listProducts({});
      check("database error throws", false);
    } catch (err) {
      check(
        "database error code is CATALOGUE_QUERY_FAILED",
        err instanceof CatalogueRepositoryError && err.code === "CATALOGUE_QUERY_FAILED",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // getProductBySlug: exact lookup and unknown slug
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
            data: [{ product: VALID_PRODUCT }],
            error: null,
          };
        }),
      () => true,
    );
    const product = await repo.getProductBySlug(VALID_PRODUCT.slug);
    check("getProductBySlug calls mp_public_catalogue_get_by_slug", capturedName === "mp_public_catalogue_get_by_slug");
    check("getProductBySlug passes slug", capturedArgs?.p_slug === VALID_PRODUCT.slug);
    check("getProductBySlug maps DTO", product?.slug === VALID_PRODUCT.slug);
  }

  {
    const repo = createSupabaseCatalogueRepository(
      () =>
        buildMockClient(() => ({
          data: [],
          error: null,
        })),
      () => true,
    );
    const product = await repo.getProductBySlug("does-not-exist");
    check("unknown slug returns null", product === null);
  }

  {
    const repo = createSupabaseCatalogueRepository(
      () =>
        buildMockClient(() => ({
          data: null,
          error: { message: "db down" },
        })),
      () => true,
    );
    try {
      await repo.getProductBySlug(VALID_PRODUCT.slug);
      check("slug database error throws", false);
    } catch (err) {
      check(
        "slug database error code is CATALOGUE_QUERY_FAILED",
        err instanceof CatalogueRepositoryError && err.code === "CATALOGUE_QUERY_FAILED",
      );
    }
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
    const repo = createSupabaseCatalogueRepository(
      () =>
        buildMockClient(() => ({
          data: ordered.map((p) => ({ product: p, total: 2 })),
          error: null,
        })),
      () => true,
    );
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
    const repo = createSupabaseCatalogueRepository(
      () =>
        buildMockClient(() => ({
          data: [{ product: leakyProduct, total: 1 }],
          error: null,
        })),
      () => true,
    );
    try {
      await repo.listProducts({});
      check("confidential field is rejected", false);
    } catch (err) {
      check(
        "confidential field error code is CATALOGUE_DTO_LEAK",
        err instanceof CatalogueRepositoryError && err.code === "CATALOGUE_DTO_LEAK",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Database mode does not use direct table reads
  // ---------------------------------------------------------------------------
  {
    const repo = createSupabaseCatalogueRepository(
      () =>
        buildMockClient((name) => {
          if (name !== "mp_public_catalogue_list" && name !== "mp_public_catalogue_get_by_slug") {
            throw new Error(`Unexpected RPC call: ${name}`);
          }
          return name === "mp_public_catalogue_list"
            ? { data: [], error: null }
            : { data: [], error: null };
        }),
      () => true,
    );
    await repo.listProducts({});
    await repo.getProductBySlug("any");
    check("database mode uses only public RPCs", true);
  }

  // ---------------------------------------------------------------------------
  // Media semantics regression
  // ---------------------------------------------------------------------------
  {
    const baseMedia = {
      source_url: "https://cdn.shopify.com/img.jpg",
      sort_order: 0,
      role: "gallery",
      published: true,
      rights_status: "supplier_approved",
      source_type: "supplier",
    };

    check(
      "unpublished media is rejected",
      mapPublishedImageUrls([{ ...baseMedia, published: false }]).image === null,
    );
    check(
      "receipt media is rejected",
      mapPublishedImageUrls([{ ...baseMedia, role: "receipt" }]).image === null,
    );
    check(
      "unapproved rights are rejected",
      mapPublishedImageUrls([{ ...baseMedia, rights_status: "pending" }]).image === null,
    );
    check(
      "invalid host is rejected",
      mapPublishedImageUrls([{ ...baseMedia, source_url: "http://evil.com/img.jpg" }]).image === null,
    );
    check(
      "absent media returns null/empty",
      mapPublishedImageUrls(null).image === null && mapPublishedImageUrls(null).images.length === 0,
    );
    check(
      "owned media is not labeled as supplier media",
      mapPublishedImageUrls([{ ...baseMedia, source_type: "own" }]).image !== null,
    );
  }

  console.log("catalogueRepository.test.ts: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
