import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../../dbManager.ts";
import {
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
      let query = supabase
        .from("mp_products")
        .select(PRODUCT_SELECT)
        .eq("active", true)
        .order("title", { ascending: true });

      if (filters.featured !== undefined) {
        query = query.eq("featured", filters.featured);
      }

      const { data, error } = await query;
      if (error) {
        throw new CatalogueRepositoryError(
          "CATALOGUE_QUERY_FAILED",
          "Unable to load catalogue products.",
        );
      }

      // Category/brand filters applied in-process (catalogue is small; avoids fragile nested filters).
      const mapped = ((data || []) as ProductRow[])
        .map(mapProductDto)
        .filter((p): p is CatalogueProductDto => p !== null)
        .filter((p) => {
          if (filters.category && p.category.slug !== filters.category) return false;
          if (filters.brand && p.brand.slug !== filters.brand) return false;
          return true;
        });
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
      const mapped = mapProductDto(data as ProductRow);
      if (mapped) assertNoForbiddenKeys(mapped);
      return mapped;
    },
  };
}
