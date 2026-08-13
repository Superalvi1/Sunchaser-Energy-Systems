import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../../dbManager.ts";
import type {
  CatalogueBrandDto,
  CatalogueCategoryDto,
  CatalogueDefaultVariantDto,
  CatalogueListFilters,
  CataloguePage,
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
  /**
   * Returns a paginated CataloguePage result.
   * `total` is accurate even when `items` is empty (offset beyond end).
   * When no `offset`/`limit` are supplied, iterates all RPC pages internally.
   */
  listProducts(filters: CatalogueListFilters): Promise<CataloguePage>;
  getProductBySlug(slug: string): Promise<CatalogueProductDto | null>;
};

const FORBIDDEN_KEYS = [
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

function hasForbiddenKeys(payload: unknown): boolean {
  const text = JSON.stringify(payload);
  return FORBIDDEN_KEYS.some((key) => text.includes(`"${key}"`));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isSpecMap(value: unknown): value is Record<string, string> {
  if (!isPlainObject(value)) return false;
  return Object.entries(value).every(([_, v]) => typeof v === "string");
}

function isCatalogueBrandDto(value: unknown): value is CatalogueBrandDto {
  if (!isPlainObject(value)) return false;
  return isNonEmptyString(value.slug) && isNonEmptyString(value.name);
}

function isCatalogueCategoryDto(value: unknown): value is CatalogueCategoryDto {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.slug) &&
    isNonEmptyString(value.name) &&
    isOptionalString(value.description) &&
    typeof value.sortOrder === "number"
  );
}

function isCatalogueDefaultVariantDto(
  value: unknown,
): value is CatalogueDefaultVariantDto {
  if (!isPlainObject(value)) return false;
  const validStates = ["priced_auto", "priced_override", "confirm_price"] as const;
  const validSources = [
    "kamal",
    "alladin",
    "seed",
    "override",
    "last_approved",
  ] as const;
  const validStock = ["in_stock", "sold_out", "backorder", "unknown"] as const;
  return (
    isNonEmptyString(value.sku) &&
    isNonEmptyString(value.title) &&
    value.isDefault === true &&
    isNumberOrNull(value.websitePrice) &&
    validStates.includes(value.websitePriceState as typeof validStates[number]) &&
    (value.websitePriceSource === null ||
      validSources.includes(value.websitePriceSource as typeof validSources[number])) &&
    validStock.includes(value.stockStatus as typeof validStock[number])
  );
}

function isCatalogueProductDto(value: unknown): value is CatalogueProductDto {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.slug) &&
    isNonEmptyString(value.title) &&
    typeof value.description === "string" &&
    isOptionalString(value.shortDescription) &&
    isOptionalString(value.model) &&
    isCatalogueBrandDto(value.brand) &&
    isCatalogueCategoryDto(value.category) &&
    isStringArray(value.tags) &&
    isBoolean(value.featured) &&
    isSpecMap(value.specifications) &&
    isOptionalString(value.warranty) &&
    isOptionalString(value.seoTitle) &&
    isOptionalString(value.seoDescription) &&
    isOptionalString(value.datasheetUrl) &&
    isOptionalString(value.image) &&
    isStringArray(value.images) &&
    isCatalogueDefaultVariantDto(value.defaultVariant)
  );
}

function assertSafePayload(payload: unknown): void {
  if (hasForbiddenKeys(payload)) {
    throw new CatalogueRepositoryError(
      "CATALOGUE_DTO_LEAK",
      "Catalogue payload failed safety validation.",
    );
  }
}

function mapRpcProductDto(raw: unknown): CatalogueProductDto | null {
  if (!isPlainObject(raw)) return null;

  const product: CatalogueProductDto = {
    slug: raw.slug as string,
    title: raw.title as string,
    description: raw.description as string,
    shortDescription: raw.shortDescription as string | null,
    model: raw.model as string | null,
    brand: raw.brand as CatalogueBrandDto,
    category: raw.category as CatalogueCategoryDto,
    tags: raw.tags as string[],
    featured: raw.featured as boolean,
    specifications: raw.specifications as Record<string, string>,
    warranty: raw.warranty as string | null,
    seoTitle: raw.seoTitle as string | null,
    seoDescription: raw.seoDescription as string | null,
    datasheetUrl: raw.datasheetUrl as string | null,
    image: raw.image as string | null,
    images: raw.images as string[],
    defaultVariant: raw.defaultVariant as CatalogueDefaultVariantDto,
  };

  if (!isCatalogueProductDto(product)) return null;
  assertSafePayload(product);
  return product;
}

export function createSupabaseCatalogueRepository(
  clientFactory: () => SupabaseClient | null = getSupabase,
  activeCheck: () => boolean = isSupabaseActive,
): CatalogueRepository {
  function requireClient(): SupabaseClient {
    if (!activeCheck()) {
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
      const rows = (data || []) as Array<{
        slug: string;
        name: string;
        description: string | null;
        sort_order: number;
        active: boolean;
      }>;
      const mapped = rows.map((r) => ({
        slug: r.slug,
        name: r.name,
        description: r.description ?? null,
        sortOrder: Number(r.sort_order) || 0,
      }));
      assertSafePayload(mapped);
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
      const rows = (data || []) as Array<{ slug: string; name: string; active: boolean }>;
      const mapped = rows.map((r) => ({ slug: r.slug, name: r.name }));
      assertSafePayload(mapped);
      return mapped;
    },

    async listProducts(filters: CatalogueListFilters): Promise<CataloguePage> {
      const supabase = requireClient();
      const RPC_PAGE = 500;
      const callerOffset = filters.offset ?? 0;
      const callerLimit = filters.limit;
      const products: CatalogueProductDto[] = [];
      let total = 0;
      let rpcOffset = callerOffset;

      while (true) {
        const remaining =
          callerLimit !== undefined ? callerLimit - products.length : RPC_PAGE;
        const rpcLimit = Math.min(remaining, RPC_PAGE);
        if (rpcLimit <= 0) break;

        const { data: rpcData, error: rpcErr } = await supabase.rpc(
          "mp_public_catalogue_list",
          {
            p_category_slug: filters.category ?? null,
            p_brand_slug: filters.brand ?? null,
            p_featured_only: filters.featured ?? null,
            p_limit: rpcLimit,
            p_offset: rpcOffset,
          },
        );

        if (rpcErr) {
          throw new CatalogueRepositoryError(
            "CATALOGUE_QUERY_FAILED",
            "Unable to load catalogue products.",
          );
        }

        const rows = (rpcData ?? []) as Array<{
          product: unknown;
          total: number;
        }>;

        if (rows.length > 0) {
          total = Number(rows[0].total);
        }

        for (const row of rows) {
          if (row.product === null) continue;
          const dto = mapRpcProductDto(row.product);
          if (dto) products.push(dto);
        }

        const pageCount = rows.filter((r) => r.product !== null).length;
        if (pageCount < rpcLimit) break;
        if (callerLimit !== undefined && products.length >= callerLimit) break;
        rpcOffset += rpcLimit;
      }

      return {
        items: products,
        total,
        limit: callerLimit ?? products.length,
        offset: callerOffset,
      };
    },

    async getProductBySlug(slug: string): Promise<CatalogueProductDto | null> {
      const supabase = requireClient();
      const { data, error } = await supabase.rpc("mp_public_catalogue_get_by_slug", {
        p_slug: slug,
      });

      if (error) {
        throw new CatalogueRepositoryError(
          "CATALOGUE_QUERY_FAILED",
          "Unable to load catalogue product.",
        );
      }

      const rows = (data ?? []) as Array<{ product: unknown }>;
      const row = rows[0];
      if (!row || row.product === null || row.product === undefined) return null;

      return mapRpcProductDto(row.product);
    },
  };
}
