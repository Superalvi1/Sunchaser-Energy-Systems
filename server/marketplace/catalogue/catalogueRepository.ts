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
  "supplier_cost",
  "purchase_price",
  "profit",
  "internal_notes",
  "internal_code",
  "supplier_account",
];

function hasForbiddenKeys(payload: unknown): boolean {
  const text = JSON.stringify(payload);
  return FORBIDDEN_KEYS.some((key) => text.includes(`"${key}"`));
}

function assertSafePayload(payload: unknown): void {
  if (hasForbiddenKeys(payload)) {
    throw new CatalogueRepositoryError(
      "CATALOGUE_DTO_LEAK",
      "Catalogue payload failed safety validation.",
    );
  }
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

function asNonEmptyString(value: unknown, field: string): string {
  if (!isNonEmptyString(value)) {
    throw invalidResponse(`${field} must be a non-empty string`);
  }
  return value;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw invalidResponse(`${field} must be a string`);
  }
  return value;
}

function asOptionalString(value: unknown, field: string): string | null {
  if (!isOptionalString(value)) {
    throw invalidResponse(`${field} must be a string or null`);
  }
  return value;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!isStringArray(value)) {
    throw invalidResponse(`${field} must be an array of strings`);
  }
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (!isBoolean(value)) {
    throw invalidResponse(`${field} must be a boolean`);
  }
  return value;
}

function asSpecMap(value: unknown, field: string): Record<string, string> {
  if (!isSpecMap(value)) {
    throw invalidResponse(`${field} must be a string->string map`);
  }
  return value;
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
 * Reconstruct a brand DTO from the RPC payload, keeping only the exact public
 * keys. Any unexpected nested keys are dropped here rather than leaked.
 */
function reconstructBrand(raw: unknown): CatalogueBrandDto {
  if (!isPlainObject(raw)) {
    throw invalidResponse("brand payload is not an object");
  }
  return {
    slug: asNonEmptyString(raw.slug, "brand.slug"),
    name: asNonEmptyString(raw.name, "brand.name"),
  };
}

/**
 * Reconstruct a category DTO from the RPC payload, keeping only the exact
 * public keys.
 */
function reconstructCategory(raw: unknown): CatalogueCategoryDto {
  if (!isPlainObject(raw)) {
    throw invalidResponse("category payload is not an object");
  }
  const sortOrder = raw.sortOrder;
  if (typeof sortOrder !== "number" || !Number.isFinite(sortOrder)) {
    throw invalidResponse("category.sortOrder must be a finite number");
  }
  return {
    slug: asNonEmptyString(raw.slug, "category.slug"),
    name: asNonEmptyString(raw.name, "category.name"),
    description: asOptionalString(raw.description, "category.description"),
    sortOrder,
  };
}

/**
 * Reconstruct a defaultVariant DTO from the RPC payload, keeping only the exact
 * public keys. The websitePrice is NOT taken at face value; the public price
 * policy is applied afterwards.
 */
function reconstructDefaultVariant(raw: unknown): CatalogueDefaultVariantDto {
  if (!isPlainObject(raw)) {
    throw invalidResponse("defaultVariant payload is not an object");
  }
  const state = raw.websitePriceState;
  const validStates = ["priced_auto", "priced_override", "confirm_price"] as const;
  if (!validStates.includes(state as typeof validStates[number])) {
    throw invalidResponse("defaultVariant.websitePriceState is invalid");
  }
  const source = raw.websitePriceSource;
  const validSources = [
    "kamal",
    "alladin",
    "seed",
    "override",
    "last_approved",
  ] as const;
  if (
    source !== null &&
    !validSources.includes(source as typeof validSources[number])
  ) {
    throw invalidResponse("defaultVariant.websitePriceSource is invalid");
  }
  const stock = raw.stockStatus;
  const validStock = ["in_stock", "sold_out", "backorder", "unknown"] as const;
  if (!validStock.includes(stock as typeof validStock[number])) {
    throw invalidResponse("defaultVariant.stockStatus is invalid");
  }
  const price = raw.websitePrice;
  if (price !== null && (typeof price !== "number" || !Number.isFinite(price))) {
    throw invalidResponse("defaultVariant.websitePrice must be a finite number or null");
  }
  if (raw.isDefault !== true) {
    throw invalidResponse("defaultVariant.isDefault must be true");
  }
  return {
    sku: asNonEmptyString(raw.sku, "defaultVariant.sku"),
    title: asNonEmptyString(raw.title, "defaultVariant.title"),
    isDefault: true,
    websitePrice: price as number | null,
    websitePriceState: state as CatalogueDefaultVariantDto["websitePriceState"],
    websitePriceSource: source as CatalogueDefaultVariantDto["websitePriceSource"],
    stockStatus: stock as CatalogueDefaultVariantDto["stockStatus"],
  };
}

/**
 * Public price policy (defence in depth — also enforced inside the v2 RPCs):
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
 * silently dropped. Nested objects are reconstructed from whitelisted keys
 * only; any unexpected nested fields are stripped and never reach routes.
 */
function mapRpcProductDto(raw: unknown): CatalogueProductDto {
  if (!isPlainObject(raw)) {
    throw invalidResponse("product payload is not an object");
  }
  assertSafePayload(raw);

  const brand = reconstructBrand(raw.brand);
  const category = reconstructCategory(raw.category);
  const defaultVariant = applyPublicPricePolicy(
    reconstructDefaultVariant(raw.defaultVariant),
  );

  const product: CatalogueProductDto = {
    slug: asNonEmptyString(raw.slug, "slug"),
    title: asNonEmptyString(raw.title, "title"),
    description: asString(raw.description, "description"),
    shortDescription: asOptionalString(raw.shortDescription, "shortDescription"),
    model: asOptionalString(raw.model, "model"),
    brand,
    category,
    tags: asStringArray(raw.tags, "tags"),
    featured: asBoolean(raw.featured, "featured"),
    specifications: asSpecMap(raw.specifications, "specifications"),
    warranty: asOptionalString(raw.warranty, "warranty"),
    seoTitle: asOptionalString(raw.seoTitle, "seoTitle"),
    seoDescription: asOptionalString(raw.seoDescription, "seoDescription"),
    datasheetUrl: asOptionalString(raw.datasheetUrl, "datasheetUrl"),
    image: asOptionalString(raw.image, "image"),
    images: asStringArray(raw.images, "images"),
    defaultVariant,
  };

  const media = sanitizeRpcMediaUrls(raw.image, raw.images);
  const withMedia: CatalogueProductDto = {
    ...product,
    image: media.image,
    images: media.images,
  };

  assertSafePayload(withMedia);
  return withMedia;
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
        mapped.push(reconstructCategory(row.category));
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
        mapped.push(reconstructBrand(row.brand));
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
        if (rpcData.length === 0) {
          throw invalidResponse(
            "list RPC returned empty array instead of required sentinel row",
          );
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
      if (products.length > 0 && callerOffset >= total) {
        throw invalidResponse(
          "items returned at an offset beyond the declared total",
        );
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
      if (data.length > 1) {
        throw invalidResponse("slug RPC returned more than one row");
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
