/**
 * Kamal supplier adapter — live access disabled until authorized method confirmed.
 * Supports fixture/manual observation injection only.
 */
import type {
  AdapterFetchResult,
  SupplierAdapter,
  SupplierMappingRow,
  NormalizedSupplierObservation,
} from "./adapterTypes.ts";

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
} = {}): SupplierAdapter {
  const fixtures = deps.fixtures ?? new Map<string, ManualObservationInput>();

  return {
    code: "kamal",
    isLiveEnabled(env = deps.env ?? process.env): boolean {
      // Fail closed: never enable without explicit future authorized flag AND method.
      return (
        String(env.MARKETPLACE_WS4_KAMAL_LIVE_ENABLED || "").toLowerCase() ===
          "true" &&
        String(env.MARKETPLACE_WS4_KAMAL_AUTHORIZED_METHOD || "").trim()
          .length > 0
      );
    },
    async fetchObservation(mapping, opts): Promise<AdapterFetchResult> {
      const env = opts?.env ?? deps.env ?? process.env;
      if (this.isLiveEnabled(env)) {
        // Authorized live path is not implemented — no scraping / invented API.
        return {
          ok: false,
          failureClass: "not_configured",
          message:
            "Kamal live adapter authorized flag set but no authorized access method is implemented.",
          mappingId: mapping.id,
          supplierCode: "kamal",
          productId: mapping.productId,
          variantId: mapping.variantId,
        };
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
      ...fixture.evidence,
    },
  };
}

export { normalizeFixture };
