/**
 * Alladin supplier adapter.
 * Live access: Shopify public storefront products.json (authorized).
 */
import type {
  AdapterFetchResult,
  SupplierAdapter,
} from "./adapterTypes.ts";
import {
  fetchLiveObservation,
  normalizeFixture,
  type ManualObservationInput,
} from "./kamalAdapter.ts";
import { isSupplierLiveConfigured } from "./liveSupplierConfig.ts";
import {
  fetchShopifyCatalogue,
  type CatalogueFetchDeps,
} from "./shopifyCatalogue.ts";

export function createAlladinAdapter(deps: {
  fixtures?: Map<string, ManualObservationInput>;
  env?: NodeJS.ProcessEnv;
  catalogueDeps?: CatalogueFetchDeps;
  catalogueCache?: Map<string, Awaited<ReturnType<typeof fetchShopifyCatalogue>>>;
} = {}): SupplierAdapter {
  const fixtures = deps.fixtures ?? new Map<string, ManualObservationInput>();
  const catalogueCache =
    deps.catalogueCache ??
    new Map<string, Awaited<ReturnType<typeof fetchShopifyCatalogue>>>();

  return {
    code: "alladin",
    isLiveEnabled(env = deps.env ?? process.env): boolean {
      return isSupplierLiveConfigured("alladin", env);
    },
    async fetchObservation(mapping, opts): Promise<AdapterFetchResult> {
      const env = opts?.env ?? deps.env ?? process.env;
      if (this.isLiveEnabled(env)) {
        return fetchLiveObservation("alladin", mapping, {
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
