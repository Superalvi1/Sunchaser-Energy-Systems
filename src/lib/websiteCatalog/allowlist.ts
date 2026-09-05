/**
 * Server-controlled first-party website catalog allowlist.
 * Callers must never accept a browser-supplied URL.
 */

export const WEBSITE_CATALOG_SOURCE = "sunchaser_website";

export const WEBSITE_CATALOG_HOSTS = new Set(["www.sunchaserenergy.co", "sunchaserenergy.co"]);

export const WEBSITE_CATALOG_ORIGIN = "https://www.sunchaserenergy.co";
export const WEBSITE_SHOP_PATH = "/shop";
export const WEBSITE_SITEMAP_PATH = "/sitemap.xml";

export const WEBSITE_SHOP_URL = `${WEBSITE_CATALOG_ORIGIN}${WEBSITE_SHOP_PATH}`;
export const WEBSITE_SITEMAP_URL = `${WEBSITE_CATALOG_ORIGIN}${WEBSITE_SITEMAP_PATH}`;

export const WEBSITE_CATALOG_USER_AGENT = "SunchaserCRM-WebsiteCatalogSync/1.0";
export const WEBSITE_CATALOG_MAX_BYTES = 6_000_000;

export class WebsiteCatalogUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebsiteCatalogUrlError";
  }
}

export function assertWebsiteCatalogUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebsiteCatalogUrlError("URL is not absolute/valid.");
  }
  if (url.protocol !== "https:") {
    throw new WebsiteCatalogUrlError("Only HTTPS website catalog URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new WebsiteCatalogUrlError("URL credentials are not allowed.");
  }
  const host = url.hostname.toLowerCase();
  if (!WEBSITE_CATALOG_HOSTS.has(host)) {
    throw new WebsiteCatalogUrlError(`Host not allowlisted: ${host}`);
  }
  return url;
}

export function websiteProductUrl(slug: string): string {
  const clean = String(slug || "").replace(/^\/+/, "").replace(/^shop\//, "");
  return `${WEBSITE_CATALOG_ORIGIN}/shop/${clean}`;
}
