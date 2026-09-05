/**
 * Parse first-party Sunchaser website catalog.
 *
 * Source priority:
 * 1. Next.js App Router RSC payload on /shop (`self.__next_f.push` → products[])
 * 2. sitemap.xml product URLs (identity / discovery completeness)
 * 3. Product page JSON-LD (unit tests / optional enrichment)
 * HTML card scraping is last resort and is not used for production sync.
 */

import { WEBSITE_CATALOG_ORIGIN } from "./allowlist";

export interface WebsiteRawProduct {
  slug: string;
  title: string;
  description?: string;
  brand?: string;
  categorySlug?: string;
  tags?: string;
  featured?: boolean;
  specifications?: Record<string, unknown>;
  warranty?: string;
  image?: string;
  images?: string[];
  sku?: string;
  price?: number | null;
  originalPrice?: number | null;
  priceState?: string;
  priceSource?: string;
  stockStatus?: string;
  purchasable?: boolean;
  dataOrigin?: string;
}

export interface WebsiteCatalogDiscovery {
  source: "next_rsc_shop";
  products: WebsiteRawProduct[];
  sitemapProductSlugs: string[];
  discoveryComplete: boolean;
  parseErrors: string[];
}

function parseJsonValueAt(source: string, start: number): { value: unknown; end: number } | null {
  let i = start;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  const open = source[i];
  if (open !== "[" && open !== "{") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let j = i; j < source.length; j += 1) {
    const ch = source[j];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return { value: JSON.parse(source.slice(i, j + 1)), end: j + 1 };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function extractNextFlightStrings(html: string): string[] {
  const out: string[] = [];
  const marker = "self.__next_f.push(";
  let searchFrom = 0;
  while (searchFrom < html.length) {
    const start = html.indexOf(marker, searchFrom);
    if (start < 0) break;
    const jsonStart = start + marker.length;
    const parsed = parseJsonValueAt(html, jsonStart);
    if (parsed && Array.isArray(parsed.value) && typeof parsed.value[1] === "string") {
      out.push(parsed.value[1]);
      searchFrom = parsed.end;
      continue;
    }
    searchFrom = jsonStart + 1;
  }
  return out;
}

function asProduct(raw: unknown): WebsiteRawProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const slug = String(rec.slug || "").trim();
  const title = String(rec.title || rec.name || "").trim();
  if (!slug || !title) return null;
  const images = Array.isArray(rec.images) ? rec.images.map((x) => String(x || "")).filter(Boolean) : [];
  const specs =
    rec.specifications && typeof rec.specifications === "object" && !Array.isArray(rec.specifications)
      ? (rec.specifications as Record<string, unknown>)
      : {};
  return {
    slug,
    title,
    description: rec.description != null ? String(rec.description) : undefined,
    brand: rec.brand != null ? String(rec.brand) : undefined,
    categorySlug: rec.categorySlug != null ? String(rec.categorySlug) : undefined,
    tags: rec.tags != null ? String(rec.tags) : undefined,
    featured: Boolean(rec.featured),
    specifications: specs,
    warranty: rec.warranty != null ? String(rec.warranty) : undefined,
    image: rec.image != null ? String(rec.image) : undefined,
    images,
    sku: rec.sku != null ? String(rec.sku) : undefined,
    price: rec.price == null || rec.price === "" ? null : Number(rec.price),
    originalPrice: rec.originalPrice == null || rec.originalPrice === "" ? null : Number(rec.originalPrice),
    priceState: rec.priceState != null ? String(rec.priceState) : undefined,
    priceSource: rec.priceSource != null ? String(rec.priceSource) : undefined,
    stockStatus: rec.stockStatus != null ? String(rec.stockStatus) : undefined,
    purchasable: rec.purchasable == null ? undefined : Boolean(rec.purchasable),
    dataOrigin: rec.dataOrigin != null ? String(rec.dataOrigin) : undefined,
  };
}

function walkForProducts(node: unknown, found: WebsiteRawProduct[], errors: string[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    if (node.length && node.every((item) => item && typeof item === "object" && "slug" in (item as object))) {
      for (const item of node) {
        try {
          const product = asProduct(item);
          if (product) found.push(product);
        } catch (err: any) {
          errors.push(String(err?.message || err || "product parse failed"));
        }
      }
      return;
    }
    for (const item of node) walkForProducts(item, found, errors);
    return;
  }
  if (typeof node === "object") {
    const rec = node as Record<string, unknown>;
    if (Array.isArray(rec.products)) {
      walkForProducts(rec.products, found, errors);
      return;
    }
    for (const value of Object.values(rec)) walkForProducts(value, found, errors);
  }
}

export function extractRscProducts(html: string): { products: WebsiteRawProduct[]; errors: string[] } {
  const errors: string[] = [];
  const products: WebsiteRawProduct[] = [];
  const seen = new Set<string>();
  for (const flight of extractNextFlightStrings(html)) {
    const colon = flight.indexOf(":");
    const body = colon >= 0 ? flight.slice(colon + 1) : flight;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    const bucket: WebsiteRawProduct[] = [];
    walkForProducts(parsed, bucket, errors);
    for (const product of bucket) {
      if (seen.has(product.slug)) continue;
      seen.add(product.slug);
      products.push(product);
    }
  }
  return { products, errors };
}

export function extractSitemapProductSlugs(xml: string): string[] {
  const locs = String(xml || "").match(/<loc>([^<]+)<\/loc>/g) || [];
  const slugs: string[] = [];
  const seen = new Set<string>();
  for (const locTag of locs) {
    const loc = locTag.replace(/<\/?loc>/g, "").trim();
    try {
      const url = new URL(loc);
      if (url.origin !== WEBSITE_CATALOG_ORIGIN && url.hostname !== "sunchaserenergy.co") continue;
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "shop" || parts.length < 2) continue;
      if (parts[1] === "category" || parts[1] === "brand") continue;
      const slug = parts.slice(1).join("/");
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      slugs.push(slug);
    } catch {
      continue;
    }
  }
  return slugs;
}

export function parseProductJsonLd(html: string): Record<string, unknown> | null {
  const blocks = String(html || "").match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const inner = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      const parsed = JSON.parse(inner);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        if (node && typeof node === "object" && node["@type"] === "Product") return node as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function parseShopCatalog(shopHtml: string, sitemapXml?: string): WebsiteCatalogDiscovery {
  const parsed = extractRscProducts(shopHtml);
  const sitemapProductSlugs = sitemapXml ? extractSitemapProductSlugs(sitemapXml) : [];
  const discoveryComplete = parsed.products.length > 0;
  return {
    source: "next_rsc_shop",
    products: parsed.products,
    sitemapProductSlugs,
    discoveryComplete,
    parseErrors: parsed.errors,
  };
}
