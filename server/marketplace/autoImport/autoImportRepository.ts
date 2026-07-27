/**
 * Catalogue persistence for CEO auto-import.
 * Memory implementation for tests; SQL-backed path for production sync.
 */
import { randomUUID } from "node:crypto";
import type { SupplierCode } from "../suppliers/adapterTypes.ts";
import type {
  AutoImportListingRecord,
  AutoImportSyncHealth,
} from "./autoImportTypes.ts";

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
};

export type AutoImportRepository = {
  getListingByIdentityKey(key: string): Promise<AutoImportListingRecord | null>;
  getListingBySourceUrl(url: string): Promise<AutoImportListingRecord | null>;
  upsertListing(
    input: UpsertListingInput,
  ): Promise<{ record: AutoImportListingRecord; created: boolean }>;
  /**
   * Best-effort removal of listings written during a failed run.
   * Memory: hard delete. Supabase: soft best-effort (may be no-op if SQL not applied).
   */
  deleteListings(identityKeys: string[]): Promise<void>;
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

export function createMemoryAutoImportRepository(): AutoImportRepository {
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

  return {
    async getListingByIdentityKey(key) {
      return byKey.get(key) ?? null;
    },
    async getListingBySourceUrl(url) {
      const key = urlIndex.get(url);
      return key ? byKey.get(key) ?? null : null;
    },
    async upsertListing(input) {
      const prev = input.previous ?? byKey.get(input.identityKey) ?? null;
      const created = !prev;
      const productId = prev?.productId ?? `mpprod_auto_${randomUUID().slice(0, 8)}`;
      const variantId = prev?.variantId ?? `mpvar_auto_${randomUUID().slice(0, 8)}`;
      const slug = prev?.slug ?? slugify(input.title, input.identityKey);
      const record: AutoImportListingRecord = {
        identityKey: input.identityKey,
        productId,
        variantId,
        slug,
        title: input.title,
        brandName: input.brandName,
        categoryName: input.categoryName,
        websitePricePkr: input.websitePricePkr,
        availability: input.availability,
        selectedSupplier: input.selectedSupplier,
        sourceUrls: [...new Set(input.sourceUrls)],
        matchReason: input.matchReason,
        priceReason: input.priceReason,
        lastSyncedAt: input.fetchedAt,
        lastValidPricePkr: input.websitePricePkr,
        lastValidSupplier: input.selectedSupplier,
        lastValidObservationAt: input.fetchedAt,
        active: input.availability !== "sold_out",
        offers: input.offers,
      };
      // Preserve last-valid if this upsert is a rollback (priceReason starts with rollback)
      if (prev && input.priceReason.startsWith("rollback_")) {
        record.lastValidPricePkr = prev.lastValidPricePkr;
        record.lastValidSupplier = prev.lastValidSupplier;
        record.lastValidObservationAt = prev.lastValidObservationAt;
        record.websitePricePkr = prev.lastValidPricePkr;
      }
      byKey.set(input.identityKey, record);
      for (const u of record.sourceUrls) urlIndex.set(u, input.identityKey);
      return { record, created };
    },
    async deleteListings(identityKeys) {
      for (const key of identityKeys) {
        const existing = byKey.get(key);
        if (!existing) continue;
        byKey.delete(key);
        for (const [url, mapped] of [...urlIndex.entries()]) {
          if (mapped === key) urlIndex.delete(url);
        }
        void existing;
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
