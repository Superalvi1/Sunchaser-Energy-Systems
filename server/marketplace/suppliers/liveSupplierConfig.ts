/**
 * Live supplier configuration helpers (fail-closed).
 */
import type { SupplierCode } from "./adapterTypes.ts";
import { SHOPIFY_STOREFRONT_PRODUCTS_JSON } from "./liveCatalogueTypes.ts";

export function readAuthorizedMethod(
  env: NodeJS.ProcessEnv,
  supplier: SupplierCode,
): string {
  const key =
    supplier === "kamal"
      ? "MARKETPLACE_WS4_KAMAL_AUTHORIZED_METHOD"
      : "MARKETPLACE_WS4_ALLADIN_AUTHORIZED_METHOD";
  return String(env[key] || "").trim();
}

export function isSupplierLiveConfigured(
  supplier: SupplierCode,
  env: NodeJS.ProcessEnv,
): boolean {
  const enabledKey =
    supplier === "kamal"
      ? "MARKETPLACE_WS4_KAMAL_LIVE_ENABLED"
      : "MARKETPLACE_WS4_ALLADIN_LIVE_ENABLED";
  const enabled = String(env[enabledKey] || "").toLowerCase() === "true";
  const method = readAuthorizedMethod(env, supplier);
  return enabled && method === SHOPIFY_STOREFRONT_PRODUCTS_JSON;
}

/** Phase 1: scheduled publication stays disabled even if live flags are set. */
export function isScheduledPublicationAllowed(env: NodeJS.ProcessEnv): boolean {
  return (
    String(env.MARKETPLACE_WS4_LIVE_PUBLICATION_ENABLED || "").toLowerCase() ===
      "true" &&
    String(env.MARKETPLACE_WS4_PHASE1_PREVIEW_ONLY || "true").toLowerCase() !==
      "true"
  );
}
