/**
 * Supabase/Postgres persistence for CEO auto-import via
 * mp_ceo_auto_import_commit_batch (atomic transactional write).
 * Requires scripts/marketplace-ceo-auto-import.sql +
 * scripts/marketplace-ceo-auto-import-atomic.sql applied manually.
 */
import { getSupabase, isSupabaseActive } from "../../../dbManager.ts";
import type { SupplierCode } from "../suppliers/adapterTypes.ts";
import type {
  AutoImportListingRecord,
  AutoImportSyncHealth,
} from "./autoImportTypes.ts";
import type {
  AutoImportRepository,
  CommitBatchResult,
  UpsertListingInput,
} from "./autoImportRepository.ts";
import { createMemoryAutoImportRepository } from "./autoImportRepository.ts";
import {
  resolveAutoImportTimeouts,
  withDeadline,
} from "./autoImportTimeouts.ts";
import { logAutoImport, sanitizeAutoImportError } from "./autoImportLog.ts";

function requireClient() {
  if (!isSupabaseActive()) {
    throw new Error("Supabase is not configured for CEO auto-import.");
  }
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client unavailable.");
  return sb;
}

async function rpcBounded<T>(
  label: string,
  work: PromiseLike<{ data: T; error: { message?: string } | null }>,
  timeoutMs: number,
): Promise<T> {
  const { data, error } = await withDeadline(Promise.resolve(work), timeoutMs, label);
  if (error) throw new Error(error.message || `${label} failed`);
  return data;
}

function listingPayload(input: UpsertListingInput) {
  return {
    identityKey: input.identityKey,
    title: input.title,
    brandName: input.brandName,
    categoryName: input.categoryName,
    websitePricePkr: input.websitePricePkr,
    availability: input.availability,
    selectedSupplier: input.selectedSupplier,
    sourceUrls: input.sourceUrls,
    matchReason: input.matchReason,
    priceReason: input.priceReason,
    offers: input.offers,
    fetchedAt: input.fetchedAt,
  };
}

export function createSupabaseAutoImportRepository(
  env: NodeJS.ProcessEnv = process.env,
): AutoImportRepository {
  // Local cache mirrors successful durable commits only.
  const memory = createMemoryAutoImportRepository();
  const { rpcTimeoutMs } = resolveAutoImportTimeouts(env);
  // Leave headroom under HTTP job budget; PG statement_timeout cancels the txn.
  const batchTimeoutMs = Math.max(5_000, Math.min(rpcTimeoutMs * 3, 50_000));

  return {
    async getListingByIdentityKey(key) {
      const local = await memory.getListingByIdentityKey(key);
      if (local) return local;
      const sb = requireClient();
      const data = await rpcBounded(
        "auto-import getListingByIdentityKey",
        sb
          .from("mp_auto_import_listings")
          .select("*")
          .eq("identity_key", key)
          .maybeSingle(),
        rpcTimeoutMs,
      ).catch(() => null);
      if (!data) return null;
      return mapRow(data);
    },
    async getListingBySourceUrl(url) {
      const local = await memory.getListingBySourceUrl(url);
      if (local) return local;
      const sb = requireClient();
      const data = await rpcBounded(
        "auto-import getListingBySourceUrl",
        sb
          .from("mp_auto_import_listings")
          .select("*")
          .contains("source_urls", [url])
          .limit(1),
        rpcTimeoutMs,
      ).catch(() => null as unknown as unknown[] | null);
      if (!data || !Array.isArray(data) || !data.length) return null;
      return mapRow(data[0]);
    },
    async commitBatch(inputs, health): Promise<CommitBatchResult> {
      const sb = requireClient();
      try {
        // Await the single transactional RPC fully — do NOT Promise.race/abandon.
        // PostgreSQL statement_timeout (set inside the RPC) cancels the txn.
        const { data, error } = await sb.rpc("mp_ceo_auto_import_commit_batch", {
          p_actor_scope: "system:ceo-auto-import",
          p_run_id: health.lastRunId || `mpair_unknown`,
          p_listings: inputs.map(listingPayload),
          p_health: health,
          p_statement_timeout_ms: batchTimeoutMs,
        });
        if (error) {
          throw new Error(error.message || "mp_ceo_auto_import_commit_batch failed");
        }
        const row = (data || {}) as Record<string, unknown>;
        const productsCreated = Number(row.productsCreated || 0);
        const productsUpdated = Number(row.productsUpdated || 0);
        // Mirror into memory only after durable commit succeeded.
        const mem = await memory.commitBatch(inputs, health);
        return {
          productsCreated,
          productsUpdated,
          records: mem.records,
        };
      } catch (err) {
        const sanitized = sanitizeAutoImportError(err);
        logAutoImport({
          runId: health.lastRunId || "rpc",
          stage: "rpc_failed",
          status: "failed",
          errorClass: sanitized.errorClass,
          errorCode: sanitized.errorCode,
          detail: sanitized.message,
        });
        throw err;
      }
    },
    async listListings() {
      const sb = requireClient();
      const data = await rpcBounded(
        "auto-import listListings",
        sb
          .from("mp_auto_import_listings")
          .select("*")
          .order("last_synced_at", { ascending: false })
          .limit(2000),
        rpcTimeoutMs,
      );
      return (Array.isArray(data) ? data : []).map(mapRow);
    },
    async saveHealth(health) {
      // Prefer recording health via commit_batch; standalone save is best-effort.
      await memory.saveHealth(health);
      try {
        const sb = requireClient();
        await withDeadline(
          Promise.resolve(
            sb.from("mp_auto_import_sync_runs").upsert({
              id: health.lastRunId || `mpair_unknown`,
              status:
                health.lastSyncStatus === "never"
                  ? "failed"
                  : health.lastSyncStatus,
              health,
            }),
          ),
          rpcTimeoutMs,
          "auto-import saveHealth",
        );
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
    return createSupabaseAutoImportRepository(env);
  }
  return createMemoryAutoImportRepository();
}
