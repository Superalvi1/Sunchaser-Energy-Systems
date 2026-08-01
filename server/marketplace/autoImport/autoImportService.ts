/**
 * CEO-authorized automatic supplier catalogue import.
 *
 * - Imports eligible Kamal + Alladin public Shopify catalogue variants
 * - Exact-match at variant identity level; uncertain → separate listings
 * - Publishes lowest valid listed price (no CEO discount)
 * - Does NOT use legacy mp_admin_upsert_supplier_mapping (WS-MAP-0 preserved)
 */
import { randomUUID } from "node:crypto";
import type { SupplierCode } from "../suppliers/adapterTypes.ts";
import {
  normalizeCatalogueProducts,
} from "../suppliers/catalogueNormalize.ts";
import type { CatalogueProductObservation } from "../suppliers/liveCatalogueTypes.ts";
import {
  fetchShopifyCatalogue,
  SHOPIFY_AUTO_IMPORT_MAX_PAGES,
  SHOPIFY_AUTO_IMPORT_MAX_PRODUCTS,
  type CatalogueFetchDeps,
  type ShopifyRawProduct,
} from "../suppliers/shopifyCatalogue.ts";
import {
  isDatabaseCatalogueSource,
  readMarketplaceConfig,
} from "../marketplaceConfig.ts";
import {
  buildVariantIdentity,
  exactIdentityKey,
  separateListingKey,
} from "./identityNormalize.ts";
import type {
  AutoImportListingRecord,
  AutoImportOffer,
  AutoImportSyncHealth,
  AutoImportSyncResult,
} from "./autoImportTypes.ts";
import type {
  AutoImportRepository,
  UpsertListingInput,
} from "./autoImportRepository.ts";
import { createAutoImportRepositoryFromEnv } from "./supabaseAutoImportRepository.ts";
import { isSupabaseActive } from "../../../dbManager.ts";
import {
  resolvePriceWithRollback,
  selectLowestValidPrice,
  type PricedOffer,
} from "./priceSelect.ts";
import { CEO_AUTO_IMPORT_JOB_NAME } from "./autoImportTypes.ts";
import { logAutoImport, sanitizeAutoImportError } from "./autoImportLog.ts";
import {
  AutoImportTimeoutError,
  resolveAutoImportTimeouts,
  withDeadline,
} from "./autoImportTimeouts.ts";

type PlanningLookup = {
  byKey: Map<string, AutoImportListingRecord>;
  byUrl: Map<string, AutoImportListingRecord>;
};

/** Process-wide lock so alias + admin mounts cannot run two imports at once. */
let activeImportRunId: string | null = null;

export type AutoImportServiceDeps = {
  repository?: AutoImportRepository;
  catalogueDeps?: CatalogueFetchDeps;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** Optional fixture observations (tests) — skips live fetch when provided. */
  fixtureObservations?: CatalogueProductObservation[];
  /** Inject logger (tests). */
  log?: typeof logAutoImport;
};

function isAutoImportEnabled(env: NodeJS.ProcessEnv): boolean {
  if (String(env.MARKETPLACE_ENABLED || "").toLowerCase() !== "true") {
    return false;
  }
  // CEO-authorized path: explicit enable, default true when unset in sync calls
  // that pass enabled env — require explicit true for safety.
  return (
    String(env.MARKETPLACE_CEO_AUTO_IMPORT_ENABLED || "").toLowerCase() ===
    "true"
  );
}

function toOffer(obs: CatalogueProductObservation): AutoImportOffer {
  const identity = buildVariantIdentity({
    title: obs.title,
    brand: obs.brand,
    modelSku: obs.modelSku,
    category: obs.category,
    productType:
      typeof obs.rawEvidence?.productType === "string"
        ? obs.rawEvidence.productType
        : obs.category,
  });
  const exact = exactIdentityKey(identity);
  const groupKey =
    exact ?? separateListingKey(obs.supplier, obs.sourceKey);
  return {
    supplier: obs.supplier,
    sourceKey: obs.sourceKey,
    supplierProductId: obs.supplierProductId,
    title: obs.title,
    brand: obs.brand,
    modelSku: obs.modelSku,
    category: obs.category,
    productType:
      typeof obs.rawEvidence?.productType === "string"
        ? obs.rawEvidence.productType
        : null,
    currentListedPricePkr: obs.currentListedPricePkr,
    parseStatus: obs.parseStatus,
    availability: obs.availability,
    canonicalUrl: obs.canonicalUrl,
    primaryImageUrl: obs.primaryImageUrl,
    description: obs.description,
    fetchedAt: obs.fetchedAt,
    identity,
    groupKey,
    matchReason: exact ? identity.matchReason : identity.matchReason,
  };
}

function rejectReason(obs: CatalogueProductObservation): string | null {
  if (obs.parseStatus !== "ok" || obs.currentListedPricePkr == null) {
    return "missing_or_invalid_price";
  }
  if (obs.currentListedPricePkr <= 0) return "missing_or_invalid_price";
  return null;
}

function emptyResult(
  runId: string,
  health: AutoImportSyncHealth,
  stages?: AutoImportSyncResult["stages"],
): AutoImportSyncResult {
  return {
    runId,
    status:
      health.lastSyncStatus === "never" ? "failed" : health.lastSyncStatus,
    health,
    sampleLowestPrice: [],
    stages: stages ?? {
      observationFetched: false,
      catalogueProductCreated: false,
      variantPriceStored: false,
      ceoListingImported: false,
      publicWebsiteVisible: false,
    },
    automaticPublication: true,
    ceoDiscountApplied: false,
    legacyMappingBypassUsed: false,
  };
}

function resolvePersistEnabled(env: NodeJS.ProcessEnv): boolean {
  return (
    String(env.MARKETPLACE_CEO_AUTO_IMPORT_PERSIST || "").toLowerCase() ===
    "true"
  );
}

function buildStages(input: {
  env: NodeJS.ProcessEnv;
  observationFetched: boolean;
  durableWrites: number;
}): AutoImportSyncResult["stages"] {
  const durablePersistActive =
    resolvePersistEnabled(input.env) && isSupabaseActive();
  const durable = durablePersistActive && input.durableWrites > 0;
  const publicVisible =
    durable && isDatabaseCatalogueSource(readMarketplaceConfig(input.env));
  return {
    observationFetched: input.observationFetched,
    catalogueProductCreated: durable,
    variantPriceStored: durable,
    ceoListingImported: durable,
    publicWebsiteVisible: publicVisible,
  };
}

export function createAutoImportService(deps: AutoImportServiceDeps = {}) {
  const env = deps.env ?? process.env;
  const repo = deps.repository ?? createAutoImportRepositoryFromEnv(env);
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? logAutoImport;
  const timeouts = resolveAutoImportTimeouts(env);
  const catalogueDeps: CatalogueFetchDeps = {
    maxPages: SHOPIFY_AUTO_IMPORT_MAX_PAGES,
    maxProducts: SHOPIFY_AUTO_IMPORT_MAX_PRODUCTS,
    ...deps.catalogueDeps,
    fetchOpts: {
      maxRetries: 1,
      ...deps.catalogueDeps?.fetchOpts,
    },
  };

  async function saveHealthSafe(
    runId: string,
    health: AutoImportSyncHealth,
    startedAt: number,
    originalFailure?: { errorClass: string; errorCode: string; message: string },
  ): Promise<void> {
    const remaining = Math.max(
      500,
      timeouts.jobTimeoutMs - (Date.now() - startedAt),
    );
    const budget = Math.min(timeouts.rpcTimeoutMs, remaining);
    try {
      await withDeadline(repo.saveHealth(health), budget, "auto-import-saveHealth");
    } catch (err) {
      const sanitized = sanitizeAutoImportError(err);
      log({
        runId,
        stage: "health_save_failed",
        elapsedMs: Date.now() - startedAt,
        status: "failed",
        errorClass: sanitized.errorClass,
        errorCode: sanitized.errorCode,
        detail: originalFailure
          ? `health_save_failed_after_${originalFailure.errorCode}:${sanitized.message}`
          : sanitized.message,
      });
      if (originalFailure) {
        // Keep the original failure visible in logs (do not hide it).
        log({
          runId,
          stage: "unexpected_error",
          elapsedMs: Date.now() - startedAt,
          status: "failed",
          errorClass: originalFailure.errorClass,
          errorCode: originalFailure.errorCode,
          detail: originalFailure.message,
        });
      }
    }
  }

  async function discoverSupplier(
    runId: string,
    supplier: SupplierCode,
    startedAt: number,
  ): Promise<{
    discovered: number;
    accepted: CatalogueProductObservation[];
    excluded: number;
    error?: string;
  }> {
    log({
      runId,
      stage: "supplier_fetch_start",
      supplier,
      elapsedMs: Date.now() - startedAt,
      status: "running",
    });
    try {
      const catalogue = await withDeadline(
        fetchShopifyCatalogue(supplier, catalogueDeps),
        timeouts.supplierTimeoutMs,
        `supplier:${supplier}`,
      );
      const { accepted, excluded } = normalizeCatalogueProducts(
        supplier,
        catalogue.products as ShopifyRawProduct[],
        now().toISOString(),
      );
      log({
        runId,
        stage: "supplier_fetch_done",
        supplier,
        elapsedMs: Date.now() - startedAt,
        status: "running",
        pagesFetched: catalogue.pagesFetched,
        discovered: catalogue.products.length,
        detail: `stop_${catalogue.stopReason}`,
      });
      return {
        discovered: catalogue.products.length,
        accepted,
        excluded: excluded.length,
      };
    } catch (err) {
      const sanitized = sanitizeAutoImportError(err);
      log({
        runId,
        stage: "supplier_fetch_failed",
        supplier,
        elapsedMs: Date.now() - startedAt,
        status: "failed",
        errorClass: sanitized.errorClass,
        errorCode: sanitized.errorCode,
        detail: sanitized.message,
      });
      return {
        discovered: 0,
        accepted: [],
        excluded: 0,
        error: `${supplier}_${sanitized.errorCode}:${sanitized.message}`.slice(
          0,
          200,
        ),
      };
    }
  }

  async function planAutomaticImport(input: {
    actorScope: string;
    runId: string;
    startedAt: number;
  }): Promise<
    | { kind: "complete"; result: AutoImportSyncResult }
    | {
        kind: "planned";
        runId: string;
        startedAt: number;
        observationsLen: number;
        acceptedOffersLen: number;
        kamalDiscovered: number;
        alladinDiscovered: number;
        rejectedVariants: number;
        exactGroupCount: number;
        separateGroupCount: number;
        lowestPriceSelections: number;
        rolledBackPrices: number;
        errors: string[];
        plannedInputs: UpsertListingInput[];
        sampleLowestPrice: AutoImportSyncResult["sampleLowestPrice"];
        provisionalStatus: AutoImportSyncResult["status"];
      }
  > {
    const { runId, startedAt } = input;

    if (!isAutoImportEnabled(env)) {
      log({
        runId,
        stage: "feature_gate",
        elapsedMs: Date.now() - startedAt,
        status: "failed",
        errorCode: "FEATURE_DISABLED",
        detail: "CEO auto-import disabled",
      });
      const health: AutoImportSyncHealth = {
        lastSyncAt: now().toISOString(),
        lastSyncStatus: "failed",
        lastRunId: runId,
        kamalDiscovered: 0,
        alladinDiscovered: 0,
        acceptedVariants: 0,
        rejectedVariants: 0,
        exactMatches: 0,
        conflictKeptSeparate: 0,
        productsCreated: 0,
        productsUpdated: 0,
        lowestPriceSelections: 0,
        rolledBackPrices: 0,
        errors: [
          "CEO auto-import disabled (MARKETPLACE_CEO_AUTO_IMPORT_ENABLED).",
        ],
        note: "Enable MARKETPLACE_ENABLED and MARKETPLACE_CEO_AUTO_IMPORT_ENABLED.",
      };
      await saveHealthSafe(runId, health, startedAt);
      return { kind: "complete", result: emptyResult(runId, health) };
    }

    // Defense: never touch legacy mapping RPC from this path.
    void input.actorScope;
    void CEO_AUTO_IMPORT_JOB_NAME;

    let kamalDiscovered = 0;
    let alladinDiscovered = 0;
    const errors: string[] = [];
    let observations: CatalogueProductObservation[] = [];
    const fetchStarted = Date.now();

    if (deps.fixtureObservations) {
      observations = deps.fixtureObservations;
      kamalDiscovered = observations.filter((o) => o.supplier === "kamal").length;
      alladinDiscovered = observations.filter((o) => o.supplier === "alladin")
        .length;
    } else {
      // Sequential discovery so one supplier's budget cannot starve the other
      // beyond its own supplierTimeoutMs, and total stays under jobTimeoutMs.
      const kamal = await discoverSupplier(runId, "kamal", startedAt);
      const alladin = await discoverSupplier(runId, "alladin", startedAt);
      kamalDiscovered = kamal.discovered;
      alladinDiscovered = alladin.discovered;
      if (kamal.error) errors.push(kamal.error);
      if (alladin.error) errors.push(alladin.error);
      observations = [...kamal.accepted, ...alladin.accepted];
    }
    const fetchMs = Date.now() - fetchStarted;

    // Normalize / reject invalid observations (in-memory only — no DB).
    const normalizeStarted = Date.now();
    const seenUrls = new Set<string>();
    let rejectedVariants = 0;
    const normalized: CatalogueProductObservation[] = [];
    for (const obs of observations) {
      const why = rejectReason(obs);
      if (why) {
        rejectedVariants += 1;
        continue;
      }
      const url = obs.canonicalUrl.trim().toLowerCase();
      if (seenUrls.has(url)) {
        rejectedVariants += 1;
        continue;
      }
      seenUrls.add(url);
      normalized.push(obs);
    }
    const normalizeMs = Date.now() - normalizeStarted;
    log({
      runId,
      stage: "normalize",
      elapsedMs: Date.now() - startedAt,
      status: "running",
      discovered: observations.length,
      normalizeMs,
      detail: deps.fixtureObservations
        ? "fixture_observations"
        : `accepted_${normalized.length}`,
    });

    // Shared planning context: ONE catalogue read, then deterministic in-memory
    // matching. Sequential per-listing getListingBySourceUrl/getListingByIdentityKey
    // previously burned the 55s job budget (N × rpcTimeoutMs) after fetch completed.
    const matchingStarted = Date.now();
    const lookup = await loadPlanningLookup(runId, startedAt);
    const acceptedOffers: AutoImportOffer[] = [];
    for (const obs of normalized) {
      const offer = toOffer(obs);
      const existingByUrl = lookup.byUrl.get(obs.canonicalUrl) ?? null;
      if (existingByUrl && existingByUrl.identityKey !== offer.groupKey) {
        rejectedVariants += 1;
        continue;
      }
      acceptedOffers.push(offer);
    }

    const groups = new Map<string, AutoImportOffer[]>();
    for (const offer of acceptedOffers) {
      const list = groups.get(offer.groupKey) || [];
      list.push(offer);
      groups.set(offer.groupKey, list);
    }
    const exactGroupCount = [...groups.keys()].filter(
      (k) => !k.startsWith("separate:"),
    ).length;
    const separateGroupCount = [...groups.keys()].filter((k) =>
      k.startsWith("separate:"),
    ).length;
    const matchingMs = Date.now() - matchingStarted;
    log({
      runId,
      stage: "matching",
      elapsedMs: Date.now() - startedAt,
      status: "running",
      matchingMs,
      discovered: acceptedOffers.length,
      detail: `groups_${groups.size}`,
    });

    // Deterministic price/identity planning (no AI model calls in this path).
    const planStarted = Date.now();
    type Planned = {
      input: UpsertListingInput;
      selectionOk: boolean;
      selection: ReturnType<typeof selectLowestValidPrice> | null;
    };
    const planned: Planned[] = [];
    let lowestPriceSelections = 0;
    let rolledBackPrices = 0;

    for (const [identityKey, offers] of groups) {
      const priced: PricedOffer[] = offers.map((o) => ({
        supplier: o.supplier,
        sourceKey: o.sourceKey,
        canonicalUrl: o.canonicalUrl,
        title: o.title,
        currentListedPricePkr: o.currentListedPricePkr,
        parseStatus: o.parseStatus,
        availability: o.availability,
        fetchedAt: o.fetchedAt,
      }));

      const selection = selectLowestValidPrice(priced);
      const previous = lookup.byKey.get(identityKey) ?? null;
      const resolved = resolvePriceWithRollback(
        selection,
        previous
          ? {
              pricePkr: previous.lastValidPricePkr,
              observedAt: previous.lastValidObservationAt,
              supplier: previous.lastValidSupplier,
            }
          : null,
      );

      if (resolved.pricePkr == null || !resolved.supplier) {
        rejectedVariants += offers.length;
        continue;
      }
      if (resolved.rolledBack) rolledBackPrices += 1;
      else if (selection.ok) {
        lowestPriceSelections += 1;
      }

      let availability = offers[0]!.availability;
      if (offers.some((o) => o.availability === "in_stock")) {
        availability = "in_stock";
      } else if (offers.every((o) => o.availability === "sold_out")) {
        availability = "sold_out";
      }

      const primary =
        offers.find((o) => o.supplier === resolved.supplier) ?? offers[0]!;
      planned.push({
        selectionOk: selection.ok,
        selection,
        input: {
          identityKey,
          title: primary.title,
          brandName: primary.brand || primary.identity.manufacturer || "Unknown",
          categoryName:
            primary.category || primary.identity.categoryFamily || "solar",
          websitePricePkr: resolved.pricePkr,
          availability,
          selectedSupplier: resolved.supplier,
          sourceUrls: offers.map((o) => o.canonicalUrl),
          matchReason: primary.matchReason,
          priceReason: resolved.reason,
          fetchedAt: now().toISOString(),
          previous,
          offers: offers.map((o) => ({
            supplier: o.supplier,
            pricePkr: o.currentListedPricePkr,
            url: o.canonicalUrl,
            availability: o.availability,
          })),
        },
      });
    }
    const planMs = Date.now() - planStarted;
    const aiPlanMs = 0; // AI kill-switch path: no model enrichment in CEO auto-import.
    log({
      runId,
      stage: "plan",
      elapsedMs: Date.now() - startedAt,
      status: "running",
      planMs,
      aiPlanMs,
      plannedUpserts: planned.length,
      detail: "deterministic_price_plan",
    });

    const totalMs = Date.now() - startedAt;
    log({
      runId,
      stage: "plan_phase_timing",
      elapsedMs: totalMs,
      status: "running",
      fetchMs,
      normalizeMs,
      matchingMs,
      aiPlanMs,
      planMs,
      totalMs,
      plannedUpserts: planned.length,
      detail: `lookup_keys_${lookup.byKey.size}`,
    });

    // Plan phase complete — return planned batch for atomic commit OUTSIDE
    // withDeadline so Promise.race never abandons in-flight catalogue writes.
    const sampleLowestPrice: AutoImportSyncResult["sampleLowestPrice"] = [];
    for (const item of planned) {
      if (
        item.selectionOk &&
        item.selection &&
        item.selection.ok &&
        sampleLowestPrice.length < 12
      ) {
        sampleLowestPrice.push({
          title: item.input.title,
          identityKey: item.input.identityKey,
          selectedSupplier: item.selection.supplier,
          pricePkr: item.selection.pricePkr,
          considered: item.selection.considered,
          reason: item.selection.reason,
        });
      }
    }

    const provisionalStatus: AutoImportSyncResult["status"] =
      errors.length === 0
        ? "succeeded"
        : planned.length > 0
          ? "partial"
          : "failed";

    return {
      kind: "planned" as const,
      runId,
      startedAt,
      observationsLen: observations.length,
      acceptedOffersLen: acceptedOffers.length,
      kamalDiscovered,
      alladinDiscovered,
      rejectedVariants,
      exactGroupCount,
      separateGroupCount,
      lowestPriceSelections,
      rolledBackPrices,
      errors: [...errors],
      plannedInputs: planned.map((p) => p.input),
      sampleLowestPrice,
      provisionalStatus,
    };
  }

  async function loadPlanningLookup(
    runId: string,
    startedAt: number,
  ): Promise<PlanningLookup> {
    const byKey = new Map<string, AutoImportListingRecord>();
    const byUrl = new Map<string, AutoImportListingRecord>();
    const remaining = Math.max(
      500,
      timeouts.jobTimeoutMs - (Date.now() - startedAt),
    );
    const budget = Math.min(timeouts.rpcTimeoutMs, remaining);
    try {
      const listings = await withDeadline(
        repo.listListings(),
        budget,
        "auto-import-plan-context",
      );
      for (const listing of listings) {
        byKey.set(listing.identityKey, listing);
        for (const url of listing.sourceUrls) {
          byUrl.set(url, listing);
        }
      }
    } catch (err) {
      if (err instanceof AutoImportTimeoutError) throw err;
      // Soft-fail like the previous per-row .catch(() => null) lookups.
      const sanitized = sanitizeAutoImportError(err);
      log({
        runId,
        stage: "matching",
        elapsedMs: Date.now() - startedAt,
        status: "running",
        errorCode: sanitized.errorCode,
        detail: `plan_context_empty:${sanitized.message}`,
      });
    }
    return { byKey, byUrl };
  }

  async function commitPlannedBatch(
    plan: Extract<
      Awaited<ReturnType<typeof planAutomaticImport>>,
      { kind: "planned" }
    >,
  ): Promise<AutoImportSyncResult> {
    const {
      runId,
      startedAt,
      errors,
      plannedInputs,
      sampleLowestPrice,
      provisionalStatus,
      kamalDiscovered,
      alladinDiscovered,
      rejectedVariants,
      exactGroupCount,
      separateGroupCount,
      lowestPriceSelections,
      rolledBackPrices,
      observationsLen,
      acceptedOffersLen,
    } = plan;

    log({
      runId,
      stage: "persist_start",
      elapsedMs: Date.now() - startedAt,
      status: "running",
      plannedUpserts: plannedInputs.length,
    });

    let productsCreated = 0;
    let productsUpdated = 0;

    const healthForCommit: AutoImportSyncHealth = {
      lastSyncAt: now().toISOString(),
      lastSyncStatus: provisionalStatus,
      lastRunId: runId,
      kamalDiscovered,
      alladinDiscovered,
      acceptedVariants: acceptedOffersLen,
      rejectedVariants,
      exactMatches: exactGroupCount,
      conflictKeptSeparate: separateGroupCount,
      productsCreated: 0,
      productsUpdated: 0,
      lowestPriceSelections,
      rolledBackPrices,
      errors: [...errors],
      note: "pending_atomic_commit",
    };

    try {
      // Single awaited transactional call — no Promise.race abandonment.
      // Timeout: SET LOCAL statement_timeout on direct Postgres before the RPC.
      const commit = await repo.commitBatch(plannedInputs, healthForCommit);
      productsCreated = commit.productsCreated;
      productsUpdated = commit.productsUpdated;
    } catch (err) {
      const sanitized = sanitizeAutoImportError(err);
      log({
        runId,
        stage: "persist_failed",
        elapsedMs: Date.now() - startedAt,
        status: "failed",
        errorClass: sanitized.errorClass,
        errorCode: sanitized.errorCode,
        detail: sanitized.message,
        plannedUpserts: plannedInputs.length,
      });
      errors.push(
        `persist_${sanitized.errorCode}:${sanitized.message}`.slice(0, 200),
      );
      const health: AutoImportSyncHealth = {
        lastSyncAt: now().toISOString(),
        lastSyncStatus: "failed",
        lastRunId: runId,
        kamalDiscovered,
        alladinDiscovered,
        acceptedVariants: acceptedOffersLen,
        rejectedVariants,
        exactMatches: exactGroupCount,
        conflictKeptSeparate: separateGroupCount,
        productsCreated: 0,
        productsUpdated: 0,
        lowestPriceSelections: 0,
        rolledBackPrices: 0,
        errors,
        note:
          "CEO auto-import aborted: atomic commit failed; no partial catalogue writes retained.",
      };
      await saveHealthSafe(runId, health, startedAt, sanitized);
      log({
        runId,
        stage: "run_complete",
        elapsedMs: Date.now() - startedAt,
        status: "failed",
        errorClass: sanitized.errorClass,
        errorCode: sanitized.errorCode,
      });
      return {
        runId,
        status: "failed",
        health,
        sampleLowestPrice: [],
        stages: buildStages({
          env,
          observationFetched: observationsLen > 0,
          durableWrites: 0,
        }),
        automaticPublication: true,
        ceoDiscountApplied: false,
        legacyMappingBypassUsed: false,
      };
    }

    log({
      runId,
      stage: "persist_done",
      elapsedMs: Date.now() - startedAt,
      status: "running",
      plannedUpserts: plannedInputs.length,
    });

    const status: AutoImportSyncResult["status"] =
      errors.length === 0
        ? "succeeded"
        : productsCreated + productsUpdated > 0
          ? "partial"
          : "failed";

    const stages = buildStages({
      env,
      observationFetched: observationsLen > 0 || acceptedOffersLen > 0,
      durableWrites: productsCreated + productsUpdated,
    });

    const health: AutoImportSyncHealth = {
      lastSyncAt: now().toISOString(),
      lastSyncStatus: status,
      lastRunId: runId,
      kamalDiscovered,
      alladinDiscovered,
      acceptedVariants: acceptedOffersLen,
      rejectedVariants,
      exactMatches: exactGroupCount,
      conflictKeptSeparate: separateGroupCount,
      productsCreated,
      productsUpdated,
      lowestPriceSelections,
      rolledBackPrices,
      errors,
      note: stages.publicWebsiteVisible
        ? "CEO auto-import persisted active priced catalogue rows; public website uses database catalogue source."
        : "CEO auto-import completed pipeline stages A–D as applicable. Public website visibility (stage E) requires MARKETPLACE_CATALOGUE_SOURCE=database and durable persist — sync success alone does not publish the storefront.",
    };
    await saveHealthSafe(runId, health, startedAt);

    log({
      runId,
      stage: "run_complete",
      elapsedMs: Date.now() - startedAt,
      status,
    });

    return {
      runId,
      status,
      health,
      sampleLowestPrice,
      stages,
      automaticPublication: true,
      ceoDiscountApplied: false,
      legacyMappingBypassUsed: false,
    };
  }

  async function runAutomaticImport(input: {
    actorScope: string;
  }): Promise<AutoImportSyncResult> {
    const runId = `mpair_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const startedAt = Date.now();

    if (activeImportRunId) {
      const health: AutoImportSyncHealth = {
        lastSyncAt: now().toISOString(),
        lastSyncStatus: "failed",
        lastRunId: runId,
        kamalDiscovered: 0,
        alladinDiscovered: 0,
        acceptedVariants: 0,
        rejectedVariants: 0,
        exactMatches: 0,
        conflictKeptSeparate: 0,
        productsCreated: 0,
        productsUpdated: 0,
        lowestPriceSelections: 0,
        rolledBackPrices: 0,
        errors: [
          `concurrent_run_blocked:active=${activeImportRunId}`.slice(0, 200),
        ],
        note: "Another auto-import run is already in progress.",
      };
      log({
        runId,
        stage: "feature_gate",
        status: "failed",
        errorCode: "CONCURRENT_RUN",
        detail: `blocked_by_${activeImportRunId}`,
      });
      return emptyResult(runId, health);
    }

    activeImportRunId = runId;
    log({
      runId,
      stage: "run_start",
      elapsedMs: 0,
      status: "running",
      detail: `jobTimeoutMs=${timeouts.jobTimeoutMs}`,
    });

    try {
      // Phase 1: fetch/normalize/plan under HTTP-safe deadline (no catalogue writes).
      const plan = await withDeadline(
        planAutomaticImport({ ...input, runId, startedAt }),
        timeouts.jobTimeoutMs,
        "auto-import-plan",
      );
      if (plan.kind === "complete") return plan.result;
      // Phase 2: one awaited transactional commit — never Promise.race-abandoned.
      return await commitPlannedBatch(plan);
    } catch (err) {
      const sanitized = sanitizeAutoImportError(err);
      const isTimeout =
        err instanceof AutoImportTimeoutError ||
        sanitized.errorCode === "TIMEOUT";
      log({
        runId,
        stage: isTimeout ? "job_timeout" : "unexpected_error",
        elapsedMs: Date.now() - startedAt,
        status: "failed",
        errorClass: sanitized.errorClass,
        errorCode: sanitized.errorCode,
        detail: sanitized.message,
      });
      const health: AutoImportSyncHealth = {
        lastSyncAt: now().toISOString(),
        lastSyncStatus: "failed",
        lastRunId: runId,
        kamalDiscovered: 0,
        alladinDiscovered: 0,
        acceptedVariants: 0,
        rejectedVariants: 0,
        exactMatches: 0,
        conflictKeptSeparate: 0,
        productsCreated: 0,
        productsUpdated: 0,
        lowestPriceSelections: 0,
        rolledBackPrices: 0,
        errors: [
          `${isTimeout ? "job_timeout" : "unexpected"}:${sanitized.message}`.slice(
            0,
            200,
          ),
        ],
        note: isTimeout
          ? "Auto-import exceeded plan-phase timeout before atomic commit; no catalogue writes started."
          : "Auto-import failed with an unexpected error.",
      };
      await saveHealthSafe(runId, health, startedAt, sanitized);
      return emptyResult(runId, health);
    } finally {
      if (activeImportRunId === runId) activeImportRunId = null;
    }
  }

  return {
    runAutomaticImport,
    getHealth: () => repo.getHealth(),
    listListings: () => repo.listListings(),
    repository: repo,
  };
}

export type AutoImportService = ReturnType<typeof createAutoImportService>;

/** Test helper — clear process-wide import lock. */
export function __resetAutoImportRunLockForTests(): void {
  activeImportRunId = null;
}
