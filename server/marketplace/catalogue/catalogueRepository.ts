import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../../dbManager.ts";
import { normalizeAnyAllowedImageUrl } from "../catalogueManager/imagePolicy.ts";
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

function invalidResponse(detail: string): CatalogueRepositoryError {
  return new CatalogueRepositoryError(
    "CATALOGUE_RESPONSE_INVALID",
    `Catalogue RPC response failed validation: ${detail}`,
  );
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
    typeof value.sortOrder === "number" &&
    Number.isFinite(value.sortOrder)
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

function assertFiniteNonNegativeInteger(value: unknown, context: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw invalidResponse(`${context} is not a finite non-negative integer`);
  }
  return value;
}

/**
 * Public price policy ( defence in depth — also enforced inside the v2 RPCs):
 * a website price is only publishable when the price state is priced_auto or
 * priced_override, stock is in_stock, and the price is positive and finite.
 * confirm_price keeps its state but never exposes a price. unknown, sold_out
 * and backorder remain non-purchasable and never expose an automatic price.
 */
export function applyPublicPricePolicy(
  variant: CatalogueDefaultVariantDto,
): CatalogueDefaultVariantDto {
  const price = variant.websitePrice;
  const positiveFinite =
    typeof price === "number" && Number.isFinite(price) && price > 0;
  const publishable =
    positiveFinite &&
    variant.stockStatus === "in_stock" &&
    (variant.websitePriceState === "priced_auto" ||
      variant.websitePriceState === "priced_override");
  return { ...variant, websitePrice: publishable ? price : null };
}

/**
 * Media defence for the RPC DTO mapping path. Every image URL returned by the
 * v2 RPCs must be HTTPS and pass the server's exact hostname allowlist
 * (supplier hosts + configured own/licensed hosts). Invalid URLs are removed;
 * the primary image is the first surviving URL.
 */
export function sanitizeRpcMediaUrls(
  image: unknown,
  images: unknown,
): { image: string | null; images: string[] } {
  const candidates: unknown[] = [];
  if (image !== null && image !== undefined) candidates.push(image);
  if (Array.isArray(images)) candidates.push(...images);
  const valid: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    const normalized = normalizeAnyAllowedImageUrl(candidate);
    if (normalized !== null) valid.push(normalized);
  }
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const url of valid) {
    if (!seen.has(url)) {
      seen.add(url);
      deduped.push(url);
    }
  }
  return { image: deduped[0] ?? null, images: deduped.slice(1) };
}

/**
 * Maps one RPC product payload to the public DTO. Fail-closed: any malformed
 * or unsafe payload throws CATALOGUE_RESPONSE_INVALID instead of being
 * silently dropped.
 */
function mapRpcProductDto(raw: unknown): CatalogueProductDto {
  if (!isPlainObject(raw)) {
    throw invalidResponse("product payload is not an object");
  }

  const candidate: CatalogueProductDto = {
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

  if (!isCatalogueProductDto(candidate)) {
    throw invalidResponse("product payload failed DTO validation");
  }

  const media = sanitizeRpcMediaUrls(raw.image, raw.images);
  const product: CatalogueProductDto = {
    ...candidate,
    image: media.image,
    images: media.images,
    defaultVariant: applyPublicPricePolicy(candidate.defaultVariant),
  };

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
      const { data, error } = await supabase.rpc(
        "mp_public_catalogue_categories_v2",
        {},
      );
      if (error) {
        throw new CatalogueRepositoryError(
          "CATALOGUE_QUERY_FAILED",
          "Unable to load catalogue categories.",
        );
      }
      if (!Array.isArray(data)) {
        throw invalidResponse("categories RPC did not return a row array");
      }
      const mapped: CatalogueCategoryDto[] = [];
      for (const row of data) {
        if (!isPlainObject(row) || !("category" in row)) {
          throw invalidResponse("category row shape invalid");
        }
        const candidate = row.category;
        if (!isCatalogueCategoryDto(candidate)) {
          throw invalidResponse("category payload failed DTO validation");
        }
        mapped.push(candidate);
      }
      assertSafePayload(mapped);
      return mapped;
    },

    async listBrands(): Promise<CatalogueBrandDto[]> {
      const supabase = requireClient();
      const { data, error } = await supabase.rpc(
        "mp_public_catalogue_brands_v2",
        {},
      );
      if (error) {
        throw new CatalogueRepositoryError(
          "CATALOGUE_QUERY_FAILED",
          "Unable to load catalogue brands.",
        );
      }
      if (!Array.isArray(data)) {
        throw invalidResponse("brands RPC did not return a row array");
      }
      const mapped: CatalogueBrandDto[] = [];
      for (const row of data) {
        if (!isPlainObject(row) || !("brand" in row)) {
          throw invalidResponse("brand row shape invalid");
        }
        const candidate = row.brand;
        if (!isCatalogueBrandDto(candidate)) {
          throw invalidResponse("brand payload failed DTO validation");
        }
        mapped.push(candidate);
      }
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
      let sawTotal = false;
      let rpcOffset = callerOffset;

      while (true) {
        const remaining =
          callerLimit !== undefined ? callerLimit - products.length : RPC_PAGE;
        const rpcLimit = Math.min(remaining, RPC_PAGE);
        if (rpcLimit <= 0) break;

        const { data: rpcData, error: rpcErr } = await supabase.rpc(
          "mp_public_catalogue_list_v2",
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

        if (!Array.isArray(rpcData)) {
          throw invalidResponse("list RPC did not return a row array");
        }

        let pageCount = 0;
        for (const row of rpcData) {
          if (!isPlainObject(row) || !("product" in row) || !("total" in row)) {
            throw invalidResponse("list row shape invalid");
          }
          const rowTotal = assertFiniteNonNegativeInteger(
            row.total,
            "list row total",
          );
          if (!sawTotal) {
            total = rowTotal;
            sawTotal = true;
          } else if (rowTotal !== total) {
            throw invalidResponse("list row total inconsistent across rows");
          }
          if (row.product === null) continue;
          products.push(mapRpcProductDto(row.product));
          pageCount += 1;
        }

        if (pageCount < rpcLimit) break;
        if (callerLimit !== undefined && products.length >= callerLimit) break;
        rpcOffset += rpcLimit;
      }

      if (callerLimit !== undefined && products.length > callerLimit) {
        throw invalidResponse("returned more items than requested limit");
      }
      if (sawTotal && total < products.length) {
        throw invalidResponse("total is smaller than returned item count");
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
      const { data, error } = await supabase.rpc(
        "mp_public_catalogue_get_by_slug_v2",
        {
          p_slug: slug,
        },
      );

      if (error) {
        throw new CatalogueRepositoryError(
          "CATALOGUE_QUERY_FAILED",
          "Unable to load catalogue product.",
        );
      }

      if (!Array.isArray(data)) {
        throw invalidResponse("slug RPC did not return a row array");
      }
      if (data.length === 0) return null;

      const row = data[0];
      if (!isPlainObject(row) || !("product" in row)) {
        throw invalidResponse("slug row shape invalid");
      }
      if (row.product === null || row.product === undefined) return null;

      return mapRpcProductDto(row.product);
    },
  };
}
