/**
 * Catalogue persistence for CEO auto-import.
 * Memory implementation for tests; SQL-backed path for production sync.
 *
 * Durable writes must go through commitBatch (atomic). No compensating
 * deletes of shared catalogue rows — failed commits restore a snapshot.
 */
import { randomUUID } from "node:crypto";
import type { SupplierCode } from "../suppliers/adapterTypes.ts";
import type {
  AutoImportListingRecord,
  AutoImportSyncHealth,
} from "./autoImportTypes.ts";

export type MemoryAutoImportRepositoryOptions = {
  /**
   * Test hook: mutable ref. When `n` is a number, throw after that many
   * successful writes inside the next commitBatch (then restore snapshot).
   */
  failAfterNWrites?: { n: number | null };
};

export type UpsertListingInput = {
  identityKey: string;
  title: string;
  brandName: string;
  categoryName: string;
  websitePricePkr: number;
  availability: AutoImportListingRecord["availability"];
  selectedSupplier: SupplierCode;
  sourceUrls: string[];
  matchReason: string;
  priceReason: string;
  fetchedAt: string;
  offers: AutoImportListingRecord["offers"];
  previous: AutoImportListingRecord | null;
  /** Existing-listing daily sync: update price provenance only; never create. */
  priceOnly?: boolean;
  /** Deterministic default-offer identity (sourceKey) chosen after price planning. */
  defaultSourceKey?: string;
  /** Sanitized supplier images for the selected commercial offer only. */
  images?: Array<{ url: string; sortOrder: number; isPrimary: boolean }>;
  /** Attached by attachDefaultVariants before commitBatch. */
  defaultVariant?: {
    isDefault: boolean;
    active: boolean;
    stockStatus: AutoImportListingRecord["availability"];
    selectedSupplier: SupplierCode;
    sourceKey: string;
  };
};

export type CommitBatchResult = {
  productsCreated: number;
  productsUpdated: number;
  records: AutoImportListingRecord[];
};

export type AutoImportRepository = {
  getListingByIdentityKey(key: string): Promise<AutoImportListingRecord | null>;
  getListingBySourceUrl(url: string): Promise<AutoImportListingRecord | null>;
  /**
   * Atomic commit of the full planned batch + health.
   * On failure, no partial writes remain (memory snapshot restore / PG transaction).
   */
  commitBatch(
    inputs: UpsertListingInput[],
    health: AutoImportSyncHealth,
  ): Promise<CommitBatchResult>;
  listListings(): Promise<AutoImportListingRecord[]>;
  saveHealth(health: AutoImportSyncHealth): Promise<void>;
  getHealth(): Promise<AutoImportSyncHealth>;
};

function slugify(title: string, identityKey: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const suffix = identityKey.replace(/[^a-z0-9]+/gi, "").slice(-8).toLowerCase();
  return `${base || "product"}-${suffix || randomUUID().slice(0, 8)}`;
}

function cloneRecord(r: AutoImportListingRecord): AutoImportListingRecord {
  return {
    ...r,
    sourceUrls: [...r.sourceUrls],
    offers: r.offers.map((o) => ({ ...o })),
  };
}

export function createMemoryAutoImportRepository(
  opts: MemoryAutoImportRepositoryOptions = {},
): AutoImportRepository {
  const byKey = new Map<string, AutoImportListingRecord>();
  const urlIndex = new Map<string, string>();
  let health: AutoImportSyncHealth = {
    lastSyncAt: null,
    lastSyncStatus: "never",
    lastRunId: null,
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
    errors: [],
    note: "No sync yet.",
  };

  function upsertOne(input: UpsertListingInput): {
    record: AutoImportListingRecord;
    created: boolean;
  } {
    const prev = input.previous ?? byKey.get(input.identityKey) ?? null;
    if (input.priceOnly && !prev) {
      throw new Error("PRICE_ONLY_REQUIRES_EXISTING_LISTING");
    }
    const created = !prev;
    const productId = prev?.productId ?? `mpprod_auto_${randomUUID().slice(0, 8)}`;
    const variantId = prev?.variantId ?? `mpvar_auto_${randomUUID().slice(0, 8)}`;
    const slug = prev?.slug ?? slugify(input.title, input.identityKey);
    const isRollback =
      Boolean(prev) && input.priceReason.startsWith("rollback_");
    const record: AutoImportListingRecord = {
      identityKey: input.identityKey,
      productId,
      variantId,
      slug,
      title: input.priceOnly && prev ? prev.title : input.title,
      brandName: input.priceOnly && prev ? prev.brandName : input.brandName,
      categoryName:
        input.priceOnly && prev ? prev.categoryName : input.categoryName,
      websitePricePkr: input.websitePricePkr,
      availability:
        input.priceOnly && prev ? prev.availability : input.availability,
      selectedSupplier: input.selectedSupplier,
      sourceUrls: [...new Set(input.sourceUrls)],
      matchReason: input.matchReason,
      priceReason: input.priceReason,
      lastSyncedAt: input.fetchedAt,
      lastValidPricePkr: input.websitePricePkr,
      lastValidSupplier: input.selectedSupplier,
      lastValidObservationAt: input.fetchedAt,
      lastValidSourceKey:
        input.defaultSourceKey?.trim() || prev?.lastValidSourceKey || null,
      lastValidAvailability:
        input.priceOnly && prev
          ? prev.lastValidAvailability
          : input.availability,
      active:
        input.priceOnly && prev ? prev.active : input.availability !== "sold_out",
      offers: input.offers,
    };
    if (isRollback && prev) {
      record.lastValidPricePkr = prev.lastValidPricePkr;
      record.lastValidSupplier = prev.lastValidSupplier;
      record.lastValidObservationAt = prev.lastValidObservationAt;
      record.lastValidSourceKey = prev.lastValidSourceKey;
      record.lastValidAvailability = prev.lastValidAvailability;
      record.websitePricePkr = prev.lastValidPricePkr;
    }
    byKey.set(input.identityKey, record);
    for (const u of record.sourceUrls) urlIndex.set(u, input.identityKey);
    return { record, created };
  }

  return {
    async getListingByIdentityKey(key) {
      return byKey.get(key) ?? null;
    },
    async getListingBySourceUrl(url) {
      const key = urlIndex.get(url);
      return key ? byKey.get(key) ?? null : null;
    },
    async commitBatch(inputs, nextHealth) {
      // Snapshot for atomic memory rollback (no compensating deletes of shared rows).
      const keySnap = new Map(
        [...byKey.entries()].map(([k, v]) => [k, cloneRecord(v)]),
      );
      const urlSnap = new Map(urlIndex);
      const healthSnap = {
        ...health,
        errors: [...health.errors],
      };
      try {
        // Validate first (fail closed before mutating).
        const seen = new Set<string>();
        for (const input of inputs) {
          if (!input.identityKey?.trim()) {
            throw new Error("VALIDATION_ERROR: identityKey required");
          }
          if (seen.has(input.identityKey)) {
            throw new Error(
              `VALIDATION_ERROR: duplicate identityKey in batch: ${input.identityKey}`,
            );
          }
          seen.add(input.identityKey);
          if (!(input.websitePricePkr > 0)) {
            throw new Error("VALIDATION_ERROR: websitePricePkr must be positive");
          }
          if (
            input.priceOnly &&
            !byKey.has(input.identityKey) &&
            !input.previous
          ) {
            throw new Error("PRICE_ONLY_REQUIRES_EXISTING_LISTING");
          }
          // When planner attached defaultVariant, enforce the same invariant as PG.
          if (input.defaultVariant) {
            const dv = input.defaultVariant;
            if (dv.isDefault !== true || dv.active !== true) {
              throw new Error(
                "DEFAULT_VARIANT_REQUIRED: product must have exactly one active default variant",
              );
            }
          }
        }
        let productsCreated = 0;
        let productsUpdated = 0;
        const records: AutoImportListingRecord[] = [];
        for (const input of inputs) {
          if (
            opts.failAfterNWrites?.n != null &&
            productsCreated + productsUpdated >= opts.failAfterNWrites.n
          ) {
            throw new Error(
              "TEST_ATOMIC_FAIL: simulated mid-batch write failure",
            );
          }
          const { record, created } = upsertOne(input);
          if (created) productsCreated += 1;
          else productsUpdated += 1;
          records.push(record);
        }
        health = nextHealth;
        return { productsCreated, productsUpdated, records };
      } catch (err) {
        byKey.clear();
        for (const [k, v] of keySnap) byKey.set(k, v);
        urlIndex.clear();
        for (const [k, v] of urlSnap) urlIndex.set(k, v);
        health = healthSnap;
        throw err;
      }
    },
    async listListings() {
      return [...byKey.values()];
    },
    async saveHealth(next) {
      health = next;
    },
    async getHealth() {
      return { ...health, errors: [...health.errors] };
    },
  };
}
