/**
 * One-shot controlled live preview (not for production schedules).
 * Usage: node --import tsx scripts/live-preview-once.mjs
 */
import { createLiveCatalogueService } from "../server/marketplace/suppliers/liveCatalogueService.ts";

const repo = {
  async listActiveMappings() {
    return [];
  },
  async getPricingConfig() {
    return { maxIncreasePct: 15, maxDecreasePct: 25, stalenessHours: 72 };
  },
  async getVariantWebsitePrice() {
    return null;
  },
  async startJob() {
    return { runId: `live-preview-${Date.now()}` };
  },
  async finishJob() {},
  async insertObservation() {
    return { observationId: "n/a", productId: "n/a", variantId: "n/a" };
  },
  async createAlert() {
    return { alertId: "n/a" };
  },
  async listAlerts() {
    return [];
  },
  async publishPrice() {
    throw new Error("publish must not be called");
  },
  async upsertMapping() {
    return { mappingId: "n/a", matchLocked: true };
  },
};

const env = {
  MARKETPLACE_WS4_KAMAL_LIVE_ENABLED: "true",
  MARKETPLACE_WS4_KAMAL_AUTHORIZED_METHOD: "shopify_storefront_products_json",
  MARKETPLACE_WS4_ALLADIN_LIVE_ENABLED: "true",
  MARKETPLACE_WS4_ALLADIN_AUTHORIZED_METHOD: "shopify_storefront_products_json",
};

const live = createLiveCatalogueService({ repository: repo, env });
const result = await live.runLivePreview({
  actorScope: "admin:super:live-preview-operator",
});

const summary = {
  status: result.status,
  productionReady: result.productionReady,
  publishedCount: result.publishedCount,
  productsDiscovered: result.productsDiscovered,
  relevantProductsAccepted: result.relevantProductsAccepted,
  productsExcluded: result.productsExcluded,
  matchedProducts: result.matchedProducts,
  unmatchedProducts: result.unmatchedProducts,
  invalidPrices: result.invalidPrices,
  imageUrlsFound: result.imageUrlsFound,
  suppliers: result.suppliers.map((s) => ({
    supplier: s.supplier,
    ok: s.ok,
    accessMethod: s.accessMethod,
    discovered: s.discovered,
    accepted: s.accepted,
    excluded: s.excluded,
    matched: s.matched,
    unmatched: s.unmatched,
    validPrices: s.validPrices,
    invalidPrices: s.invalidPrices,
    imagesFound: s.imagesFound,
    failureClass: s.failureClass,
    message: s.message,
  })),
  sample: result.sample.map((s) => ({
    supplier: s.supplier,
    title: s.title,
    brand: s.brand,
    category: s.category,
    currentListedPricePkr: s.currentListedPricePkr,
    compareAtPricePkr: s.compareAtPricePkr,
    availability: s.availability,
    confirmPriceRecommended: s.confirmPriceRecommended,
    canonicalUrl: s.canonicalUrl,
    primaryImageHost: s.primaryImageUrl
      ? new URL(s.primaryImageUrl).hostname
      : null,
    matched: s.matched,
  })),
  warnings: result.warnings.slice(0, 5),
  errors: result.errors,
};

console.log(JSON.stringify(summary, null, 2));
