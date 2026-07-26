/**
 * Alladin supplier adapter — live access disabled until authorized method confirmed.
 */
import type {
  AdapterFetchResult,
  SupplierAdapter,
  SupplierMappingRow,
} from "./adapterTypes.ts";
import {
  normalizeFixture,
  type ManualObservationInput,
} from "./kamalAdapter.ts";

export function createAlladinAdapter(deps: {
  fixtures?: Map<string, ManualObservationInput>;
  env?: NodeJS.ProcessEnv;
} = {}): SupplierAdapter {
  const fixtures = deps.fixtures ?? new Map<string, ManualObservationInput>();

  return {
    code: "alladin",
    isLiveEnabled(env = deps.env ?? process.env): boolean {
      return (
        String(env.MARKETPLACE_WS4_ALLADIN_LIVE_ENABLED || "").toLowerCase() ===
          "true" &&
        String(env.MARKETPLACE_WS4_ALLADIN_AUTHORIZED_METHOD || "").trim()
          .length > 0
      );
    },
    async fetchObservation(mapping, opts): Promise<AdapterFetchResult> {
      const env = opts?.env ?? deps.env ?? process.env;
      if (this.isLiveEnabled(env)) {
        return {
          ok: false,
          failureClass: "not_configured",
          message:
            "Alladin live adapter authorized flag set but no authorized access method is implemented.",
          mappingId: mapping.id,
          supplierCode: "alladin",
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
            "Alladin live adapter disabled; no fixture/manual observation provided. Manual-only mode is insufficient for production.",
          mappingId: mapping.id,
          supplierCode: "alladin",
          productId: mapping.productId,
          variantId: mapping.variantId,
        };
      }

      return {
        ok: true,
        observation: normalizeFixture("alladin", mapping, fixture),
      };
    },
  };
}

export type { ManualObservationInput };
