/**
 * WS4 supplier job / observation / alert repository (service_role RPCs only).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../../dbManager.ts";
import type { SupplierMappingRow, SupplierCode } from "./adapterTypes.ts";
import { SupplierError, type PriceAlertDto } from "./supplierTypes.ts";

export type SupplierActorRef = { id: string; username: string; role: string };

export type SupplierRepository = {
  listActiveMappings(actorScope: string): Promise<SupplierMappingRow[]>;
  getPricingConfig(): Promise<{
    maxIncreasePct: number;
    maxDecreasePct: number;
    stalenessHours: number;
  }>;
  getVariantWebsitePrice(variantId: string): Promise<number | null>;
  startJob(
    trigger: "manual" | "scheduled",
    actorScope: string,
    meta?: Record<string, unknown>,
  ): Promise<{ runId: string }>;
  finishJob(
    runId: string,
    status: "succeeded" | "failed",
    actorScope: string,
    error?: string | null,
    meta?: Record<string, unknown>,
  ): Promise<void>;
  insertObservation(input: {
    actorScope: string;
    mappingId: string;
    runId: string;
    observedAt: string;
    supplierPublicPrice: number | null;
    currency: string;
    availability: string;
    parseStatus: string;
    evidence: Record<string, unknown>;
  }): Promise<{ observationId: string; productId: string; variantId: string }>;
  createAlert(input: {
    actorScope: string;
    runId: string | null;
    productId: string | null;
    variantId: string | null;
    alertType: string;
    severity: string;
    message: string;
  }): Promise<{ alertId: string }>;
  listAlerts(actorScope: string, resolved?: boolean | null): Promise<PriceAlertDto[]>;
  publishPrice(variantId: string, actorScope: string, changedBy: string): Promise<{
    websitePriceState: string;
    websitePriceSource: string | null;
  }>;
  upsertMapping(
    input: {
      supplierCode: SupplierCode;
      productId: string;
      variantId: string;
      supplierProductId: string;
      supplierVariantId?: string;
      supplierSku?: string;
      normalizedExactModel: string;
      matchConfidence: string;
      matchLocked?: boolean;
      active?: boolean;
      supplierUrl?: string;
    },
    actorScope: string,
  ): Promise<{ mappingId: string; matchLocked: boolean }>;
};

function mapRpcError(err: unknown): SupplierError {
  const msg = err instanceof Error ? err.message : String(err);
  const upper = msg.toUpperCase();
  if (upper.includes("CONFLICT") || upper.includes("OVERLAPPING")) {
    return new SupplierError(409, "CONFLICT", "Overlapping job already running.");
  }
  if (upper.includes("EVIDENCE_BLOCKER")) {
    return new SupplierError(
      409,
      "EVIDENCE_BLOCKER",
      "Mapping remains locked until verified evidence is supplied.",
    );
  }
  if (upper.includes("JOB_NOT_FOUND") || upper.includes("MAPPING_NOT_FOUND")) {
    return new SupplierError(404, "NOT_FOUND", msg);
  }
  if (upper.includes("VALIDATION_ERROR") || upper.includes("INVALID")) {
    return new SupplierError(400, "VALIDATION_ERROR", msg);
  }
  return new SupplierError(500, "INTERNAL_ERROR", "Supplier request failed.");
}

async function rpc<T>(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw mapRpcError(error);
  return data as T;
}

export function createSupabaseSupplierRepository(
  client?: SupabaseClient,
): SupplierRepository {
  const getClient = () => {
    if (client) return client;
    if (!isSupabaseActive()) {
      throw new SupplierError(
        503,
        "MARKETPLACE_DISABLED",
        "Supabase persistence required for supplier ingestion.",
      );
    }
    return getSupabase();
  };

  return {
    async listActiveMappings(actorScope) {
      const data = await rpc<{ mappings: SupplierMappingRow[] }>(
        getClient(),
        "mp_ws4_list_mappings",
        { p_actor_scope: actorScope },
      );
      return (data.mappings || []).map((m) => ({
        ...m,
        matchEvidence: m.matchEvidence || {},
      }));
    },

    async getPricingConfig() {
      const c = getClient();
      const { data, error } = await c
        .from("mp_pricing_config")
        .select("max_increase_pct, max_decrease_pct, staleness_hours")
        .eq("company_id", "sunchaser")
        .maybeSingle();
      if (error) throw mapRpcError(error);
      return {
        maxIncreasePct: Number(data?.max_increase_pct ?? 15),
        maxDecreasePct: Number(data?.max_decrease_pct ?? 25),
        stalenessHours: Number(data?.staleness_hours ?? 36),
      };
    },

    async getVariantWebsitePrice(variantId) {
      const c = getClient();
      const { data, error } = await c
        .from("mp_product_variants")
        .select("website_price")
        .eq("id", variantId)
        .maybeSingle();
      if (error) throw mapRpcError(error);
      const n = data?.website_price;
      return n == null ? null : Number(n);
    },

    async startJob(trigger, actorScope, meta = {}) {
      const jobName =
        typeof meta.jobName === "string" && meta.jobName.trim()
          ? meta.jobName.trim()
          : "marketplace_supplier_price_check";
      const data = await rpc<{ runId?: string; ok?: boolean }>(
        getClient(),
        "mp_ws4_job_start",
        {
          p_actor_scope: actorScope,
          p_job_name: jobName,
          p_trigger: trigger,
          p_meta: meta,
        },
      );
      if (!data?.runId) {
        throw new SupplierError(500, "INTERNAL_ERROR", "Job start failed.");
      }
      return { runId: data.runId };
    },

    async finishJob(runId, status, actorScope, error = null, meta = {}) {
      await rpc(getClient(), "mp_ws4_job_finish", {
        p_actor_scope: actorScope,
        p_run_id: runId,
        p_status: status,
        p_error: error,
        p_meta: meta,
      });
    },

    async insertObservation(input) {
      const data = await rpc<{
        observationId: string;
        productId: string;
        variantId: string;
      }>(getClient(), "mp_ws4_insert_observation", {
        p_actor_scope: input.actorScope,
        p_supplier_product_id: input.mappingId,
        p_run_id: input.runId,
        p_observed_at: input.observedAt,
        p_supplier_public_price: input.supplierPublicPrice,
        p_currency: input.currency,
        p_availability: input.availability,
        p_parse_status: input.parseStatus,
        p_evidence: input.evidence,
      });
      return data;
    },

    async createAlert(input) {
      const data = await rpc<{ alertId: string }>(
        getClient(),
        "mp_ws4_create_alert",
        {
          p_actor_scope: input.actorScope,
          p_run_id: input.runId,
          p_product_id: input.productId,
          p_variant_id: input.variantId,
          p_alert_type: input.alertType,
          p_severity: input.severity,
          p_message: input.message,
        },
      );
      return { alertId: data.alertId };
    },

    async listAlerts(actorScope, resolved = null) {
      const data = await rpc<{ alerts: PriceAlertDto[] }>(
        getClient(),
        "mp_ws4_list_alerts",
        {
          p_actor_scope: actorScope,
          p_resolved: resolved,
          p_limit: 100,
        },
      );
      return data.alerts || [];
    },

    async publishPrice(variantId, actorScope, changedBy) {
      const data = await rpc<Record<string, unknown>>(
        getClient(),
        "mp_publish_price",
        {
          p_actor_scope: actorScope,
          p_variant_id: variantId,
          p_changed_by: changedBy,
        },
      );
      return {
        websitePriceState: String(
          data.websitePriceState || data.website_price_state || "confirm_price",
        ),
        websitePriceSource:
          (data.websitePriceSource as string | null) ??
          (data.website_price_source as string | null) ??
          null,
      };
    },

    async upsertMapping(_input, _actorScope) {
      // WS-MAP-0: repository path also fail-closed — never invoke legacy RPC.
      throw new SupplierError(
        410,
        "LEGACY_MAPPING_DISABLED",
        "Legacy supplier mapping is disabled.",
      );
    },
  };
}
