/**
 * WS3 pricing repository — Super-Admin commercial operations via transactional RPCs.
 * Does not set mp.allow_price_write in the application session.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../../dbManager.ts";
import {
  PricingError,
  type CostDto,
  type MappingResultDto,
  type MarginDto,
  type OverrideResultDto,
  type PricingActorRef,
  type PricingConfigDto,
  type PublishResultDto,
} from "./pricingTypes.ts";

export type PricingRepository = {
  listCosts(variantId?: string): Promise<CostDto[]>;
  createCost(
    input: {
      variantId: string;
      productId?: string;
      actualPurchaseCost: number;
      currency: string;
      effectiveAt?: string;
      reason: string | null;
    },
    actor: PricingActorRef,
  ): Promise<CostDto>;
  updateCost(
    id: string,
    patch: {
      actualPurchaseCost?: number;
      currency?: string;
      effectiveAt?: string;
      reason?: string;
    },
    actor: PricingActorRef,
  ): Promise<CostDto>;
  getMargin(variantId: string): Promise<MarginDto>;
  publishPrice(variantId: string, actor: PricingActorRef): Promise<PublishResultDto>;
  createOverride(
    input: {
      variantId: string;
      productId?: string;
      overridePrice: number;
      mode: "permanent" | "time_limited";
      endsAt: string | null;
      reason: string;
    },
    actor: PricingActorRef,
  ): Promise<OverrideResultDto>;
  revokeOverride(overrideId: string, actor: PricingActorRef): Promise<OverrideResultDto>;
  getPricingConfig(): Promise<PricingConfigDto>;
  updatePricingConfig(
    patch: Record<string, number | boolean | null | undefined>,
    actor: PricingActorRef,
  ): Promise<PricingConfigDto>;
  upsertSupplierMapping(
    input: {
      supplierCode: "kamal" | "alladin";
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
    actor: PricingActorRef,
  ): Promise<MappingResultDto>;
};

const ERROR_CODES = [
  "PRODUCT_NOT_FOUND",
  "VARIANT_NOT_FOUND",
  "COST_NOT_FOUND",
  "DUPLICATE_COST",
  "INVALID_MAPPING",
  "AMBIGUOUS_MAPPING",
  "INVALID_PRICE",
  "STALE_SUPPLIER_DATA",
  "SUPPLIER_PARSE_FAILED",
  "STOCK_NOT_ELIGIBLE",
  "OVERRIDE_CONFLICT",
  "OVERRIDE_NOT_FOUND",
  "CONFIRM_PRICE_REQUIRED",
  "FORBIDDEN_FIELD",
  "UNKNOWN_FIELD",
  "VALIDATION_ERROR",
  "CONFLICT",
  "INTERNAL_ERROR",
] as const;

function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code === "CONFLICT" || code === "OVERRIDE_CONFLICT") return 409;
  if (code === "INTERNAL_ERROR") return 500;
  return 400;
}

function mapRpcError(err: { message?: string } | null): PricingError {
  const raw = String(err?.message || "");
  for (const code of ERROR_CODES) {
    if (raw.includes(`${code}:`) || raw.startsWith(code)) {
      const message = raw.includes(":")
        ? raw.slice(raw.indexOf(":") + 1).trim()
        : code;
      return new PricingError(code, message || code, statusFor(code));
    }
  }
  return new PricingError(
    "INTERNAL_ERROR",
    "Unable to process pricing request.",
    500,
  );
}

function actorScope(actor: PricingActorRef): string {
  return `admin:super:${actor.id}`;
}

function mapCost(row: Record<string, unknown>): CostDto {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    variantId: String(row.variant_id),
    actualPurchaseCost: Number(row.actual_purchase_cost),
    currency: String(row.currency || "PKR"),
    effectiveFrom: String(row.effective_from),
    effectiveTo: row.effective_to ? String(row.effective_to) : null,
    setBy: String(row.set_by),
    reason: row.reason == null ? null : String(row.reason),
  };
}

function mapConfig(row: Record<string, unknown>): PricingConfigDto {
  return {
    companyId: String(row.company_id),
    maxIncreasePct: Number(row.max_increase_pct),
    maxDecreasePct: Number(row.max_decrease_pct),
    stalenessHours: Number(row.staleness_hours),
    allowSoldoutReference: Boolean(row.allow_soldout_reference),
    safetyAbsoluteFloor:
      row.safety_absolute_floor == null
        ? null
        : Number(row.safety_absolute_floor),
    safetyAbsoluteCeiling:
      row.safety_absolute_ceiling == null
        ? null
        : Number(row.safety_absolute_ceiling),
    minTokenPct: Number(row.min_token_pct),
    maxTokenPct: Number(row.max_token_pct),
    minAdvancePct: Number(row.min_advance_pct),
    maxAdvancePct: Number(row.max_advance_pct),
    codMaxOrderValue: Number(row.cod_max_order_value),
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
    updatedAt: String(row.updated_at),
  };
}

export function createSupabasePricingRepository(
  clientFactory: () => SupabaseClient | null = getSupabase,
): PricingRepository {
  function requireClient(): SupabaseClient {
    if (!isSupabaseActive()) {
      throw new PricingError(
        "INTERNAL_ERROR",
        "Pricing database is unavailable.",
        503,
      );
    }
    const client = clientFactory();
    if (!client) {
      throw new PricingError(
        "INTERNAL_ERROR",
        "Pricing database is unavailable.",
        503,
      );
    }
    return client;
  }

  async function resolveProductId(
    variantId: string,
    productId?: string,
  ): Promise<{ productId: string; variantId: string }> {
    const supabase = requireClient();
    const { data, error } = await supabase
      .from("mp_product_variants")
      .select("id, product_id")
      .eq("id", variantId)
      .maybeSingle();
    if (error) {
      throw new PricingError("INTERNAL_ERROR", "Unable to load variant.", 500);
    }
    if (!data) {
      throw new PricingError("VARIANT_NOT_FOUND", "Variant not found.", 404);
    }
    if (productId && data.product_id !== productId) {
      throw new PricingError(
        "VARIANT_NOT_FOUND",
        "Variant not found for product.",
        404,
      );
    }
    return { productId: String(data.product_id), variantId };
  }

  async function loadCost(id: string): Promise<CostDto> {
    const supabase = requireClient();
    const { data, error } = await supabase
      .from("mp_product_costs")
      .select(
        "id, product_id, variant_id, actual_purchase_cost, currency, effective_from, effective_to, set_by, reason",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw new PricingError("INTERNAL_ERROR", "Unable to load cost.", 500);
    }
    if (!data) {
      throw new PricingError("COST_NOT_FOUND", "Cost not found.", 404);
    }
    return mapCost(data as Record<string, unknown>);
  }

  return {
    async listCosts(variantId) {
      const supabase = requireClient();
      let q = supabase
        .from("mp_product_costs")
        .select(
          "id, product_id, variant_id, actual_purchase_cost, currency, effective_from, effective_to, set_by, reason",
        )
        .order("effective_from", { ascending: false })
        .limit(200);
      if (variantId) q = q.eq("variant_id", variantId);
      const { data, error } = await q;
      if (error) {
        throw new PricingError("INTERNAL_ERROR", "Unable to list costs.", 500);
      }
      return ((data || []) as Record<string, unknown>[]).map(mapCost);
    },

    async createCost(input, actor) {
      const ids = await resolveProductId(input.variantId, input.productId);
      const supabase = requireClient();
      const { data, error } = await supabase.rpc("mp_set_cost", {
        p_actor_scope: actorScope(actor),
        p_product_id: ids.productId,
        p_variant_id: ids.variantId,
        p_actual_purchase_cost: input.actualPurchaseCost,
        p_set_by: actor.id,
        p_reason: input.reason,
      });
      if (error) throw mapRpcError(error);
      const costId = String(
        (data as { costId?: string; cost_id?: string })?.costId ||
          (data as { cost_id?: string })?.cost_id ||
          "",
      );
      if (!costId) {
        throw new PricingError(
          "INTERNAL_ERROR",
          "Cost write committed but id missing.",
          500,
        );
      }
      if (input.effectiveAt || (input.currency && input.currency !== "PKR")) {
        const { data: upd, error: updErr } = await supabase.rpc(
          "mp_admin_update_cost",
          {
            p_actor_scope: actorScope(actor),
            p_cost_id: costId,
            p_set_by: actor.id,
            p_actual_purchase_cost: null,
            p_currency: input.currency ?? null,
            p_effective_from: input.effectiveAt ?? null,
            p_reason: null,
          },
        );
        if (updErr) throw mapRpcError(updErr);
        const nextId = String(
          (upd as { costId?: string })?.costId || costId,
        );
        return loadCost(nextId);
      }
      return loadCost(costId);
    },

    async updateCost(id, patch, actor) {
      const supabase = requireClient();
      const { data, error } = await supabase.rpc("mp_admin_update_cost", {
        p_actor_scope: actorScope(actor),
        p_cost_id: id,
        p_set_by: actor.id,
        p_actual_purchase_cost: patch.actualPurchaseCost ?? null,
        p_currency: patch.currency ?? null,
        p_effective_from: patch.effectiveAt ?? null,
        p_reason: patch.reason ?? null,
      });
      if (error) throw mapRpcError(error);
      const costId = String((data as { costId?: string })?.costId || id);
      return loadCost(costId);
    },

    async getMargin(variantId) {
      const supabase = requireClient();
      const { data: variant, error } = await supabase
        .from("mp_product_variants")
        .select(
          "id, product_id, website_price, website_price_state",
        )
        .eq("id", variantId)
        .maybeSingle();
      if (error) {
        throw new PricingError("INTERNAL_ERROR", "Unable to load variant.", 500);
      }
      if (!variant) {
        throw new PricingError("VARIANT_NOT_FOUND", "Variant not found.", 404);
      }
      const { data: cost } = await supabase
        .from("mp_product_costs")
        .select("actual_purchase_cost")
        .eq("variant_id", variantId)
        .is("effective_to", null)
        .order("effective_from", { ascending: false })
        .limit(1)
        .maybeSingle();

      const websitePrice =
        variant.website_price == null ? null : Number(variant.website_price);
      const state = String(variant.website_price_state);
      const actualPurchaseCost =
        cost?.actual_purchase_cost == null
          ? null
          : Number(cost.actual_purchase_cost);
      const purchasable =
        state !== "confirm_price" &&
        websitePrice != null &&
        websitePrice > 0;
      let profit: number | null = null;
      let marginPct: number | null = null;
      if (
        purchasable &&
        websitePrice != null &&
        actualPurchaseCost != null
      ) {
        profit = websitePrice - actualPurchaseCost;
        marginPct = websitePrice > 0 ? profit / websitePrice : null;
      }
      return {
        variantId: String(variant.id),
        productId: String(variant.product_id),
        websitePrice,
        websitePriceState: state,
        actualPurchaseCost,
        profit,
        marginPct,
        purchasable,
      };
    },

    async publishPrice(variantId, actor) {
      await resolveProductId(variantId);
      const supabase = requireClient();
      const { data, error } = await supabase.rpc("mp_publish_price", {
        p_actor_scope: actorScope(actor),
        p_variant_id: variantId,
        p_changed_by: actor.id,
      });
      if (error) throw mapRpcError(error);
      const row = (data || {}) as Record<string, unknown>;
      return {
        variantId: String(row.variantId || row.variant_id || variantId),
        productId: String(row.productId || ""),
        websitePrice:
          row.website_price == null && row.websitePrice == null
            ? null
            : Number(row.websitePrice ?? row.website_price),
        websitePriceState: String(
          row.websitePriceState || row.website_price_state || "",
        ),
        websitePriceSource:
          row.websitePriceSource == null && row.website_price_source == null
            ? null
            : String(row.websitePriceSource ?? row.website_price_source),
      };
    },

    async createOverride(input, actor) {
      const ids = await resolveProductId(input.variantId, input.productId);
      const supabase = requireClient();
      const { data, error } = await supabase.rpc("mp_apply_override", {
        p_actor_scope: actorScope(actor),
        p_product_id: ids.productId,
        p_variant_id: ids.variantId,
        p_override_price: input.overridePrice,
        p_mode: input.mode,
        p_ends_at: input.endsAt,
        p_reason: input.reason,
        p_created_by: actor.id,
      });
      if (error) throw mapRpcError(error);
      const row = (data || {}) as Record<string, unknown>;
      return {
        overrideId: String(row.overrideId || row.override_id || ""),
        supersededOverrideId:
          row.superseded_override_id == null &&
          row.supersededOverrideId == null
            ? null
            : String(row.supersededOverrideId ?? row.superseded_override_id),
      };
    },

    async revokeOverride(overrideId, actor) {
      const supabase = requireClient();
      const { data, error } = await supabase.rpc("mp_revoke_override", {
        p_actor_scope: actorScope(actor),
        p_override_id: overrideId,
        p_revoked_by: actor.id,
      });
      if (error) throw mapRpcError(error);
      const row = (data || {}) as Record<string, unknown>;
      return {
        overrideId: String(row.overrideId || row.override_id || overrideId),
        supersededOverrideId: null,
      };
    },

    async getPricingConfig() {
      const supabase = requireClient();
      const { data, error } = await supabase
        .from("mp_pricing_config")
        .select("*")
        .eq("company_id", "sunchaser")
        .maybeSingle();
      if (error) {
        throw new PricingError(
          "INTERNAL_ERROR",
          "Unable to load pricing config.",
          500,
        );
      }
      if (!data) {
        throw new PricingError(
          "INTERNAL_ERROR",
          "Pricing config missing.",
          500,
        );
      }
      return mapConfig(data as Record<string, unknown>);
    },

    async updatePricingConfig(patch, actor) {
      const supabase = requireClient();
      const { error } = await supabase.rpc("mp_admin_update_pricing_config", {
        p_actor_scope: actorScope(actor),
        p_updated_by: actor.id,
        p_max_increase_pct: patch.maxIncreasePct ?? null,
        p_max_decrease_pct: patch.maxDecreasePct ?? null,
        p_staleness_hours: patch.stalenessHours ?? null,
        p_allow_soldout_reference: patch.allowSoldoutReference ?? null,
        p_safety_absolute_floor: patch.safetyAbsoluteFloor ?? null,
        p_safety_absolute_ceiling: patch.safetyAbsoluteCeiling ?? null,
        p_min_token_pct: patch.minTokenPct ?? null,
        p_max_token_pct: patch.maxTokenPct ?? null,
        p_min_advance_pct: patch.minAdvancePct ?? null,
        p_max_advance_pct: patch.maxAdvancePct ?? null,
        p_cod_max_order_value: patch.codMaxOrderValue ?? null,
      });
      if (error) throw mapRpcError(error);
      return this.getPricingConfig();
    },

    async upsertSupplierMapping(input, actor) {
      const supabase = requireClient();
      const { data, error } = await supabase.rpc(
        "mp_admin_upsert_supplier_mapping",
        {
          p_actor_scope: actorScope(actor),
          p_supplier_code: input.supplierCode,
          p_product_id: input.productId,
          p_variant_id: input.variantId,
          p_supplier_product_id: input.supplierProductId,
          p_supplier_variant_id: input.supplierVariantId ?? null,
          p_supplier_sku: input.supplierSku ?? null,
          p_normalized_exact_model: input.normalizedExactModel,
          p_match_confidence: input.matchConfidence,
          p_match_locked: input.matchLocked ?? false,
          p_active: input.active ?? true,
          p_supplier_url: input.supplierUrl ?? null,
        },
      );
      if (error) throw mapRpcError(error);
      const row = (data || {}) as Record<string, unknown>;
      return {
        mappingId: String(row.mappingId || ""),
        action: String(row.action || "supplier_mapping.created"),
      };
    },
  };
}
