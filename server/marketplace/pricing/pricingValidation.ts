/**
 * Strict positive allowlists for WS3 pricing/cost/mapping payloads.
 */
import { PricingError } from "./pricingTypes.ts";

const POLLUTION = new Set(["__proto__", "prototype", "constructor"]);

const FORBIDDEN = new Set([
  "websitePrice",
  "website_price",
  "websitePriceState",
  "website_price_state",
  "supplierPublicPrice",
  "supplier_public_price",
  "profit",
  "margin",
  "marginPct",
  "deliveryCharge",
  "delivery_charge",
  "actor",
  "role",
  "permissions",
  "id",
  "createdAt",
  "created_at",
  "updatedAt",
  "updated_at",
  "setBy",
  "set_by",
  "createdBy",
  "created_by",
]);

const COST_CREATE = new Set([
  "variantId",
  "productId",
  "actualPurchaseCost",
  "currency",
  "effectiveAt",
  "reason",
]);

const COST_PATCH = new Set([
  "actualPurchaseCost",
  "currency",
  "effectiveAt",
  "reason",
]);

const OVERRIDE_CREATE = new Set([
  "variantId",
  "productId",
  "overridePrice",
  "mode",
  "startsAt",
  "endsAt",
  "reason",
]);

const PUBLISH = new Set(["variantId"]);

const CONFIG_PATCH = new Set([
  "maxIncreasePct",
  "maxDecreasePct",
  "stalenessHours",
  "allowSoldoutReference",
  "safetyAbsoluteFloor",
  "safetyAbsoluteCeiling",
  "minTokenPct",
  "maxTokenPct",
  "minAdvancePct",
  "maxAdvancePct",
  "codMaxOrderValue",
]);

const MAPPING_CREATE = new Set([
  "supplierCode",
  "productId",
  "variantId",
  "supplierProductId",
  "supplierVariantId",
  "supplierSku",
  "normalizedExactModel",
  "matchConfidence",
  "matchLocked",
  "active",
  "supplierUrl",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertAllowlisted(
  value: unknown,
  allowed: Set<string>,
  path = "",
): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new PricingError(
      "VALIDATION_ERROR",
      path ? `Invalid object at ${path}.` : "Request body must be an object.",
    );
  }
  for (const key of Object.keys(value)) {
    if (POLLUTION.has(key)) {
      throw new PricingError(
        "UNKNOWN_FIELD",
        `Unexpected field: ${path ? `${path}.` : ""}${key}`,
      );
    }
    if (FORBIDDEN.has(key)) {
      throw new PricingError(
        "FORBIDDEN_FIELD",
        `Field not allowed: ${path ? `${path}.` : ""}${key}`,
      );
    }
    if (!allowed.has(key)) {
      throw new PricingError(
        "UNKNOWN_FIELD",
        `Unexpected field: ${path ? `${path}.` : ""}${key}`,
      );
    }
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PricingError("VALIDATION_ERROR", `${field} is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new PricingError("VALIDATION_ERROR", `${field} must be a string.`);
  }
  return value.trim();
}

function requirePositiveNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new PricingError("INVALID_PRICE", `${field} must be a positive number.`);
  }
  return value;
}

function requireNonNegNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new PricingError("INVALID_PRICE", `${field} must be >= 0.`);
  }
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PricingError("VALIDATION_ERROR", `${field} must be a number.`);
  }
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new PricingError("VALIDATION_ERROR", `${field} must be a boolean.`);
  }
  return value;
}

function optionalIso(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new PricingError("VALIDATION_ERROR", `${field} must be an ISO timestamp.`);
  }
  const d = Date.parse(value);
  if (!Number.isFinite(d)) {
    throw new PricingError("VALIDATION_ERROR", `${field} must be an ISO timestamp.`);
  }
  return new Date(d).toISOString();
}

export function parseCreateCostBody(body: unknown) {
  assertAllowlisted(body, COST_CREATE);
  return {
    variantId: requireString(body.variantId, "variantId"),
    productId: optionalString(body.productId, "productId"),
    actualPurchaseCost: requireNonNegNumber(
      body.actualPurchaseCost,
      "actualPurchaseCost",
    ),
    currency: optionalString(body.currency, "currency") || "PKR",
    effectiveAt: optionalIso(body.effectiveAt, "effectiveAt"),
    reason: optionalString(body.reason, "reason") || null,
  };
}

export function parsePatchCostBody(body: unknown) {
  assertAllowlisted(body, COST_PATCH);
  const patch = {
    actualPurchaseCost:
      body.actualPurchaseCost === undefined
        ? undefined
        : requireNonNegNumber(body.actualPurchaseCost, "actualPurchaseCost"),
    currency: optionalString(body.currency, "currency"),
    effectiveAt: optionalIso(body.effectiveAt, "effectiveAt"),
    reason: optionalString(body.reason, "reason"),
  };
  if (
    patch.actualPurchaseCost === undefined &&
    patch.currency === undefined &&
    patch.effectiveAt === undefined &&
    patch.reason === undefined
  ) {
    throw new PricingError(
      "VALIDATION_ERROR",
      "Patch body must include at least one allowed field.",
    );
  }
  return patch;
}

export function parseCreateOverrideBody(body: unknown) {
  assertAllowlisted(body, OVERRIDE_CREATE);
  const mode = requireString(body.mode, "mode");
  if (mode !== "permanent" && mode !== "time_limited") {
    throw new PricingError(
      "VALIDATION_ERROR",
      "mode must be permanent or time_limited.",
    );
  }
  const endsAt = optionalIso(body.endsAt, "endsAt");
  if (mode === "time_limited" && !endsAt) {
    throw new PricingError(
      "VALIDATION_ERROR",
      "time_limited override requires endsAt.",
    );
  }
  return {
    variantId: requireString(body.variantId, "variantId"),
    productId: optionalString(body.productId, "productId"),
    overridePrice: requirePositiveNumber(body.overridePrice, "overridePrice"),
    mode: mode as "permanent" | "time_limited",
    startsAt: optionalIso(body.startsAt, "startsAt"),
    endsAt: endsAt ?? null,
    reason: requireString(body.reason, "reason"),
  };
}

export function parsePublishBody(body: unknown) {
  assertAllowlisted(body, PUBLISH);
  return { variantId: requireString(body.variantId, "variantId") };
}

export function parsePricingConfigPatch(body: unknown) {
  assertAllowlisted(body, CONFIG_PATCH);
  const patch = {
    maxIncreasePct: optionalNumber(body.maxIncreasePct, "maxIncreasePct"),
    maxDecreasePct: optionalNumber(body.maxDecreasePct, "maxDecreasePct"),
    stalenessHours:
      body.stalenessHours === undefined
        ? undefined
        : (() => {
            const n = optionalNumber(body.stalenessHours, "stalenessHours");
            if (n === undefined || !Number.isInteger(n) || n < 1) {
              throw new PricingError(
                "VALIDATION_ERROR",
                "stalenessHours must be a positive integer.",
              );
            }
            return n;
          })(),
    allowSoldoutReference: optionalBoolean(
      body.allowSoldoutReference,
      "allowSoldoutReference",
    ),
    safetyAbsoluteFloor: optionalNumber(
      body.safetyAbsoluteFloor,
      "safetyAbsoluteFloor",
    ),
    safetyAbsoluteCeiling: optionalNumber(
      body.safetyAbsoluteCeiling,
      "safetyAbsoluteCeiling",
    ),
    minTokenPct: optionalNumber(body.minTokenPct, "minTokenPct"),
    maxTokenPct: optionalNumber(body.maxTokenPct, "maxTokenPct"),
    minAdvancePct: optionalNumber(body.minAdvancePct, "minAdvancePct"),
    maxAdvancePct: optionalNumber(body.maxAdvancePct, "maxAdvancePct"),
    codMaxOrderValue: optionalNumber(body.codMaxOrderValue, "codMaxOrderValue"),
  };
  if (Object.values(patch).every((v) => v === undefined)) {
    throw new PricingError(
      "VALIDATION_ERROR",
      "Patch body must include at least one allowed field.",
    );
  }
  return patch;
}

export function parseSupplierMappingBody(body: unknown) {
  assertAllowlisted(body, MAPPING_CREATE);
  const supplierCode = requireString(body.supplierCode, "supplierCode").toLowerCase();
  if (supplierCode !== "kamal" && supplierCode !== "alladin") {
    throw new PricingError(
      "INVALID_MAPPING",
      "supplierCode must be kamal or alladin.",
    );
  }
  return {
    supplierCode: supplierCode as "kamal" | "alladin",
    productId: requireString(body.productId, "productId"),
    variantId: requireString(body.variantId, "variantId"),
    supplierProductId: requireString(body.supplierProductId, "supplierProductId"),
    supplierVariantId: optionalString(body.supplierVariantId, "supplierVariantId"),
    supplierSku: optionalString(body.supplierSku, "supplierSku"),
    normalizedExactModel: requireString(
      body.normalizedExactModel,
      "normalizedExactModel",
    ),
    matchConfidence:
      optionalString(body.matchConfidence, "matchConfidence") || "exact",
    matchLocked: optionalBoolean(body.matchLocked, "matchLocked"),
    active: optionalBoolean(body.active, "active"),
    supplierUrl: optionalString(body.supplierUrl, "supplierUrl"),
  };
}
