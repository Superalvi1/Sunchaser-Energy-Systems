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
import type { AutoImportRepository } from "./autoImportRepository.ts";
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

export type AutoImportServiceDeps = {
  repository?: AutoImportRepository;
  catalogueDeps?: CatalogueFetchDeps;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** Optional fixture observations (tests) — skips live fetch when provided. */
  fixtureObservations?: CatalogueProductObservation[];
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

export function createAutoImportService(deps: AutoImportServiceDeps = {}) {
  const env = deps.env ?? process.env;
  const repo = deps.repository ?? createAutoImportRepositoryFromEnv(env);
  const now = deps.now ?? (() => new Date());

  async function discoverSupplier(
    supplier: SupplierCode,
  ): Promise<{
    discovered: number;
    accepted: CatalogueProductObservation[];
    excluded: number;
    error?: string;
  }> {
    try {
      const catalogue = await fetchShopifyCatalogue(supplier, deps.catalogueDeps);
      const { accepted, excluded } = normalizeCatalogueProducts(
        supplier,
        catalogue.products as ShopifyRawProduct[],
        now().toISOString(),
      );
      return {
        discovered: catalogue.products.length,
        accepted,
        excluded: excluded.length,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "supplier_fetch_failed";
      return {
        discovered: 0,
        accepted: [],
        excluded: 0,
        error: `${supplier}_timeout_or_error:${message}`.slice(0, 200),
      };
    }
  }

  async function runAutomaticImport(input: {
    actorScope: string;
  }): Promise<AutoImportSyncResult> {
    const runId = `mpair_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    if (!isAutoImportEnabled(env)) {
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
        errors: ["CEO auto-import disabled (MARKETPLACE_CEO_AUTO_IMPORT_ENABLED)."],
        note: "Enable MARKETPLACE_ENABLED and MARKETPLACE_CEO_AUTO_IMPORT_ENABLED.",
      };
      await repo.saveHealth(health);
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
      alladinDiscovered = observations.filter((o) => o.supplier === "alladin").length;
    } else {
      const kamal = await discoverSupplier("kamal");
      const alladin = await discoverSupplier("alladin");
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

    let productsCreated = 0;
    let productsUpdated = 0;
    let lowestPriceSelections = 0;
    let rolledBackPrices = 0;
    const sampleLowestPrice: AutoImportSyncResult["sampleLowestPrice"] = [];

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
      else if (selection.ok && selection.considered.length > 1) {
        lowestPriceSelections += 1;
      } else if (selection.ok) {
        lowestPriceSelections += 1;
      }

      // Availability: if any offer in_stock → in_stock; else if all sold_out → sold_out
      let availability = offers[0]!.availability;
      if (offers.some((o) => o.availability === "in_stock")) {
        availability = "in_stock";
      } else if (offers.every((o) => o.availability === "sold_out")) {
        availability = "sold_out";
      }

      const primary = offers.find((o) => o.supplier === resolved.supplier) ?? offers[0]!;
      const { created } = await repo.upsertListing({
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
      });
      if (created) productsCreated += 1;
      else productsUpdated += 1;

      if (selection.ok && sampleLowestPrice.length < 12) {
        sampleLowestPrice.push({
          title: primary.title,
          identityKey,
          selectedSupplier: selection.supplier,
          pricePkr: selection.pricePkr,
          considered: selection.considered,
          reason: selection.reason,
        });
      }
    }

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
    await repo.saveHealth(health);

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

  return {
    runAutomaticImport,
    getHealth: () => repo.getHealth(),
    listListings: () => repo.listListings(),
    repository: repo,
  };
}

export type AutoImportService = ReturnType<typeof createAutoImportService>;
