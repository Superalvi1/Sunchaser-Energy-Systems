import { normalizeSupplierImageUrl } from "../suppliers/safeHttp.ts";
import type {
  CatalogueBrandDto,
  CatalogueCategoryDto,
  CatalogueDefaultVariantDto,
  CatalogueProductDto,
} from "./catalogueTypes.ts";

type BrandRow = { slug: string; name: string; active?: boolean };
type CategoryRow = {
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
};

type MediaRow = {
  source_url: string | null;
  sort_order: number | null;
  role: string | null;
  published: boolean | null;
  rights_status: string | null;
  source_type: string | null;
};

type ProductRow = {
  slug: string;
  title: string;
  description: string;
  tags: string[] | null;
  featured: boolean;
  specifications: Record<string, unknown> | null;
  warranty: string | null;
  brand: BrandRow | BrandRow[] | null;
  category: CategoryRow | CategoryRow[] | null;
  variants: VariantRow[] | null;
  media?: MediaRow[] | MediaRow | null;
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

function mapVariant(row: VariantRow): CatalogueDefaultVariantDto {
  const state = row.website_price_state;
  const source = row.website_price_source;
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
    stockStatus:
      row.stock_status === "in_stock" ||
      row.stock_status === "sold_out" ||
      row.stock_status === "backorder" ||
      row.stock_status === "unknown"
        ? row.stock_status
        : "unknown",
  };
}

/**
 * Published supplier media → safe public URLs.
 * Re-validates host/protocol; never returns unallowlisted URLs.
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
        m.source_type === "supplier" &&
        m.role !== "receipt" &&
        (m.rights_status === "supplier_approved" ||
          m.rights_status === "own" ||
          m.rights_status === "licensed"),
    )
    .map((m) => ({
      url: normalizeSupplierImageUrl(m.source_url),
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

export function mapProductDto(row: ProductRow): CatalogueProductDto | null {
  const brand = one(row.brand);
  const category = one(row.category);
  const variants = (row.variants || []).filter((v) => v.active !== false);
  const defaultVariant = variants.find((v) => v.is_default) || null;
  if (!brand || !category || !defaultVariant) return null;

  const { image, images } = mapPublishedImageUrls(row.media);

  return {
    slug: row.slug,
    title: row.title,
    description: row.description || "",
    brand: mapBrandDto(brand),
    category: mapCategoryDto(category),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    featured: Boolean(row.featured),
    specifications: asSpecMap(row.specifications),
    warranty: row.warranty ?? null,
    image,
    images,
    defaultVariant: mapVariant(defaultVariant),
  };
}

export type { ProductRow, BrandRow, CategoryRow, MediaRow };
