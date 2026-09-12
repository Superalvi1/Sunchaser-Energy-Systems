/**
 * Server-side first-party website fetch. Host allowlist is fixed; clients cannot supply URLs.
 */

import { safeFetchText, SafeHttpError } from "../../../server/marketplace/suppliers/safeHttp.ts";
import {
  WEBSITE_CATALOG_HOSTS,
  WEBSITE_CATALOG_MAX_BYTES,
  WEBSITE_CATALOG_USER_AGENT,
  WEBSITE_SHOP_URL,
  WEBSITE_SITEMAP_URL,
  assertWebsiteCatalogUrl,
} from "./allowlist";

export type CatalogFetchFn = (url: string) => Promise<{ status: number; body: string }>;

export async function defaultWebsiteCatalogFetch(url: string): Promise<{ status: number; body: string }> {
  const allowed = assertWebsiteCatalogUrl(url);
  const result = await safeFetchText(allowed.toString(), {
    allowedHosts: WEBSITE_CATALOG_HOSTS,
    userAgent: WEBSITE_CATALOG_USER_AGENT,
    maxBytes: WEBSITE_CATALOG_MAX_BYTES,
    timeoutMs: 25_000,
  });
  return { status: result.status, body: result.body };
}

export async function fetchWebsiteShopAndSitemap(fetchFn: CatalogFetchFn = defaultWebsiteCatalogFetch): Promise<{
  shopHtml: string;
  sitemapXml: string;
  fetchErrors: string[];
}> {
  const fetchErrors: string[] = [];
  let shopHtml = "";
  let sitemapXml = "";
  try {
    const shop = await fetchFn(WEBSITE_SHOP_URL);
    if (shop.status < 200 || shop.status >= 300) {
      fetchErrors.push(`Shop HTTP ${shop.status}`);
    } else {
      shopHtml = shop.body || "";
    }
  } catch (err: any) {
    const message = err instanceof SafeHttpError ? err.message : String(err?.message || err);
    fetchErrors.push(`Shop fetch failed: ${message}`);
  }
  try {
    const sitemap = await fetchFn(WEBSITE_SITEMAP_URL);
    if (sitemap.status >= 200 && sitemap.status < 300) sitemapXml = sitemap.body || "";
    else fetchErrors.push(`Sitemap HTTP ${sitemap.status}`);
  } catch (err: any) {
    const message = err instanceof SafeHttpError ? err.message : String(err?.message || err);
    fetchErrors.push(`Sitemap fetch failed: ${message}`);
  }
  return { shopHtml, sitemapXml, fetchErrors };
}
