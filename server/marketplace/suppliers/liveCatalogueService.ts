/**
 * Phase 1 live catalogue preview — fetch/normalize/match only.
 * Never publishes prices; never writes website_price.
 */
import type { SupplierCode, SupplierMappingRow } from "./adapterTypes.ts";
import { LIVE_CATALOGUE_JOB_NAME } from "./liveCatalogueTypes.ts";
import {
  SHOPIFY_STOREFRONT_PRODUCTS_JSON,
  type CatalogueProductObservation,
  type LiveCataloguePreviewResult,
  type LiveSupplierPreviewStatus,
} from "./liveCatalogueTypes.ts";
import { normalizeCatalogueProducts } from "./catalogueNormalize.ts";
import {
  isEvidenceBlockerVariant,
  isMappingPublishEligible,
} from "./evidenceBlockers.ts";
import {
  fetchShopifyCatalogue,
  type CatalogueFetchDeps,
} from "./shopifyCatalogue.ts";
import { SafeHttpError } from "./safeHttp.ts";
import type { SupplierRepository } from "./supplierRepository.ts";
import { createSupabaseSupplierRepository } from "./supplierRepository.ts";
import {
  isSupplierLiveConfigured,
  readAuthorizedMethod,
} from "./liveSupplierConfig.ts";
import { SupplierError } from "./supplierTypes.ts";

/** Phase 1 hard-lock: live observations never auto-publish. */
export const PHASE1_LIVE_PUBLICATION_ALLOWED = false;

export type LiveCatalogueServiceDeps = {
  repository?: SupplierRepository;
  env?: NodeJS.ProcessEnv;
  catalogueDeps?: CatalogueFetchDeps;
  now?: () => Date;
  /** In-memory overlap lock for tests / non-DB preview. */
  overlapLock?: { held: boolean };
};

export { isSupplierLiveConfigured } from "./liveSupplierConfig.ts";

function matchObservation(
  obs: CatalogueProductObservation,
  mappings: SupplierMappingRow[],
): SupplierMappingRow | null {
  const candidates = mappings.filter(
    (m) =>
      m.supplierCode === obs.supplier &&
      m.active &&
      String(m.supplierProductId) === String(obs.supplierProductId),
  );
  if (!candidates.length) return null;

  // Prefer exact unlocked publish-eligible mappings; still report match for locked blockers.
  const exact = candidates.find(
    (m) =>
      m.matchConfidence === "exact" &&
      !isEvidenceBlockerVariant(m.variantId) &&
      isMappingPublishEligible(m),
  );
  if (exact) return exact;

  const exactAny = candidates.find((m) => m.matchConfidence === "exact");
  return exactAny ?? candidates[0] ?? null;
}

function emptySupplierStatus(
  supplier: SupplierCode,
  enabled: boolean,
  method: string | null,
): LiveSupplierPreviewStatus {
  return {
    supplier,
    enabled,
    accessMethod: method,
    ok: false,
    discovered: 0,
    accepted: 0,
    excluded: 0,
    matched: 0,
    unmatched: 0,
    validPrices: 0,
    invalidPrices: 0,
    imagesFound: 0,
    warnings: [],
  };
}

export function createLiveCatalogueService(
  deps: LiveCatalogueServiceDeps = {},
) {
  const env = deps.env ?? process.env;
  const repo = deps.repository ?? createSupabaseSupplierRepository();
  const now = deps.now ?? (() => new Date());
  const overlapLock = deps.overlapLock ?? { held: false };

  async function runLivePreview(input: {
    actorScope: string;
    suppliers?: SupplierCode[];
  }): Promise<LiveCataloguePreviewResult> {
    if (!input.actorScope.startsWith("admin:super:")) {
      throw new SupplierError(
        403,
        "FORBIDDEN",
        "Live supplier preview requires Super Admin.",
      );
    }

    if (overlapLock.held) {
      throw new SupplierError(
        409,
        "CONFLICT",
        "Overlapping live preview already running.",
      );
    }

    const requested = input.suppliers?.length
      ? input.suppliers
      : (["kamal", "alladin"] as SupplierCode[]);

    let runId = `preview-local-${now().getTime()}`;
    overlapLock.held = true;
    try {
      try {
        const started = await repo.startJob("manual", input.actorScope, {
          jobName: LIVE_CATALOGUE_JOB_NAME,
          mode: "preview_only",
          productionReady: false,
          publicationAllowed: PHASE1_LIVE_PUBLICATION_ALLOWED,
        });
        runId = started.runId;
      } catch (err) {
        // Memory repos in unit tests may not implement durable jobs — keep going
        // unless it is an explicit overlap conflict.
        if (err instanceof SupplierError && err.code === "CONFLICT") throw err;
      }

      const mappings = await repo.listActiveMappings(input.actorScope);
      const suppliers: LiveSupplierPreviewStatus[] = [];
      const allAccepted: CatalogueProductObservation[] = [];
      const warnings: string[] = [];
      const errors: string[] = [];
      let matchedProducts = 0;
      let unmatchedProducts = 0;
      let invalidPrices = 0;
      let imageUrlsFound = 0;
      let productsDiscovered = 0;
      let productsExcluded = 0;
      let relevantAccepted = 0;

      // Conservative sequential supplier processing (rate-limit friendly).
      for (const supplier of requested) {
        const method = readAuthorizedMethod(env, supplier) || null;
        const enabled = isSupplierLiveConfigured(supplier, env);
        const status = emptySupplierStatus(supplier, enabled, method);

        if (!enabled) {
          status.failureClass = "disabled";
          status.message =
            "Live mode disabled or authorized method not set to shopify_storefront_products_json.";
          status.warnings.push(status.message);
          warnings.push(`${supplier}: ${status.message}`);
          suppliers.push(status);
          continue;
        }

        try {
          const catalogue = await fetchShopifyCatalogue(supplier, deps.catalogueDeps);
          status.discovered = catalogue.products.length;
          productsDiscovered += catalogue.products.length;

          const { accepted, excluded } = normalizeCatalogueProducts(
            supplier,
            catalogue.products,
            now().toISOString(),
          );
          status.accepted = accepted.length;
          status.excluded = excluded.length;
          productsExcluded += excluded.length;
          relevantAccepted += accepted.length;
          allAccepted.push(...accepted);

          for (const obs of accepted) {
            if (obs.parseStatus === "ok" && obs.currentListedPricePkr != null) {
              status.validPrices += 1;
            } else {
              status.invalidPrices += 1;
              invalidPrices += 1;
            }
            if (obs.primaryImageUrl) {
              status.imagesFound += 1;
              imageUrlsFound += 1;
            }
            imageUrlsFound += obs.additionalImageUrls.length;
            status.imagesFound += obs.additionalImageUrls.length;

            const mapping = matchObservation(obs, mappings);
            if (mapping) {
              status.matched += 1;
              matchedProducts += 1;
              if (
                isEvidenceBlockerVariant(mapping.variantId) ||
                mapping.matchLocked
              ) {
                status.warnings.push(
                  `Matched locked/blocker mapping for ${obs.supplierProductId}; preview only.`,
                );
              }
            } else {
              status.unmatched += 1;
              unmatchedProducts += 1;
            }
          }

          status.ok = true;
          if (excluded.length) {
            status.warnings.push(
              `${excluded.length} products excluded by category filter.`,
            );
          }
        } catch (err) {
          status.ok = false;
          if (err instanceof SafeHttpError) {
            status.failureClass = err.code;
            status.message = err.message;
          } else {
            status.failureClass = "transport_error";
            status.message =
              err instanceof Error ? err.message : "supplier catalogue failed";
          }
          errors.push(`${supplier}: ${status.message}`);
          // One supplier failing must not discard the other.
        }

        suppliers.push(status);
      }

      const sampleObs = [
        ...allAccepted.filter((o) => o.supplier === "kamal").slice(0, 3),
        ...allAccepted.filter((o) => o.supplier === "alladin").slice(0, 3),
      ];
      const sample = sampleObs.map((obs) => ({
        supplier: obs.supplier,
        title: obs.title,
        brand: obs.brand,
        category: obs.category,
        currentListedPricePkr: obs.currentListedPricePkr,
        compareAtPricePkr: obs.compareAtPricePkr,
        availability: obs.availability,
        confirmPriceRecommended: obs.confirmPriceRecommended,
        canonicalUrl: obs.canonicalUrl,
        primaryImageUrl: obs.primaryImageUrl,
        matched: Boolean(matchObservation(obs, mappings)),
      }));

      const anyOk = suppliers.some((s) => s.ok);
      const anyFail = suppliers.some((s) => s.enabled && !s.ok);
      const status: LiveCataloguePreviewResult["status"] = anyOk
        ? anyFail
          ? "partial"
          : "succeeded"
        : "failed";

      if (!PHASE1_LIVE_PUBLICATION_ALLOWED) {
        warnings.push(
          "Phase 1 preview only: publishedCount remains 0; mp_publish_price not invoked.",
        );
      }

      try {
        await repo.finishJob(
          runId,
          status === "failed" ? "failed" : "succeeded",
          input.actorScope,
          status === "failed" ? errors.join("; ") || "preview failed" : null,
          {
            mode: "preview_only",
            productionReady: false,
            publishedCount: 0,
            productsDiscovered,
            relevantAccepted,
            productsExcluded,
            matchedProducts,
            unmatchedProducts,
            invalidPrices,
          },
        );
      } catch {
        /* best-effort durable finish */
      }

      return {
        runId,
        status,
        suppliers,
        productsDiscovered,
        relevantProductsAccepted: relevantAccepted,
        productsExcluded,
        matchedProducts,
        unmatchedProducts,
        invalidPrices,
        imageUrlsFound,
        warnings,
        errors,
        productionReady: false,
        publishedCount: 0,
        sample,
        note: "Phase 1 live supplier preview — observations normalized for review only; no automatic publication.",
      };
    } finally {
      overlapLock.held = false;
    }
  }

  return {
    runLivePreview,
    isSupplierLiveConfigured: (supplier: SupplierCode) =>
      isSupplierLiveConfigured(supplier, env),
  };
}

export type LiveCatalogueService = ReturnType<typeof createLiveCatalogueService>;
