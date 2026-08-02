/**
 * Read-only CEO auto-import production preflight.
 * Never imports products, never writes catalogue rows, never changes prices.
 * Never calls mp_ceo_auto_import_upsert_listing / commit_batch.
 */
import { getSupabase, isSupabaseActive } from "../../../dbManager.ts";
import {
  publicWouldShowSyncedProducts,
  readMarketplaceConfig,
} from "../marketplaceConfig.ts";
import { resolvePublicCataloguePublication } from "../catalogue/resolveCatalogueRepository.ts";
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
import { hasAutoImportTimeoutProtection } from "./autoImportDbUrl.ts";

export type PreflightPresence = "present" | "absent" | "unknown" | "skipped";
export type PreflightReachability = "reachable" | "unreachable" | "skipped";

export type AutoImportPreflightReport = {
  checkedAt: string;
  marketplaceEnabled: boolean;
  autoImportEnabled: boolean;
  persistenceEnabled: boolean;
  catalogueSource: "static" | "database";
  /** Effective source used by createCatalogueRouter (fail-closed). */
  effectivePublicCatalogueSource: "static" | "database";
  /** True only when effective public source is database. */
  publicWouldShowSyncedProducts: boolean;
  supabaseConfigured: boolean;
  objects: {
    tableMpAutoImportListings: PreflightPresence;
    tableMpAutoImportSyncRuns: PreflightPresence;
    rpcMpCeoAutoImportUpsertListing: PreflightPresence;
    rpcMpCeoAutoImportCommitBatch: PreflightPresence;
    rpcMpCeoAutoImportPreflight: PreflightPresence;
    /** Direct-Postgres SET LOCAL statement_timeout path available? */
    timeoutProtection: PreflightPresence;
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
  /** Injected table probe for tests (must be SELECT-only). */
  probeTable?: (table: string) => Promise<PreflightPresence>;
  /**
   * Injected RPC presence probe for tests.
   * Must NOT call upsert/commit write RPCs.
   */
  probeRpcCatalog?: () => Promise<{
    preflight: PreflightPresence;
    upsert: PreflightPresence;
    commitBatch: PreflightPresence;
  }>;
  /** Injected supplier reachability for tests. */
  probeSupplier?: (
    origin: string,
  ) => Promise<{ status: PreflightReachability; detail?: string }>;
  /** Optional observer for tests asserting zero write-capable calls. */
  onRpcCall?: (name: string) => void;
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
 * Probe RPC catalog via dedicated READ-ONLY preflight function only.
 * Never invokes upsert_listing or commit_batch.
 */
async function defaultProbeRpcCatalog(
  onRpcCall?: (name: string) => void,
): Promise<{
  preflight: PreflightPresence;
  upsert: PreflightPresence;
  commitBatch: PreflightPresence;
}> {
  if (!isSupabaseActive()) {
    return { preflight: "skipped", upsert: "skipped", commitBatch: "skipped" };
  }
  const sb = getSupabase();
  if (!sb) {
    return { preflight: "skipped", upsert: "skipped", commitBatch: "skipped" };
  }
  try {
    onRpcCall?.("mp_ceo_auto_import_preflight");
    const { data, error } = await withDeadline(
      Promise.resolve(sb.rpc("mp_ceo_auto_import_preflight")),
      8_000,
      "preflight-rpc-readonly",
    );
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (
        msg.includes("could not find the function") ||
        msg.includes("does not exist") ||
        msg.includes("pgrst202") ||
        msg.includes("schema cache")
      ) {
        // Cannot safely verify upsert/batch without write probes → unknown.
        return {
          preflight: "absent",
          upsert: "unknown",
          commitBatch: "unknown",
        };
      }
      return {
        preflight: "unknown",
        upsert: "unknown",
        commitBatch: "unknown",
      };
    }
    const row = (data || {}) as {
      tables?: Record<string, string>;
      functions?: Record<string, string>;
    };
    const fn = row.functions || {};
    const asPresence = (v: unknown): PreflightPresence =>
      v === "present" || v === "absent" ? v : "unknown";
    return {
      preflight: "present",
      upsert: asPresence(fn.mp_ceo_auto_import_upsert_listing),
      commitBatch: asPresence(fn.mp_ceo_auto_import_commit_batch),
    };
  } catch (err) {
    const sanitized = sanitizeAutoImportError(err);
    if (/does not exist|could not find|pgrst202/i.test(sanitized.message)) {
      return {
        preflight: "absent",
        upsert: "unknown",
        commitBatch: "unknown",
      };
    }
    return {
      preflight: "unknown",
      upsert: "unknown",
      commitBatch: "unknown",
    };
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
    const parsed = JSON.parse(res.body);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.products)) {
      return {
        status: "unreachable",
        detail: "unexpected_json_shape",
      };
    }
    return {
      status: "reachable",
      detail: sanitizeLogText(
        `http_${res.status}_products_${parsed.products.length}`,
        80,
      ),
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
  const probeRpcCatalog =
    deps.probeRpcCatalog ??
    (() => defaultProbeRpcCatalog(deps.onRpcCall));
  const probeSupplier = deps.probeSupplier ?? defaultProbeSupplier;

  const [listings, syncRuns, rpcCatalog, kamal, alladin] = await Promise.all([
    probeTable("mp_auto_import_listings"),
    probeTable("mp_auto_import_sync_runs"),
    probeRpcCatalog(),
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
    notes.push(
      "Table mp_auto_import_sync_runs is absent (health durability degraded)",
    );
  }
  if (persistenceEnabled && rpcCatalog.commitBatch === "absent") {
    blockers.push("RPC mp_ceo_auto_import_commit_batch is absent");
  }
  if (persistenceEnabled && rpcCatalog.commitBatch === "unknown") {
    notes.push(
      "RPC mp_ceo_auto_import_commit_batch presence unknown (apply marketplace-ceo-auto-import-atomic.sql and preflight RPC).",
    );
  }
  if (persistenceEnabled && rpcCatalog.preflight === "absent") {
    notes.push(
      "Read-only preflight RPC absent — apply marketplace-ceo-auto-import-atomic.sql; upsert presence reported as unknown without write probes.",
    );
  }

  const timeoutProtection: PreflightPresence = !persistenceEnabled
    ? "skipped"
    : hasAutoImportTimeoutProtection(env)
      ? "present"
      : "absent";

  if (persistenceEnabled && timeoutProtection === "absent") {
    blockers.push(
      "Timeout protection absent: set DATABASE_URL or SUPABASE_DB_URL so durable commits can SET LOCAL statement_timeout before mp_ceo_auto_import_commit_batch",
    );
  }
  if (persistenceEnabled && timeoutProtection === "present") {
    notes.push(
      "Timeout protection: direct Postgres SET LOCAL statement_timeout before atomic commit_batch (in-RPC set_config is ineffective).",
    );
  }
  if (kamal.status === "unreachable") {
    blockers.push("Kamal supplier feed unreachable");
  }
  if (alladin.status === "unreachable") {
    blockers.push("Alladin supplier feed unreachable");
  }
  if (cfg.catalogueSource !== "database") {
    notes.push(
      "Effective public catalogue source is static (fail-closed). CEO sync may still persist mp_* rows, but createCatalogueRouter serves WS1 seed only — synced products are not publicly exposed until MARKETPLACE_CATALOGUE_SOURCE=database.",
    );
  } else {
    notes.push(
      "Effective public catalogue source is database — public /api/marketplace/catalogue/* reads mp_products.",
    );
  }

  const canPersist =
    persistenceEnabled &&
    supabaseConfigured &&
    rpcCatalog.commitBatch === "present" &&
    listings === "present" &&
    timeoutProtection === "present";

  const publication = resolvePublicCataloguePublication(env);

  return {
    checkedAt: now().toISOString(),
    marketplaceEnabled: cfg.enabled,
    autoImportEnabled,
    persistenceEnabled,
    catalogueSource: cfg.catalogueSource,
    effectivePublicCatalogueSource: publication.effectivePublicCatalogueSource,
    publicWouldShowSyncedProducts: publication.publicWouldShowSyncedProducts,
    supabaseConfigured,
    objects: {
      tableMpAutoImportListings: listings,
      tableMpAutoImportSyncRuns: syncRuns,
      rpcMpCeoAutoImportUpsertListing: rpcCatalog.upsert,
      rpcMpCeoAutoImportCommitBatch: rpcCatalog.commitBatch,
      rpcMpCeoAutoImportPreflight: rpcCatalog.preflight,
      timeoutProtection,
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
      publicWebsiteWouldShowSyncedProducts: publicWouldShowSyncedProducts(cfg),
    },
    blockers,
    notes,
  };
}
