import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../../dbManager.ts";
import {
  loadActiveOverrides,
  mapBrandDto,
  mapCategoryDto,
  mapProductDto,
  type BrandRow,
  type CategoryRow,
  type ProductRow,
} from "./catalogueMapper.ts";
import type {
  CatalogueBrandDto,
  CatalogueCategoryDto,
  CatalogueListFilters,
  CatalogueProductDto,
} from "./catalogueTypes.ts";

export class CatalogueRepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type CatalogueRepository = {
  listCategories(): Promise<CatalogueCategoryDto[]>;
  listBrands(): Promise<CatalogueBrandDto[]>;
  listProducts(filters: CatalogueListFilters): Promise<CatalogueProductDto[]>;
  getProductBySlug(slug: string): Promise<CatalogueProductDto | null>;
};

const PRODUCT_SELECT = `
  slug,
  title,
  description,
  tags,
  featured,
  specifications,
  warranty,
  public_visible,
  short_description,
  model,
  seo_title,
  seo_description,
  datasheet_url,
  brand:mp_brands!brand_id (
    slug,
    name,
    active
  ),
  category:mp_categories!category_id (
    slug,
    name,
    description,
    sort_order,
    active
  ),
  variants:mp_product_variants!product_id (
    sku,
    title,
    is_default,
    website_price,
    website_price_state,
    website_price_source,
    stock_status,
    active,
    compare_at_price
  ),
  media:mp_media!product_id (
    source_url,
    sort_order,
    role,
    published,
    rights_status,
    source_type
  ),
  field_overrides:mp_field_overrides!product_id (
    field_name,
    override_value,
    active
  )
`;

function assertNoForbiddenKeys(payload: unknown): void {
  const forbidden = [
    "actual_purchase_cost",
    "actualPurchaseCost",
    "delivery_charge",
    "deliveryCharge",
    "delivery_fee",
    "deliveryFee",
    "margin",
    "supplier_public_price",
    "supplierPublicPrice",
    "service_role",
  ];
  const text = JSON.stringify(payload);
  for (const key of forbidden) {
    if (text.includes(`"${key}"`)) {
      throw new CatalogueRepositoryError(
        "CATALOGUE_DTO_LEAK",
        "Catalogue payload failed safety validation.",
      );
    }
  }
}

/**
 * For every row with an active brand_id or category_id override, batch-fetch
 * the referenced brand/category records and set resolvedOverrideBrand /
 * resolvedOverrideCategory so mapProductDto can use the correct slug + name.
 *
 * This is the only DB call in the public catalogue that isn't covered by the
 * product SELECT — one extra round-trip per page, not per product.
 */
async function resolveOverrideBrandsCategories(
  rows: ProductRow[],
  supabase: SupabaseClient,
): Promise<ProductRow[]> {
  const overrideBrandIds = new Set<string>();
  const overrideCategoryIds = new Set<string>();

  for (const row of rows) {
    const ovRows = Array.isArray(row.field_overrides)
      ? row.field_overrides
      : row.field_overrides
        ? [row.field_overrides]
        : [];
    const ov = loadActiveOverrides(ovRows);
    const bid = ov.get("brand_id");
    const cid = ov.get("category_id");
    if (typeof bid === "string" && bid) overrideBrandIds.add(bid);
    if (typeof cid === "string" && cid) overrideCategoryIds.add(cid);
  }

  const brandCache = new Map<string, BrandRow>();
  const categoryCache = new Map<string, CategoryRow>();

  if (overrideBrandIds.size > 0) {
    const { data: brands, error: brandErr } = await supabase
      .from("mp_brands")
      .select("id, slug, name, active")
      .in("id", [...overrideBrandIds]);
    // Fail-closed: if the lookup errors, do NOT silently fall back to
    // the supplier brand/category. Throw so the API returns an error.
    if (brandErr) {
      throw new CatalogueRepositoryError(
        "CATALOGUE_OVERRIDE_TAXONOMY_ERROR",
        "Unable to resolve overridden brand records.",
      );
    }
    for (const b of (brands ?? []) as Array<BrandRow & { id: string }>) {
      brandCache.set(b.id, b);
    }
  }
  if (overrideCategoryIds.size > 0) {
    const { data: cats, error: catErr } = await supabase
      .from("mp_categories")
      .select("id, slug, name, description, sort_order, active")
      .in("id", [...overrideCategoryIds]);
    if (catErr) {
      throw new CatalogueRepositoryError(
        "CATALOGUE_OVERRIDE_TAXONOMY_ERROR",
        "Unable to resolve overridden category records.",
      );
    }
    for (const c of (cats ?? []) as Array<CategoryRow & { id: string }>) {
      categoryCache.set(c.id, c);
    }
  }

  return rows.map((row) => {
    const ovRows = Array.isArray(row.field_overrides)
      ? row.field_overrides
      : row.field_overrides
        ? [row.field_overrides]
        : [];
    const ov = loadActiveOverrides(ovRows);
    const bid = ov.get("brand_id") as string | undefined;
    const cid = ov.get("category_id") as string | undefined;
    return {
      ...row,
      resolvedOverrideBrand: (bid && brandCache.has(bid)) ? brandCache.get(bid)! : null,
      resolvedOverrideCategory: (cid && categoryCache.has(cid)) ? categoryCache.get(cid)! : null,
    };
  });
}

export function createSupabaseCatalogueRepository(
  clientFactory: () => SupabaseClient | null = getSupabase,
): CatalogueRepository {
  function requireClient(): SupabaseClient {
    if (!isSupabaseActive()) {
      throw new CatalogueRepositoryError(
        "CATALOGUE_UNAVAILABLE",
        "Catalogue database is unavailable.",
      );
    }
    const client = clientFactory();
    if (!client) {
      throw new CatalogueRepositoryError(
        "CATALOGUE_UNAVAILABLE",
        "Catalogue database is unavailable.",
      );
    }
    return client;
  }

  return {
    async listCategories(): Promise<CatalogueCategoryDto[]> {
      const supabase = requireClient();
      const { data, error } = await supabase
        .from("mp_categories")
        .select("slug, name, description, sort_order, active")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (error) {
        throw new CatalogueRepositoryError(
          "CATALOGUE_QUERY_FAILED",
          "Unable to load catalogue categories.",
        );
      }
      const rows = (data || []) as CategoryRow[];
      const mapped = rows.map(mapCategoryDto);
      assertNoForbiddenKeys(mapped);
      return mapped;
    },

    async listBrands(): Promise<CatalogueBrandDto[]> {
      const supabase = requireClient();
      const { data, error } = await supabase
        .from("mp_brands")
        .select("slug, name, active")
        .eq("active", true)
        .order("name", { ascending: true });
      if (error) {
        throw new CatalogueRepositoryError(
          "CATALOGUE_QUERY_FAILED",
          "Unable to load catalogue brands.",
        );
      }
      const rows = (data || []) as BrandRow[];
      const mapped = rows.map(mapBrandDto);
      assertNoForbiddenKeys(mapped);
      return mapped;
    },

    async listProducts(filters: CatalogueListFilters): Promise<CatalogueProductDto[]> {
      const supabase = requireClient();

      // Use the public-safe RPC for bounded server-side pagination.
      // This bypasses Supabase's implicit 1000-row response cap and
      // filters on EFFECTIVE values (override-aware), not base columns.
      // The RPC never returns hidden/inactive products.
      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        "mp_public_catalogue_list",
        {
          p_limit: 500,
          p_offset: 0,
          p_featured: filters.featured ?? null,
          p_brand_slug: filters.brand ?? null,
          p_category_slug: filters.category ?? null,
        },
      );
      if (rpcErr) {
        throw new CatalogueRepositoryError(
          "CATALOGUE_QUERY_FAILED",
          "Unable to load catalogue products.",
        );
      }

      const rpcRows = (rpcData ?? []) as Array<{ slug: string; total: number }>;
      const slugs = rpcRows.map((r) => r.slug);

      if (slugs.length === 0) return [];

      // Fetch full product data for the paginated slugs.
      const { data: prodData, error: prodErr } = await supabase
        .from("mp_products")
        .select(PRODUCT_SELECT)
        .eq("active", true)
        .in("slug", slugs);
      if (prodErr) {
        throw new CatalogueRepositoryError(
          "CATALOGUE_QUERY_FAILED",
          "Unable to load catalogue products.",
        );
      }

      // Resolve override brands/categories in one batch query.
      const annotated = await resolveOverrideBrandsCategories(
        (prodData ?? []) as ProductRow[],
        supabase,
      );

      // Map to DTOs in the RPC's deterministic order.
      const rowBySlug = new Map(annotated.map((r) => [r.slug, r]));
      const mapped: CatalogueProductDto[] = [];
      for (const slug of slugs) {
        const row = rowBySlug.get(slug);
        if (!row) continue;
        const dto = mapProductDto(row);
        if (dto) mapped.push(dto);
      }

      assertNoForbiddenKeys(mapped);
      return mapped;
    },

    async getProductBySlug(slug: string): Promise<CatalogueProductDto | null> {
      const supabase = requireClient();
      const { data, error } = await supabase
        .from("mp_products")
        .select(PRODUCT_SELECT)
        .eq("active", true)
        .eq("slug", slug)
        .maybeSingle();
      if (error) {
        throw new CatalogueRepositoryError(
          "CATALOGUE_QUERY_FAILED",
          "Unable to load catalogue product.",
        );
      }
      if (!data) return null;
      // Resolve override brand/category for this single product.
      const [annotatedRow] = await resolveOverrideBrandsCategories(
        [data as ProductRow],
        supabase,
      );
      const mapped = mapProductDto(annotatedRow);
      if (mapped) assertNoForbiddenKeys(mapped);
      return mapped;
    },
  };
}
