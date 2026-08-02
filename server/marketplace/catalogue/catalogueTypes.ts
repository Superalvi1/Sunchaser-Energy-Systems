/**
 * Public marketplace catalogue DTOs (API version 1).
 * Never include cost, margin, delivery, audit, or internal DB identifiers.
 */

export const MARKETPLACE_API_VERSION = "1";
export const MARKETPLACE_API_VERSION_HEADER = "X-Marketplace-API-Version";

export type CatalogueBrandDto = {
  slug: string;
  name: string;
};

export type CatalogueCategoryDto = {
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
};

export type CatalogueDefaultVariantDto = {
  sku: string;
  title: string;
  isDefault: true;
  websitePrice: number | null;
  websitePriceState: "priced_auto" | "priced_override" | "confirm_price";
  websitePriceSource: "kamal" | "alladin" | "seed" | "override" | "last_approved" | null;
  stockStatus: "in_stock" | "sold_out" | "backorder" | "unknown";
};

export type CatalogueProductDto = {
  slug: string;
  title: string;
  description: string;
  /** Short marketing description; null when not set. */
  shortDescription: string | null;
  /** Model/SKU identifier from the supplier or CEO override; null when not set. */
  model: string | null;
  brand: CatalogueBrandDto;
  category: CatalogueCategoryDto;
  tags: string[];
  featured: boolean;
  specifications: Record<string, string>;
  warranty: string | null;
  /** SEO page title override; null falls back to title. */
  seoTitle: string | null;
  /** SEO meta description; null when not set. */
  seoDescription: string | null;
  /** Link to manufacturer/supplier datasheet PDF; null when not set. */
  datasheetUrl: string | null;
  /** Primary supplier image URL (HTTPS allowlisted), or null when none. */
  image: string | null;
  /** Additional gallery URLs in deterministic sort order (excludes primary). */
  images: string[];
  defaultVariant: CatalogueDefaultVariantDto;
};

export type CatalogueListFilters = {
  category?: string;
  brand?: string;
  featured?: boolean;
};

export type CatalogueErrorBody = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export type CatalogueSuccessBody<T> = {
  ok: true;
  data: T;
};
