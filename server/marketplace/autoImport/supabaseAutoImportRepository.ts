/**
 * Supabase/Postgres persistence for CEO auto-import via
 * mp_ceo_auto_import_commit_batch (atomic transactional write).
 *
 * Durable commits use direct Postgres with:
 *   BEGIN; SET LOCAL statement_timeout; SELECT commit_batch(...); COMMIT;
 * PostgREST/supabase.rpc alone cannot apply a reliable per-call timeout.
 *
 * Requires scripts/marketplace-ceo-auto-import.sql +
 * scripts/marketplace-ceo-auto-import-atomic.sql applied manually, plus
 * DATABASE_URL or SUPABASE_DB_URL for timeout-protected commits.
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
import { commitBatchWithStatementTimeout } from "./autoImportPgCommit.ts";
import { hasAutoImportTimeoutProtection } from "./autoImportDbUrl.ts";
import {
  resolveAutoImportTimeouts,
  withDeadline,
} from "./autoImportTimeouts.ts";
import { logAutoImport, sanitizeAutoImportError } from "./autoImportLog.ts";
import {
  AUTO_IMPORT_LISTINGS_MAX_PAGES,
  AUTO_IMPORT_LISTINGS_PAGE_SIZE,
  fetchCompleteListingPages,
} from "./autoImportPlanningContext.ts";

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

export function createSupabaseAutoImportRepository(
  env: NodeJS.ProcessEnv = process.env,
): AutoImportRepository {
  // Local cache mirrors successful durable commits only.
  const memory = createMemoryAutoImportRepository();
  const { rpcTimeoutMs } = resolveAutoImportTimeouts(env);

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
      if (!hasAutoImportTimeoutProtection(env)) {
        throw new Error(
          "TIMEOUT_PROTECTION_ABSENT: durable auto-import requires DATABASE_URL or SUPABASE_DB_URL so SET LOCAL statement_timeout can cover mp_ceo_auto_import_commit_batch.",
        );
      }
      try {
        // Await fully — no Promise.race. SET LOCAL cancels the PG statement.
        const data = await commitBatchWithStatementTimeout({
          env,
          listings: inputs,
          health,
        });
        const mem = await memory.commitBatch(inputs, health);
        return {
          productsCreated: data.productsCreated,
          productsUpdated: data.productsUpdated,
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
      // Bounded pagination until a short page — never silently cap/truncate.
      return fetchCompleteListingPages({
        pageSize: AUTO_IMPORT_LISTINGS_PAGE_SIZE,
        maxPages: AUTO_IMPORT_LISTINGS_MAX_PAGES,
        fetchPage: async (offset, limit) => {
          const data = await rpcBounded(
            `auto-import listListings offset=${offset}`,
            sb
              .from("mp_auto_import_listings")
              .select("*")
              .order("identity_key", { ascending: true })
              .range(offset, offset + limit - 1),
            rpcTimeoutMs,
          );
          return (Array.isArray(data) ? data : []).map(mapRow);
        },
      });
    },
    async saveHealth(health) {
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
    lastValidSourceKey:
      data.last_valid_source_key != null &&
      String(data.last_valid_source_key).trim()
        ? String(data.last_valid_source_key).trim()
        : null,
    lastValidAvailability:
      data.last_valid_availability != null &&
      String(data.last_valid_availability).trim()
        ? (String(data.last_valid_availability) as AutoImportListingRecord["lastValidAvailability"])
        : null,
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
