/**
 * Supabase/Postgres persistence for CEO auto-import via mp_ceo_auto_import_upsert_listing.
 * Requires scripts/marketplace-ceo-auto-import.sql applied manually.
 */
import { getSupabase, isSupabaseActive } from "../../../dbManager.ts";
import type { SupplierCode } from "../suppliers/adapterTypes.ts";
import type {
  AutoImportListingRecord,
  AutoImportSyncHealth,
} from "./autoImportTypes.ts";
import type { AutoImportRepository, UpsertListingInput } from "./autoImportRepository.ts";
import { createMemoryAutoImportRepository } from "./autoImportRepository.ts";

function requireClient() {
  if (!isSupabaseActive()) {
    throw new Error("Supabase is not configured for CEO auto-import.");
  }
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client unavailable.");
  return sb;
}

export function createSupabaseAutoImportRepository(): AutoImportRepository {
  // Health/listings cache in-process; durable rows live in Postgres.
  const memory = createMemoryAutoImportRepository();

  return {
    async getListingByIdentityKey(key) {
      const local = await memory.getListingByIdentityKey(key);
      if (local) return local;
      const sb = requireClient();
      const { data, error } = await sb
        .from("mp_auto_import_listings")
        .select("*")
        .eq("identity_key", key)
        .maybeSingle();
      if (error || !data) return null;
      return mapRow(data);
    },
    async getListingBySourceUrl(url) {
      const local = await memory.getListingBySourceUrl(url);
      if (local) return local;
      const sb = requireClient();
      const { data, error } = await sb
        .from("mp_auto_import_listings")
        .select("*")
        .contains("source_urls", [url])
        .limit(1);
      if (error || !data?.length) return null;
      return mapRow(data[0]);
    },
    async upsertListing(input) {
      const sb = requireClient();
      const { data, error } = await sb.rpc("mp_ceo_auto_import_upsert_listing", {
        p_actor_scope: "system:ceo-auto-import",
        p_identity_key: input.identityKey,
        p_title: input.title,
        p_brand_name: input.brandName,
        p_category_name: input.categoryName,
        p_website_price: input.websitePricePkr,
        p_availability: input.availability,
        p_selected_supplier: input.selectedSupplier,
        p_source_urls: input.sourceUrls,
        p_match_reason: input.matchReason,
        p_price_reason: input.priceReason,
        p_offers: input.offers,
        p_fetched_at: input.fetchedAt,
      });
      if (error) throw new Error(error.message || "auto-import upsert failed");
      const row = (data || {}) as Record<string, unknown>;
      const created = Boolean(row.created);
      const mem = await memory.upsertListing(input);
      return {
        created,
        record: {
          ...mem.record,
          productId: String(row.productId || mem.record.productId),
          variantId: String(row.variantId || mem.record.variantId),
          websitePricePkr: Number(row.websitePrice || mem.record.websitePricePkr),
        },
      };
    },
    async listListings() {
      const sb = requireClient();
      const { data, error } = await sb
        .from("mp_auto_import_listings")
        .select("*")
        .order("last_synced_at", { ascending: false })
        .limit(2000);
      if (error) throw new Error(error.message);
      return (data || []).map(mapRow);
    },
    async saveHealth(health) {
      await memory.saveHealth(health);
      try {
        const sb = requireClient();
        await sb.from("mp_auto_import_sync_runs").upsert({
          id: health.lastRunId || `mpair_unknown`,
          status: health.lastSyncStatus === "never" ? "failed" : health.lastSyncStatus,
          health,
        });
      } catch {
        // Health persistence is best-effort if table not yet applied.
      }
    },
    async getHealth() {
      return memory.getHealth();
    },
  };
}

function mapRow(data: any): AutoImportListingRecord {
  return {
    identityKey: String(data.identity_key),
    productId: String(data.product_id),
    variantId: String(data.variant_id),
    slug: String(data.slug || data.identity_key),
    title: String(data.title),
    brandName: String(data.brand_name),
    categoryName: String(data.category_name),
    websitePricePkr: Number(data.website_price),
    availability: data.availability,
    selectedSupplier: data.selected_supplier as SupplierCode,
    sourceUrls: Array.isArray(data.source_urls) ? data.source_urls : [],
    matchReason: String(data.match_reason || ""),
    priceReason: String(data.price_reason || ""),
    lastSyncedAt: String(data.last_synced_at),
    lastValidPricePkr: Number(data.last_valid_price),
    lastValidSupplier: data.last_valid_supplier as SupplierCode,
    lastValidObservationAt: String(data.last_valid_observation_at),
    active: Boolean(data.active),
    offers: Array.isArray(data.offers) ? data.offers : [],
  };
}

export function createAutoImportRepositoryFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AutoImportRepository {
  if (
    String(env.MARKETPLACE_CEO_AUTO_IMPORT_PERSIST || "").toLowerCase() ===
      "true" &&
    isSupabaseActive()
  ) {
    return createSupabaseAutoImportRepository();
  }
  return createMemoryAutoImportRepository();
}
