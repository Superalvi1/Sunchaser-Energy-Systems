/**
 * Read-only CEO auto-import production preflight.
 * Never imports products, never writes catalogue rows, never changes prices.
 */
import { getSupabase, isSupabaseActive } from "../../../dbManager.ts";
import {
  isDatabaseCatalogueSource,
  readMarketplaceConfig,
} from "../marketplaceConfig.ts";
import {
  DEFAULT_RESPONSE_TIMEOUT_MS,
  safeFetchText,
} from "../suppliers/safeHttp.ts";
import { SHOPIFY_SUPPLIERS } from "../suppliers/shopifyCatalogue.ts";
import { sanitizeAutoImportError, sanitizeLogText } from "./autoImportLog.ts";
import {
  resolveAutoImportTimeouts,
  withDeadline,
} from "./autoImportTimeouts.ts";

export type PreflightPresence = "present" | "absent" | "unknown" | "skipped";
export type PreflightReachability = "reachable" | "unreachable" | "skipped";

export type AutoImportPreflightReport = {
  checkedAt: string;
  marketplaceEnabled: boolean;
  autoImportEnabled: boolean;
  persistenceEnabled: boolean;
  catalogueSource: "static" | "database";
  supabaseConfigured: boolean;
  objects: {
    tableMpAutoImportListings: PreflightPresence;
    tableMpAutoImportSyncRuns: PreflightPresence;
    rpcMpCeoAutoImportUpsertListing: PreflightPresence;
  };
  suppliers: {
    kamal: { origin: string; status: PreflightReachability; detail?: string };
    alladin: { origin: string; status: PreflightReachability; detail?: string };
  };
  /** Honest stage readiness — sync ≠ public storefront visibility. */
  stages: {
    canFetchSupplierObservations: boolean;
    canPersistCatalogueProducts: boolean;
    canStoreVariantPrices: boolean;
    canImportCeoListings: boolean;
    publicWebsiteWouldShowSyncedProducts: boolean;
  };
  blockers: string[];
  notes: string[];
};

export type AutoImportPreflightDeps = {
  env?: NodeJS.ProcessEnv;
  /** Injected table probe for tests. */
  probeTable?: (table: string) => Promise<PreflightPresence>;
  /** Injected RPC probe for tests. */
  probeRpc?: () => Promise<PreflightPresence>;
  /** Injected supplier reachability for tests. */
  probeSupplier?: (
    origin: string,
  ) => Promise<{ status: PreflightReachability; detail?: string }>;
  now?: () => Date;
};

async function defaultProbeTable(table: string): Promise<PreflightPresence> {
  if (!isSupabaseActive()) return "skipped";
  const sb = getSupabase();
  if (!sb) return "skipped";
  const column =
    table === "mp_auto_import_listings" ? "identity_key" : "id";
  try {
    const { error } = await withDeadline(
      Promise.resolve(
        sb.from(table).select(column, { count: "exact", head: true }).limit(1),
      ),
      8_000,
      `preflight-table:${table}`,
    );
    if (!error) return "present";
    const msg = String(error.message || "").toLowerCase();
    if (
      msg.includes("does not exist") ||
      msg.includes("could not find") ||
      msg.includes("schema cache") ||
      msg.includes("42p01")
    ) {
      return "absent";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Probe RPC without writing: invalid actor_scope fails validation before inserts.
 * Missing function → absent. Validation/check violation → present.
 */
async function defaultProbeRpc(): Promise<PreflightPresence> {
  if (!isSupabaseActive()) return "skipped";
  const sb = getSupabase();
  if (!sb) return "skipped";
  try {
    const { error } = await withDeadline(
      Promise.resolve(
        sb.rpc("mp_ceo_auto_import_upsert_listing", {
          p_actor_scope: "preflight:probe",
          p_identity_key: "preflight",
          p_title: "preflight",
          p_brand_name: "preflight",
          p_category_name: "solar",
          p_website_price: 1,
          p_availability: "unknown",
          p_selected_supplier: "kamal",
          p_source_urls: [],
          p_match_reason: "preflight",
          p_price_reason: "preflight",
          p_offers: [],
          p_fetched_at: new Date().toISOString(),
        }),
      ),
      8_000,
      "preflight-rpc",
    );
    if (!error) {
      // Unexpected success — treat as present but note anomaly (should not write with bad scope).
      return "present";
    }
    const msg = String(error.message || "").toLowerCase();
    if (
      msg.includes("could not find the function") ||
      msg.includes("does not exist") ||
      msg.includes("pgrst202") ||
      msg.includes("schema cache")
    ) {
      return "absent";
    }
    // Validation / permission / check_violation ⇒ function exists.
    return "present";
  } catch (err) {
    const sanitized = sanitizeAutoImportError(err);
    if (/does not exist|could not find|pgrst202/i.test(sanitized.message)) {
      return "absent";
    }
    return "unknown";
  }
}

async function defaultProbeSupplier(
  origin: string,
): Promise<{ status: PreflightReachability; detail?: string }> {
  try {
    const url = `${origin.replace(/\/$/, "")}/products.json?limit=1&page=1`;
    const res = await withDeadline(
      safeFetchText(url, {
        timeoutMs: Math.min(DEFAULT_RESPONSE_TIMEOUT_MS, 12_000),
        maxRetries: 0,
        maxBytes: 500_000,
      }),
      15_000,
      `preflight-supplier:${origin}`,
    );
    // Confirm JSON shape without retaining body.
    const parsed = JSON.parse(res.body);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.products)) {
      return {
        status: "unreachable",
        detail: "unexpected_json_shape",
      };
    }
    return {
      status: "reachable",
      detail: sanitizeLogText(`http_${res.status}_products_${parsed.products.length}`, 80),
    };
  } catch (err) {
    const sanitized = sanitizeAutoImportError(err);
    return {
      status: "unreachable",
      detail: `${sanitized.errorCode}:${sanitized.message}`.slice(0, 120),
    };
  }
}

export async function runAutoImportPreflight(
  deps: AutoImportPreflightDeps = {},
): Promise<AutoImportPreflightReport> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const cfg = readMarketplaceConfig(env);
  const autoImportEnabled =
    cfg.enabled &&
    String(env.MARKETPLACE_CEO_AUTO_IMPORT_ENABLED || "").toLowerCase() ===
      "true";
  const persistenceEnabled =
    String(env.MARKETPLACE_CEO_AUTO_IMPORT_PERSIST || "").toLowerCase() ===
      "true";
  const supabaseConfigured = isSupabaseActive();
  void resolveAutoImportTimeouts(env);

  const probeTable = deps.probeTable ?? defaultProbeTable;
  const probeRpc = deps.probeRpc ?? defaultProbeRpc;
  const probeSupplier = deps.probeSupplier ?? defaultProbeSupplier;

  const [listings, syncRuns, rpc, kamal, alladin] = await Promise.all([
    probeTable("mp_auto_import_listings"),
    probeTable("mp_auto_import_sync_runs"),
    probeRpc(),
    probeSupplier(SHOPIFY_SUPPLIERS.kamal.origin),
    probeSupplier(SHOPIFY_SUPPLIERS.alladin.origin),
  ]);

  const blockers: string[] = [];
  const notes: string[] = [];

  if (!cfg.enabled) blockers.push("MARKETPLACE_ENABLED is not true");
  if (!autoImportEnabled) {
    blockers.push("MARKETPLACE_CEO_AUTO_IMPORT_ENABLED is not true");
  }
  if (!persistenceEnabled) {
    notes.push(
      "Persistence disabled (MARKETPLACE_CEO_AUTO_IMPORT_PERSIST≠true): sync uses in-memory store only.",
    );
  }
  if (persistenceEnabled && !supabaseConfigured) {
    blockers.push("Persistence enabled but Supabase is not configured");
  }
  if (persistenceEnabled && listings === "absent") {
    blockers.push("Table mp_auto_import_listings is absent");
  }
  if (persistenceEnabled && syncRuns === "absent") {
    notes.push("Table mp_auto_import_sync_runs is absent (health durability degraded)");
  }
  if (persistenceEnabled && rpc === "absent") {
    blockers.push("RPC mp_ceo_auto_import_upsert_listing is absent");
  }
  if (kamal.status === "unreachable") {
    blockers.push("Kamal supplier feed unreachable");
  }
  if (alladin.status === "unreachable") {
    blockers.push("Alladin supplier feed unreachable");
  }
  if (cfg.catalogueSource !== "database") {
    notes.push(
      "MARKETPLACE_CATALOGUE_SOURCE is not database — synced products will not appear on the public website until catalogue source is database.",
    );
  }

  const canPersist =
    persistenceEnabled &&
    supabaseConfigured &&
    rpc === "present" &&
    listings === "present";

  return {
    checkedAt: now().toISOString(),
    marketplaceEnabled: cfg.enabled,
    autoImportEnabled,
    persistenceEnabled,
    catalogueSource: cfg.catalogueSource,
    supabaseConfigured,
    objects: {
      tableMpAutoImportListings: listings,
      tableMpAutoImportSyncRuns: syncRuns,
      rpcMpCeoAutoImportUpsertListing: rpc,
    },
    suppliers: {
      kamal: {
        origin: SHOPIFY_SUPPLIERS.kamal.origin,
        status: kamal.status,
        detail: kamal.detail,
      },
      alladin: {
        origin: SHOPIFY_SUPPLIERS.alladin.origin,
        status: alladin.status,
        detail: alladin.detail,
      },
    },
    stages: {
      canFetchSupplierObservations:
        kamal.status === "reachable" || alladin.status === "reachable",
      canPersistCatalogueProducts: canPersist,
      canStoreVariantPrices: canPersist,
      canImportCeoListings: canPersist,
      publicWebsiteWouldShowSyncedProducts:
        canPersist && isDatabaseCatalogueSource(cfg),
    },
    blockers,
    notes,
  };
}
