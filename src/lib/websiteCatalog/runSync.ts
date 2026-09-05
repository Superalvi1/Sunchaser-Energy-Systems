import type { Product } from "../../types";
import { fetchWebsiteShopAndSitemap, type CatalogFetchFn } from "./fetchCatalog";
import { parseShopCatalog } from "./parseShopCatalog";
import { normalizeWebsiteProduct } from "./normalize";
import { applyWebsiteCatalogSync, emptyWebsiteCatalogReport, type WebsiteCatalogSyncResult } from "./sync";

export async function runWebsiteCatalogSync(
  existingProducts: Product[] | null | undefined,
  fetchFn?: CatalogFetchFn,
  now = () => new Date().toISOString()
): Promise<WebsiteCatalogSyncResult> {
  const existing = existingProducts || [];
  const { shopHtml, sitemapXml, fetchErrors } = await fetchWebsiteShopAndSitemap(fetchFn);
  if (!shopHtml) {
    return {
      products: existing,
      report: {
        ...emptyWebsiteCatalogReport(),
        lastStatus: "failed",
        errors: fetchErrors.length ? fetchErrors : ["Website shop page was unavailable."],
        lastSyncedAt: existing.find((p) => p.lastSyncedAt)?.lastSyncedAt || null,
      },
    };
  }

  const discovery = parseShopCatalog(shopHtml, sitemapXml);
  const errors = [...fetchErrors, ...discovery.parseErrors];
  if (!discovery.discoveryComplete) {
    errors.push("Shop catalog payload was missing or unreadable. Previous catalog left intact.");
    return {
      products: existing,
      report: {
        ...emptyWebsiteCatalogReport(),
        lastStatus: "failed",
        errors,
        lastSyncedAt: existing.find((p) => p.lastSyncedAt)?.lastSyncedAt || null,
      },
    };
  }

  const syncedAt = now();
  const normalized = [];
  for (const raw of discovery.products) {
    try {
      normalized.push(normalizeWebsiteProduct(raw, syncedAt));
    } catch (err: any) {
      errors.push(`${raw.slug}: ${err?.message || "normalize failed"}`);
    }
  }

  return applyWebsiteCatalogSync(existing, normalized, {
    discoveryComplete: true,
    syncedAt,
    parseErrors: errors,
  });
}
