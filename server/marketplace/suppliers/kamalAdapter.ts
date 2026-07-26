/**
 * Kamal supplier adapter.
 * Live access: Shopify public storefront products.json (authorized).
 * Fixture/manual injection remains for WS4 tests when live is disabled.
 */
import type {
  AdapterFetchResult,
  SupplierAdapter,
  SupplierMappingRow,
  NormalizedSupplierObservation,
} from "./adapterTypes.ts";
import { normalizeCatalogueProducts } from "./catalogueNormalize.ts";
import { SHOPIFY_STOREFRONT_PRODUCTS_JSON } from "./liveCatalogueTypes.ts";
import { isSupplierLiveConfigured } from "./liveSupplierConfig.ts";
import {
  fetchShopifyCatalogue,
  type CatalogueFetchDeps,
} from "./shopifyCatalogue.ts";

export type ManualObservationInput = {
  mappingId: string;
  supplierPublicPrice?: number | null;
  currency?: string;
  availability?: NormalizedSupplierObservation["availability"];
  parseStatus?: NormalizedSupplierObservation["parseStatus"];
  observedAt?: string;
  evidence?: Record<string, unknown>;
};

export function createKamalAdapter(deps: {
  /** Test/manual fixture map keyed by mapping id. */
  fixtures?: Map<string, ManualObservationInput>;
  env?: NodeJS.ProcessEnv;
  catalogueDeps?: CatalogueFetchDeps;
  /** Optional shared catalogue cache for a run. */
  catalogueCache?: Map<string, Awaited<ReturnType<typeof fetchShopifyCatalogue>>>;
} = {}): SupplierAdapter {
  const fixtures = deps.fixtures ?? new Map<string, ManualObservationInput>();
  const catalogueCache =
    deps.catalogueCache ??
    new Map<string, Awaited<ReturnType<typeof fetchShopifyCatalogue>>>();

  return {
    code: "kamal",
    isLiveEnabled(env = deps.env ?? process.env): boolean {
      return isSupplierLiveConfigured("kamal", env);
    },
    async fetchObservation(mapping, opts): Promise<AdapterFetchResult> {
      const env = opts?.env ?? deps.env ?? process.env;
      if (this.isLiveEnabled(env)) {
        return fetchLiveObservation("kamal", mapping, {
          catalogueDeps: deps.catalogueDeps,
          catalogueCache,
          timeoutMs: opts?.timeoutMs,
        });
      }

      const fixture = fixtures.get(mapping.id);
      if (!fixture) {
        return {
          ok: false,
          failureClass: "disabled",
          message:
            "Kamal live adapter disabled; no fixture/manual observation provided. Manual-only mode is insufficient for production.",
          mappingId: mapping.id,
          supplierCode: "kamal",
          productId: mapping.productId,
          variantId: mapping.variantId,
        };
      }

      return {
        ok: true,
        observation: normalizeFixture("kamal", mapping, fixture),
      };
    },
  };
}

async function fetchLiveObservation(
  code: "kamal" | "alladin",
  mapping: SupplierMappingRow,
  opts: {
    catalogueDeps?: CatalogueFetchDeps;
    catalogueCache: Map<
      string,
      Awaited<ReturnType<typeof fetchShopifyCatalogue>>
    >;
    timeoutMs?: number;
  },
): Promise<AdapterFetchResult> {
  try {
    const cacheKey = code;
    let catalogue = opts.catalogueCache.get(cacheKey);
    if (!catalogue) {
      catalogue = await fetchShopifyCatalogue(code, {
        ...opts.catalogueDeps,
        fetchOpts: {
          ...opts.catalogueDeps?.fetchOpts,
          timeoutMs: opts.timeoutMs ?? opts.catalogueDeps?.fetchOpts?.timeoutMs,
        },
      });
      opts.catalogueCache.set(cacheKey, catalogue);
    }

    const { accepted } = normalizeCatalogueProducts(
      code,
      catalogue.products,
      new Date().toISOString(),
    );
    const hit = accepted.find(
      (p) => String(p.supplierProductId) === String(mapping.supplierProductId),
    );
    if (!hit) {
      return {
        ok: false,
        failureClass: "parse_error",
        message: `${code} live catalogue did not contain mapped supplierProductId.`,
        mappingId: mapping.id,
        supplierCode: code,
        productId: mapping.productId,
        variantId: mapping.variantId,
      };
    }

    return {
      ok: true,
      observation: {
        supplierCode: code,
        mappingId: mapping.id,
        productId: mapping.productId,
        variantId: mapping.variantId,
        observedAt: hit.fetchedAt,
        supplierPublicPrice: hit.currentListedPricePkr,
        currency: "PKR",
        availability: hit.availability,
        parseStatus: hit.parseStatus,
        evidence: {
          supplierProductId: hit.supplierProductId,
          supplierVariantId:
            typeof hit.rawEvidence.supplierVariantId === "string"
              ? hit.rawEvidence.supplierVariantId
              : mapping.supplierVariantId,
          supplierSku: hit.modelSku,
          normalizedExactModel: mapping.normalizedExactModel,
          supplierUrl: hit.canonicalUrl,
          source: SHOPIFY_STOREFRONT_PRODUCTS_JSON,
          confirmPriceRecommended: hit.confirmPriceRecommended,
          title: hit.title,
          brand: hit.brand,
          category: hit.category,
          compareAtPricePkr: hit.compareAtPricePkr,
          primaryImageUrl: hit.primaryImageUrl,
          additionalImageUrls: hit.additionalImageUrls,
          // Keep evidence compact — no full page bodies.
          evidenceSummary: {
            parseStatus: hit.parseStatus,
            availability: hit.availability,
            imageCount:
              (hit.primaryImageUrl ? 1 : 0) + hit.additionalImageUrls.length,
          },
        },
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "live fetch failed";
    const failureClass =
      /timeout/i.test(message)
        ? "timeout"
        : /unauthorized|401|403/i.test(message)
          ? "unauthorized"
          : "transport_error";
    return {
      ok: false,
      failureClass,
      message: `${code} live adapter error: ${message}`,
      mappingId: mapping.id,
      supplierCode: code,
      productId: mapping.productId,
      variantId: mapping.variantId,
    };
  }
}

function normalizeFixture(
  code: "kamal" | "alladin",
  mapping: SupplierMappingRow,
  fixture: ManualObservationInput,
): NormalizedSupplierObservation {
  const parseStatus = fixture.parseStatus ?? "ok";
  let price =
    fixture.supplierPublicPrice === undefined
      ? null
      : fixture.supplierPublicPrice;
  if (price !== null && (!Number.isFinite(price) || price <= 0)) {
    return {
      supplierCode: code,
      mappingId: mapping.id,
      productId: mapping.productId,
      variantId: mapping.variantId,
      observedAt: fixture.observedAt ?? new Date().toISOString(),
      supplierPublicPrice: price,
      currency: (fixture.currency || "PKR").toUpperCase(),
      availability: fixture.availability ?? "unknown",
      parseStatus: parseStatus === "ok" ? "malformed" : parseStatus,
      evidence: {
        supplierProductId: mapping.supplierProductId,
        supplierSku: mapping.supplierSku,
        normalizedExactModel: mapping.normalizedExactModel,
        supplierUrl: mapping.supplierUrl,
        source: "fixture_or_manual",
        confirmPriceRecommended: code === "kamal",
        ...fixture.evidence,
      },
    };
  }
  return {
    supplierCode: code,
    mappingId: mapping.id,
    productId: mapping.productId,
    variantId: mapping.variantId,
    observedAt: fixture.observedAt ?? new Date().toISOString(),
    supplierPublicPrice: price,
    currency: (fixture.currency || "PKR").toUpperCase(),
    availability: fixture.availability ?? "in_stock",
    parseStatus,
    evidence: {
      supplierProductId: mapping.supplierProductId,
      supplierSku: mapping.supplierSku,
      normalizedExactModel: mapping.normalizedExactModel,
      supplierUrl: mapping.supplierUrl,
      source: "fixture_or_manual",
      confirmPriceRecommended: code === "kamal",
      ...fixture.evidence,
    },
  };
}

export { normalizeFixture, fetchLiveObservation };
