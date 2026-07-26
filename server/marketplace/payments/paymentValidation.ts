/**
 * Strict allowlist validation for payment bodies.
 * Never accepts actor/role/customerId/token/storagePath from clients.
 */
import {
  hasTokenSmuggling,
  parseIdempotencyKey,
  parsePublicRefParam,
  type ValidationResult,
} from "../cart/cartValidation.ts";

const POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const FORBIDDEN_KEYS = new Set([
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
  "permission",
  "permissions",
  "storagePath",
  "storage_path",
  "bucket",
  "objectPath",
  "object_path",
  "actual_purchase_cost",
  "actualPurchaseCost",
  "supplier_public_price",
  "supplierPublicPrice",
  "margin",
  "profit",
  "website_price",
  "websitePrice",
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
    if (POLLUTION_KEYS.has(key) || FORBIDDEN_KEYS.has(key)) {
      return {
        ok: false,
        code: key.startsWith("__") || key === "constructor" || key === "prototype"
          ? "FORBIDDEN_FIELD"
          : FORBIDDEN_KEYS.has(key)
            ? "FORBIDDEN_FIELD"
            : "UNKNOWN_FIELD",
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

export function parseUploadIntentBody(
  body: unknown,
): ValidationResult<Record<string, never>> {
  return parseEmptyBody(body);
}

export function parseReceiptJsonBody(body: unknown): ValidationResult<{
  uploadIntentId: string;
  mimeType: string;
  contentBase64: string;
  fileName?: string;
}> {
  if (!isPlainObject(body)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Invalid request body." };
  }
  const forbidden = rejectKeys(
    body,
    new Set([
      "uploadIntentId",
      "upload_intent_id",
      "mimeType",
      "mime_type",
      "contentBase64",
      "content_base64",
      "fileName",
      "filename",
    ]),
  );
  if (forbidden) return forbidden;

  const uploadIntentId = String(
    body.uploadIntentId ?? body.upload_intent_id ?? "",
  ).trim();
  if (!/^mpui_[a-z0-9]+$/i.test(uploadIntentId)) {
    return {
      ok: false,
      code: "UPLOAD_INTENT_INVALID",
      message: "Upload intent is invalid.",
    };
  }

  const mimeType = String(body.mimeType ?? body.mime_type ?? "").trim();
  if (!mimeType) {
    return {
      ok: false,
      code: "INVALID_FILE_TYPE",
      message: "Receipt MIME type is required.",
    };
  }

  const contentBase64 = String(
    body.contentBase64 ?? body.content_base64 ?? "",
  ).trim();
  if (!contentBase64 || contentBase64.length > 10_000_000) {
    return {
      ok: false,
      code: "INVALID_FILE_CONTENT",
      message: "Receipt content is invalid.",
    };
  }

  const fileNameRaw = body.fileName ?? body.filename;
  const fileName =
    fileNameRaw === undefined ? undefined : String(fileNameRaw).trim().slice(0, 180);

  return {
    ok: true,
    value: { uploadIntentId, mimeType, contentBase64, fileName },
  };
}

export function parseRejectBody(
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
      message: "Rejection reason must be 3-500 characters.",
    };
  }
  return { ok: true, value: { reason } };
}

export function parseRefundBody(
  body: unknown,
): ValidationResult<{ amount: number; reason: string }> {
  if (!isPlainObject(body)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Invalid request body." };
  }
  const forbidden = rejectKeys(body, new Set(["amount", "reason"]));
  if (forbidden) return forbidden;

  const amountRaw = body.amount;
  const amount =
    typeof amountRaw === "number" ? amountRaw : Number(String(amountRaw ?? ""));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 50_000_000) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: "Refund amount is invalid.",
    };
  }

  const reason = String(body.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 500) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Refund reason must be 3-500 characters.",
    };
  }
  return { ok: true, value: { amount, reason } };
}

export function parsePaymentIdParam(raw: unknown): ValidationResult<string> {
  const value = String(raw ?? "").trim();
  if (!/^mppay_[a-z0-9]+$/i.test(value)) {
    return {
      ok: false,
      code: "PAYMENT_NOT_FOUND",
      message: "Payment not found.",
    };
  }
  return { ok: true, value };
}
