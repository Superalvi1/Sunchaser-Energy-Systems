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
  type CatalogueFetchDeps,
  type ShopifyRawProduct,
} from "../suppliers/shopifyCatalogue.ts";
import {
  buildVariantIdentity,
  exactIdentityKey,
  separateListingKey,
} from "./identityNormalize.ts";
import type {
  AutoImportRepository,
  UpsertListingInput,
} from "./autoImportRepository.ts";
import { createAutoImportRepositoryFromEnv } from "./supabaseAutoImportRepository.ts";
import {
  resolvePriceWithRollback,
  selectLowestValidPrice,
  type PricedOffer,
} from "./priceSelect.ts";
import type {
  AutoImportOffer,
  AutoImportSyncHealth,
  AutoImportSyncResult,
} from "./autoImportTypes.ts";
import { CEO_AUTO_IMPORT_JOB_NAME } from "./autoImportTypes.ts";
import { logAutoImport, sanitizeAutoImportError } from "./autoImportLog.ts";
import {
  AutoImportTimeoutError,
  resolveAutoImportTimeouts,
  withDeadline,
} from "./autoImportTimeouts.ts";

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
): AutoImportSyncResult {
  return {
    runId,
    status:
      health.lastSyncStatus === "never" ? "failed" : health.lastSyncStatus,
    health,
    sampleLowestPrice: [],
    automaticPublication: true,
    ceoDiscountApplied: false,
    legacyMappingBypassUsed: false,
  };
}

export function createAutoImportService(deps: AutoImportServiceDeps = {}) {
  const env = deps.env ?? process.env;
  const repo = deps.repository ?? createAutoImportRepositoryFromEnv(env);
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? logAutoImport;
  const timeouts = resolveAutoImportTimeouts(env);

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
        fetchShopifyCatalogue(supplier, deps.catalogueDeps),
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

  async function runAutomaticImportInner(input: {
    actorScope: string;
    runId: string;
    startedAt: number;
  }): Promise<AutoImportSyncResult> {
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
      return emptyResult(runId, health);
    }

    // Defense: never touch legacy mapping RPC from this path.
    void input.actorScope;
    void CEO_AUTO_IMPORT_JOB_NAME;

    let kamalDiscovered = 0;
    let alladinDiscovered = 0;
    const errors: string[] = [];
    let observations: CatalogueProductObservation[] = [];

    if (deps.fixtureObservations) {
      observations = deps.fixtureObservations;
      kamalDiscovered = observations.filter((o) => o.supplier === "kamal").length;
      alladinDiscovered = observations.filter((o) => o.supplier === "alladin")
        .length;
      log({
        runId,
        stage: "normalize",
        elapsedMs: Date.now() - startedAt,
        status: "running",
        discovered: observations.length,
        detail: "fixture_observations",
      });
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

    // Duplicate URL rejection (per URL globally for import set)
    const seenUrls = new Set<string>();
    let rejectedVariants = 0;
    const acceptedOffers: AutoImportOffer[] = [];

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
      // Also reject if URL already owned by a different identity listing
      const existingByUrl = await repo.getListingBySourceUrl(obs.canonicalUrl);
      const offer = toOffer(obs);
      if (existingByUrl && existingByUrl.identityKey !== offer.groupKey) {
        rejectedVariants += 1;
        continue;
      }
      seenUrls.add(url);
      acceptedOffers.push(offer);
    }

    // Group by identity key
    const groups = new Map<string, AutoImportOffer[]>();
    for (const offer of acceptedOffers) {
      const list = groups.get(offer.groupKey) || [];
      list.push(offer);
      groups.set(offer.groupKey, list);
    }
    // Count cross-supplier exact groups (not offers)
    const exactGroupCount = [...groups.keys()].filter(
      (k) => !k.startsWith("separate:"),
    ).length;
    const separateGroupCount = [...groups.keys()].filter((k) =>
      k.startsWith("separate:"),
    ).length;

    // Phase 1: plan all upserts (no persistence yet).
    type Planned = {
      input: UpsertListingInput;
      selectionOk: boolean;
      selection:
        | ReturnType<typeof selectLowestValidPrice>
        | null;
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
      const previous = await repo.getListingByIdentityKey(identityKey);
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

    log({
      runId,
      stage: "persist_start",
      elapsedMs: Date.now() - startedAt,
      status: "running",
      plannedUpserts: planned.length,
    });

    let productsCreated = 0;
    let productsUpdated = 0;
    const sampleLowestPrice: AutoImportSyncResult["sampleLowestPrice"] = [];
    /** Only newly created identity keys — never roll back pre-existing listings. */
    const createdKeysThisRun: string[] = [];

    try {
      for (const item of planned) {
        const { created } = await repo.upsertListing(item.input);
        if (created) {
          createdKeysThisRun.push(item.input.identityKey);
          productsCreated += 1;
        } else {
          productsUpdated += 1;
        }

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
        plannedUpserts: planned.length,
      });
      // Roll back only listings created in this run; never delete pre-existing.
      try {
        await repo.deleteListings(createdKeysThisRun);
        log({
          runId,
          stage: "persist_rollback",
          elapsedMs: Date.now() - startedAt,
          status: "failed",
          detail: `rolled_back_created_${createdKeysThisRun.length}`,
        });
      } catch (rollbackErr) {
        const rb = sanitizeAutoImportError(rollbackErr);
        log({
          runId,
          stage: "persist_rollback",
          elapsedMs: Date.now() - startedAt,
          status: "failed",
          errorClass: rb.errorClass,
          errorCode: rb.errorCode,
          detail: rb.message,
        });
        // Original persist failure remains primary — logged above and in errors[].
      }
      errors.push(
        `persist_${sanitized.errorCode}:${sanitized.message}`.slice(0, 200),
      );
      const health: AutoImportSyncHealth = {
        lastSyncAt: now().toISOString(),
        lastSyncStatus: "failed",
        lastRunId: runId,
        kamalDiscovered,
        alladinDiscovered,
        acceptedVariants: acceptedOffers.length,
        rejectedVariants,
        exactMatches: exactGroupCount,
        conflictKeptSeparate: separateGroupCount,
        productsCreated: 0,
        productsUpdated: 0,
        lowestPriceSelections: 0,
        rolledBackPrices: 0,
        errors,
        note:
          "CEO auto-import aborted during persistence; attempted rollback of this run's newly created listings only.",
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
      plannedUpserts: planned.length,
    });

    const status: AutoImportSyncResult["status"] =
      errors.length === 0
        ? "succeeded"
        : productsCreated + productsUpdated > 0
          ? "partial"
          : "failed";

    const health: AutoImportSyncHealth = {
      lastSyncAt: now().toISOString(),
      lastSyncStatus: status,
      lastRunId: runId,
      kamalDiscovered,
      alladinDiscovered,
      acceptedVariants: acceptedOffers.length,
      rejectedVariants,
      exactMatches: exactGroupCount,
      conflictKeptSeparate: separateGroupCount,
      productsCreated,
      productsUpdated,
      lowestPriceSelections,
      rolledBackPrices,
      errors,
      note:
        "CEO auto-import: public listed price published as website price; no purchasing discount; WS-MAP-0 legacy mapping unused.",
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
    log({
      runId,
      stage: "run_start",
      elapsedMs: 0,
      status: "running",
      detail: `jobTimeoutMs=${timeouts.jobTimeoutMs}`,
    });

    try {
      return await withDeadline(
        runAutomaticImportInner({ ...input, runId, startedAt }),
        timeouts.jobTimeoutMs,
        "auto-import-job",
      );
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
          ? "Auto-import job exceeded bounded timeout and failed safely."
          : "Auto-import failed with an unexpected error.",
      };
      await saveHealthSafe(runId, health, startedAt, sanitized);
      return emptyResult(runId, health);
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
