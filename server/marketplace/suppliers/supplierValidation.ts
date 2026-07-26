import { SupplierError } from "./supplierTypes.ts";

const FORBIDDEN_ACTOR_KEYS = [
  "actor_scope",
  "actorScope",
  "role",
  "actor_role",
  "actorRole",
  "actor_id",
  "actorId",
];

export function rejectSpoofedActorFields(body: unknown): void {
  if (body == null || typeof body !== "object" || Array.isArray(body)) return;
  for (const key of Object.keys(body as object)) {
    if (FORBIDDEN_ACTOR_KEYS.includes(key)) {
      throw new SupplierError(
        400,
        "FORBIDDEN_FIELD",
        "Client-supplied actor fields are not allowed.",
      );
    }
  }
}

export function parsePriceCheckBody(body: unknown): {
  trigger: "manual" | "scheduled";
} {
  rejectSpoofedActorFields(body);
  if (body == null || (typeof body === "object" && !Array.isArray(body) && Object.keys(body as object).length === 0)) {
    return { trigger: "manual" };
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new SupplierError(400, "VALIDATION_ERROR", "Invalid body.");
  }
  const trigger = (body as { trigger?: unknown }).trigger;
  if (trigger === undefined || trigger === null) return { trigger: "manual" };
  if (trigger !== "manual" && trigger !== "scheduled") {
    throw new SupplierError(
      400,
      "VALIDATION_ERROR",
      "trigger must be manual or scheduled.",
    );
  }
  return { trigger };
}

export function parseMappingBody(body: unknown): {
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
} {
  rejectSpoofedActorFields(body);
  if (typeof body !== "object" || body == null || Array.isArray(body)) {
    throw new SupplierError(400, "VALIDATION_ERROR", "Invalid mapping body.");
  }
  const b = body as Record<string, unknown>;
  const supplierCode = String(b.supplierCode || "").toLowerCase();
  if (supplierCode !== "kamal" && supplierCode !== "alladin") {
    throw new SupplierError(400, "VALIDATION_ERROR", "supplierCode invalid.");
  }
  const productId = String(b.productId || "").trim();
  const variantId = String(b.variantId || "").trim();
  const supplierProductId = String(b.supplierProductId || "").trim();
  const normalizedExactModel = String(b.normalizedExactModel || "").trim();
  const matchConfidence = String(b.matchConfidence || "").trim();
  if (!productId || !variantId || !supplierProductId || !normalizedExactModel) {
    throw new SupplierError(400, "VALIDATION_ERROR", "Required mapping fields missing.");
  }
  if (!["exact", "likely", "uncertain", "conflict"].includes(matchConfidence)) {
    throw new SupplierError(400, "VALIDATION_ERROR", "matchConfidence invalid.");
  }
  return {
    supplierCode,
    productId,
    variantId,
    supplierProductId,
    supplierVariantId:
      b.supplierVariantId == null ? undefined : String(b.supplierVariantId),
    supplierSku: b.supplierSku == null ? undefined : String(b.supplierSku),
    normalizedExactModel,
    matchConfidence,
    matchLocked: typeof b.matchLocked === "boolean" ? b.matchLocked : undefined,
    active: typeof b.active === "boolean" ? b.active : undefined,
    supplierUrl: b.supplierUrl == null ? undefined : String(b.supplierUrl),
  };
}
