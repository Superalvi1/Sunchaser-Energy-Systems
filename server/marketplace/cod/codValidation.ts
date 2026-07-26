import {
  hasTokenSmuggling,
  parseIdempotencyKey,
  parsePublicRefParam,
  type ValidationResult,
} from "../cart/cartValidation.ts";

const POLLUTION = new Set(["__proto__", "constructor", "prototype"]);
const FORBIDDEN = new Set([
  "customerId",
  "customer_id",
  "guestToken",
  "token",
  "actor",
  "role",
  "actorScope",
  "permission",
  "amount",
  "grandTotal",
  "deliveryFee",
  "deliveryCharge",
  "codEligible",
  "website_price",
  "actual_purchase_cost",
  "margin",
  "profit",
  "status",
  "orderStatus",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function rejectKeys(
  body: Record<string, unknown>,
  allowed: Set<string>,
): ValidationResult<never> | null {
  for (const key of Object.keys(body)) {
    if (POLLUTION.has(key) || FORBIDDEN.has(key)) {
      return {
        ok: false,
        code: "FORBIDDEN_FIELD",
        message: "Request contains unsupported fields.",
      };
    }
    if (!allowed.has(key)) {
      return {
        ok: false,
        code: "UNKNOWN_FIELD",
        message: "Request contains unsupported fields.",
      };
    }
  }
  return null;
}

export { hasTokenSmuggling, parseIdempotencyKey, parsePublicRefParam };

export function parseEmptyBody(body: unknown): ValidationResult<Record<string, never>> {
  if (body == null) return { ok: true, value: {} };
  if (!isPlainObject(body)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Invalid request body." };
  }
  if (Object.keys(body).length > 0) {
    return {
      ok: false,
      code: "UNKNOWN_FIELD",
      message: "Request contains unsupported fields.",
    };
  }
  return { ok: true, value: {} };
}

export function parseReasonBody(
  body: unknown,
): ValidationResult<{ reason: string }> {
  if (!isPlainObject(body)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Invalid request body." };
  }
  const forbidden = rejectKeys(body, new Set(["reason"]));
  if (forbidden) return forbidden;
  const reason = String(body.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 500) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Reason must be 3-500 characters.",
    };
  }
  return { ok: true, value: { reason } };
}

export function parseOrderRefParam(raw: unknown): ValidationResult<string> {
  const value = String(raw ?? "").trim();
  if (!/^mporef_[a-f0-9]{32}$/i.test(value)) {
    return { ok: false, code: "ORDER_NOT_FOUND", message: "Order not found." };
  }
  return { ok: true, value };
}
