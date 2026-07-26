/**
 * Strict allowlist validation for cart / delivery / checkout bodies.
 * Rejects prototype pollution and client-supplied commercial fields.
 */

const POLLUTION_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const FORBIDDEN_COMMERCIAL_KEYS = new Set([
  "unit_price",
  "unitPrice",
  "unit_price_snap",
  "website_price",
  "websitePrice",
  "website_price_state",
  "websitePriceState",
  "actual_purchase_cost",
  "actualPurchaseCost",
  "supplier_public_price",
  "supplierPublicPrice",
  "margin",
  "profit",
  "cost",
  "delivery_charge",
  "deliveryCharge",
  "delivery_fee",
  "deliveryFee",
  "stock_status",
  "stockStatus",
  "customerId",
  "customer_id",
  "guestToken",
  "guest_token",
  "possessionToken",
  "token",
  "actor",
  "role",
  "actorScope",
  "actor_scope",
]);

export type ValidationOk<T> = { ok: true; value: T };
export type ValidationErr = { ok: false; code: string; message: string };
export type ValidationResult<T> = ValidationOk<T> | ValidationErr;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function rejectForbiddenKeys(
  body: Record<string, unknown>,
  allowed: Set<string>,
): ValidationErr | null {
  for (const key of Object.keys(body)) {
    if (POLLUTION_KEYS.has(key) || FORBIDDEN_COMMERCIAL_KEYS.has(key)) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "Request contains unsupported fields.",
      };
    }
    if (!allowed.has(key)) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "Request contains unsupported fields.",
      };
    }
  }
  return null;
}

export function parseCartItemBody(
  body: unknown,
): ValidationResult<{ sku: string; quantity: number }> {
  if (!isPlainObject(body)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Invalid request body." };
  }
  const forbidden = rejectForbiddenKeys(body, new Set(["sku", "variantSku", "quantity"]));
  if (forbidden) return forbidden;

  const skuRaw = body.sku ?? body.variantSku;
  const sku = String(skuRaw ?? "").trim().toLowerCase();
  if (!sku || sku.length > 64 || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(sku)) {
    return { ok: false, code: "VARIANT_NOT_FOUND", message: "Variant not found." };
  }

  const qtyRaw = body.quantity;
  if (typeof qtyRaw !== "number" || !Number.isInteger(qtyRaw)) {
    return {
      ok: false,
      code: "INVALID_QUANTITY",
      message: "Quantity must be a positive integer.",
    };
  }
  if (qtyRaw < 1 || qtyRaw > 99) {
    return {
      ok: false,
      code: "INVALID_QUANTITY",
      message: "Quantity must be between 1 and 99.",
    };
  }

  return { ok: true, value: { sku, quantity: qtyRaw } };
}

export function parseDeliveryQuoteBody(
  body: unknown,
): ValidationResult<{ publicRef: string; zoneCode: string }> {
  if (!isPlainObject(body)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Invalid request body." };
  }
  const forbidden = rejectForbiddenKeys(
    body,
    new Set(["publicRef", "cartPublicRef", "zoneCode", "zone"]),
  );
  if (forbidden) return forbidden;

  const publicRef = String(body.publicRef ?? body.cartPublicRef ?? "").trim();
  if (!/^mpcref_[a-f0-9]{32}$/i.test(publicRef)) {
    return { ok: false, code: "CART_NOT_FOUND", message: "Cart not found." };
  }

  const zoneCode = String(body.zoneCode ?? body.zone ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2,8}$/.test(zoneCode)) {
    return {
      ok: false,
      code: "INVALID_DELIVERY_ZONE",
      message: "Invalid delivery zone.",
    };
  }

  return { ok: true, value: { publicRef, zoneCode } };
}

export function parseCheckoutBody(
  body: unknown,
): ValidationResult<{
  publicRef: string;
  zoneCode: string;
  planType: string;
}> {
  if (!isPlainObject(body)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Invalid request body." };
  }
  const forbidden = rejectForbiddenKeys(
    body,
    new Set([
      "publicRef",
      "cartPublicRef",
      "zoneCode",
      "zone",
      "planType",
      "plan_type",
    ]),
  );
  if (forbidden) return forbidden;

  const publicRef = String(body.publicRef ?? body.cartPublicRef ?? "").trim();
  if (!/^mpcref_[a-f0-9]{32}$/i.test(publicRef)) {
    return { ok: false, code: "CART_NOT_FOUND", message: "Cart not found." };
  }

  const zoneCode = String(body.zoneCode ?? body.zone ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2,8}$/.test(zoneCode)) {
    return {
      ok: false,
      code: "INVALID_DELIVERY_ZONE",
      message: "Invalid delivery zone.",
    };
  }

  const planType = String(body.planType ?? body.plan_type ?? "full")
    .trim()
    .toLowerCase();
  if (planType !== "full" && planType !== "cod_eligible") {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Unsupported plan type.",
    };
  }

  return { ok: true, value: { publicRef, zoneCode, planType } };
}

export function parsePublicRefParam(raw: unknown): ValidationResult<string> {
  const value = String(raw ?? "").trim();
  if (
    !/^mpcref_[a-f0-9]{32}$/i.test(value) &&
    !/^mporef_[a-f0-9]{32}$/i.test(value)
  ) {
    return { ok: false, code: "CART_NOT_FOUND", message: "Not found." };
  }
  return { ok: true, value };
}

export function parseIdempotencyKey(raw: unknown): ValidationResult<string> {
  const key = String(raw ?? "").trim();
  if (!key) {
    return {
      ok: false,
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Idempotency-Key header is required.",
    };
  }
  if (key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    return {
      ok: false,
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Idempotency-Key is invalid.",
    };
  }
  return { ok: true, value: key };
}

/** Reject token smuggling via query string or body. */
export function hasTokenSmuggling(
  query: Record<string, unknown>,
  body: unknown,
): boolean {
  const queryKeys = Object.keys(query || {}).map((k) => k.toLowerCase());
  const suspicious = [
    "token",
    "possessiontoken",
    "possession_token",
    "marketplace_token",
    "x-marketplace-token",
    "guesttoken",
    "guest_token",
  ];
  if (queryKeys.some((k) => suspicious.includes(k))) return true;

  if (!isPlainObject(body)) return false;
  return Object.keys(body).some((k) => {
    const lower = k.toLowerCase();
    return (
      suspicious.includes(lower) ||
      lower === "authorization" ||
      lower.endsWith("token")
    );
  });
}
