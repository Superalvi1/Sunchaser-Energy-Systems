import { normalizeSupplierImageUrl } from "../suppliers/safeHttp.ts";
import { normalizeAnyAllowedImageUrl } from "../catalogueManager/imagePolicy.ts";
import type {
  CatalogueBrandDto,
  CatalogueCategoryDto,
  CatalogueDefaultVariantDto,
  CatalogueProductDto,
} from "./catalogueTypes.ts";

export type BrandRow = { id?: string; slug: string; name: string; active?: boolean };
export type CategoryRow = {
  id?: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
  active?: boolean;
};

type VariantRow = {
  sku: string;
  title: string;
  is_default: boolean;
  website_price: string | number | null;
  website_price_state: string;
  website_price_source: string | null;
  stock_status: string;
  active: boolean;
  compare_at_price?: string | number | null;
};

type MediaRow = {
  source_url: string | null;
  sort_order: number | null;
  role: string | null;
  published: boolean | null;
  rights_status: string | null;
  source_type: string | null;
};

type FieldOverrideRow = {
  field_name: string;
  override_value: unknown;
  active: boolean;
};

const PUBLIC_MEDIA_SOURCE_TYPES = new Set([
  "supplier",
  "own",
  "licensed",
  "user_upload",
  "manufacturer",
]);

const PUBLIC_MEDIA_RIGHTS = new Set([
  "supplier_approved",
  "own",
  "licensed",
]);

export type ProductRow = {
  id?: string;
  slug: string;
  title: string;
  description: string;
  tags: string[] | null;
  featured: boolean;
  specifications: Record<string, unknown> | null;
  warranty: string | null;
  /** When explicitly false, product is hidden from public catalogue. Legacy null/undefined → visible. */
  public_visible?: boolean | null;
  short_description?: string | null;
  model?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  datasheet_url?: string | null;
  brand: BrandRow | BrandRow[] | null;
  category: CategoryRow | CategoryRow[] | null;
  variants: VariantRow[] | null;
  media?: MediaRow[] | MediaRow | null;
  field_overrides?: FieldOverrideRow[] | FieldOverrideRow | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function asSpecMap(value: Record<string, unknown> | null): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") out[key] = raw;
    else if (raw == null) continue;
    else out[key] = String(raw);
  }
  return out;
}

function asPrice(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function mapVariant(row: VariantRow, stockStatusOverride?: string): CatalogueDefaultVariantDto {
  const state = row.website_price_state;
  const source = row.website_price_source;
  const stockStatus = stockStatusOverride ??
    (row.stock_status === "in_stock" ||
      row.stock_status === "sold_out" ||
      row.stock_status === "backorder" ||
      row.stock_status === "unknown"
      ? row.stock_status
      : "unknown");
  return {
    sku: row.sku,
    title: row.title,
    isDefault: true,
    websitePrice: asPrice(row.website_price),
    websitePriceState:
      state === "priced_override" || state === "confirm_price" || state === "priced_auto"
        ? state
        : "confirm_price",
    websitePriceSource:
      source === "kamal" ||
        source === "alladin" ||
        source === "seed" ||
        source === "override" ||
        source === "last_approved"
        ? source
        : null,
    stockStatus: stockStatus as CatalogueDefaultVariantDto["stockStatus"],
  };
}

/**
 * Published media → safe public URLs.
 * Accepts supplier, own (supabase storage / env hosts), and licensed URLs.
 * Falls back to supplier normalization for backward compatibility.
 */
export function mapPublishedImageUrls(
  media: MediaRow[] | MediaRow | null | undefined,
): { image: string | null; images: string[] } {
  const rows = Array.isArray(media) ? media : media ? [media] : [];
  const eligible = rows
    .filter(
      (m) =>
        m &&
        m.published === true &&
        m.role !== "receipt" &&
        typeof m.source_type === "string" &&
        PUBLIC_MEDIA_SOURCE_TYPES.has(m.source_type) &&
        typeof m.rights_status === "string" &&
        PUBLIC_MEDIA_RIGHTS.has(m.rights_status),
    )
    .map((m) => ({
      url: normalizeAnyAllowedImageUrl(m.source_url) ?? normalizeSupplierImageUrl(m.source_url),
      sort: Number(m.sort_order) || 0,
      role: m.role || "gallery",
    }))
    .filter((m): m is { url: string; sort: number; role: string } => Boolean(m.url))
    .sort((a, b) => {
      if (a.role === "thumbnail" && b.role !== "thumbnail") return -1;
      if (b.role === "thumbnail" && a.role !== "thumbnail") return 1;
      return a.sort - b.sort;
    });

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const item of eligible) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    urls.push(item.url);
  }

  return {
    image: urls[0] ?? null,
    images: urls.slice(1),
  };
}

export function mapBrandDto(row: BrandRow): CatalogueBrandDto {
  return { slug: row.slug, name: row.name };
}

export function mapCategoryDto(row: CategoryRow): CatalogueCategoryDto {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    sortOrder: Number(row.sort_order) || 0,
  };
}

/**
 * Load active field overrides keyed by field_name.
 */
function loadActiveOverrides(rows: FieldOverrideRow[] | null | undefined): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (!rows) return map;
  const overrideRows = Array.isArray(rows) ? rows : [rows as FieldOverrideRow];
  for (const ov of overrideRows) {
    if (ov.active && !map.has(ov.field_name)) {
      map.set(ov.field_name, ov.override_value);
    }
  }
  return map;
}

export function mapProductDto(row: ProductRow): CatalogueProductDto | null {
  const overrides = loadActiveOverrides(
    Array.isArray(row.field_overrides)
      ? row.field_overrides
      : row.field_overrides
        ? [row.field_overrides as FieldOverrideRow]
        : [],
  );

  // Apply public_visible: override false OR column false → hide product
  const pvOverride = overrides.get("public_visible");
  if (pvOverride === false) return null;
  if (pvOverride === undefined && row.public_visible === false) return null;

  const brand = one(row.brand);
  const category = one(row.category);
  const variants = (row.variants || []).filter((v) => v.active !== false);
  const defaultVariant = variants.find((v) => v.is_default) || null;
  if (!brand || !category || !defaultVariant) return null;

  // Apply content overrides
  const effectiveTitle = overrides.has("title")
    ? String(overrides.get("title") ?? row.title)
    : row.title;

  const effectiveDescription = overrides.has("description")
    ? String(overrides.get("description") ?? row.description)
    : row.description || "";

  const effectiveFeatured = overrides.has("featured")
    ? Boolean(overrides.get("featured"))
    : Boolean(row.featured);

  const effectiveSpecifications = overrides.has("specifications")
    ? asSpecMap(overrides.get("specifications") as Record<string, unknown> | null)
    : asSpecMap(row.specifications);

  const effectiveWarranty = overrides.has("warranty")
    ? (overrides.get("warranty") as string | null) ?? null
    : row.warranty ?? null;

  // stock_status override applies to the default variant
  const stockStatusOverride = overrides.has("stock_status")
    ? (() => {
      const v = overrides.get("stock_status") as string;
      return (v === "in_stock" || v === "sold_out" || v === "backorder" || v === "unknown")
        ? v
        : undefined;
    })()
    : undefined;

  // brand_id / category_id overrides: keep base join if cannot resolve
  const effectiveBrand = brand;
  const effectiveCategory = category;

  // Image overrides
  let image: string | null;
  let images: string[];

  const piOverride = overrides.get("primary_image");
  const giOverride = overrides.get("gallery_images");

  if (typeof piOverride === "string" && piOverride) {
    image = normalizeAnyAllowedImageUrl(piOverride) ?? normalizeSupplierImageUrl(piOverride);
    if (typeof giOverride !== "undefined" && Array.isArray(giOverride)) {
      images = (giOverride as string[])
        .map((u) => normalizeAnyAllowedImageUrl(u) ?? normalizeSupplierImageUrl(u))
        .filter((u): u is string => u !== null);
    } else {
      const { images: mediaImages } = mapPublishedImageUrls(row.media);
      images = mediaImages;
    }
  } else {
    const derived = mapPublishedImageUrls(row.media);
    image = derived.image;
    images = derived.images;
  }

  return {
    slug: row.slug,
    title: effectiveTitle,
    description: effectiveDescription,
    brand: mapBrandDto(effectiveBrand),
    category: mapCategoryDto(effectiveCategory),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    featured: effectiveFeatured,
    specifications: effectiveSpecifications,
    warranty: effectiveWarranty,
    image,
    images,
    defaultVariant: mapVariant(defaultVariant, stockStatusOverride),
  };
}

export type { MediaRow };
