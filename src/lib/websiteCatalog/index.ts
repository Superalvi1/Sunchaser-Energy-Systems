export {
  WEBSITE_CATALOG_SOURCE,
  WEBSITE_CATALOG_HOSTS,
  WEBSITE_SHOP_URL,
  WEBSITE_SITEMAP_URL,
  assertWebsiteCatalogUrl,
  websiteProductUrl,
  WebsiteCatalogUrlError,
} from "./allowlist";
export { parseShopCatalog, extractRscProducts, extractSitemapProductSlugs, parseProductJsonLd, evaluateCatalogDiscovery, normalizeCatalogSlug } from "./parseShopCatalog";
export type { WebsiteRawProduct, WebsiteCatalogDiscovery } from "./parseShopCatalog";
export {
  normalizeWebsiteProduct,
  resolveWebsiteProductType,
  websiteCatalogProductId,
  toCrmProduct,
  liftWebsiteSourceFields,
  withWebsiteSourceMetadata,
  WEBSITE_SOURCE_SPEC_KEY,
} from "./normalize";
export type { NormalizedWebsiteProduct, CrmProductType } from "./normalize";
export {
  applyWebsiteCatalogSync,
  emptyWebsiteCatalogReport,
  isSelectableCatalogProduct,
  websiteSyncedFirst,
  productsForType,
  productsForBrand,
  catalogFingerprint,
  findExistingCatalogIndex,
  patchLatestSettingsWithWebsiteCatalogSync,
  resolveWebsiteCatalogSyncBaseline,
  applyWebsiteCatalogPersistenceFailure,
  WEBSITE_CATALOG_SETTINGS_KEY,
} from "./sync";
export type { WebsiteCatalogSyncReport, WebsiteCatalogSyncResult } from "./sync";
export {
  canSyncWebsiteCatalog,
  authorizeWebsiteCatalogSyncAccess,
  authorizeWebsiteCatalogReadAccess,
} from "./auth";
export { fetchWebsiteShopAndSitemap, defaultWebsiteCatalogFetch } from "./fetchCatalog";
export type { CatalogFetchFn } from "./fetchCatalog";
export { runWebsiteCatalogSync } from "./runSync";
export {
  CRM_OWNED_INVENTORY_FIELDS,
  mergeCurrentCrmOwnedInventory,
  applyCurrentCrmOwnedInventory,
  mapWebsiteCatalogProductForSupabase,
  readSettingsAtPersistTime,
  finalizeWebsiteCatalogSync,
} from "./persist";
export type {
  WebsiteCatalogSupabaseRow,
  WebsiteCatalogPersistAdapters,
  WebsiteCatalogFinalizeInput,
  WebsiteCatalogFinalizeOutput,
} from "./persist";

