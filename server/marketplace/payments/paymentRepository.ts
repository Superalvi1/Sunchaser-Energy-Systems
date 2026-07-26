import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../../dbManager.ts";
import type { MarketplaceIdentity } from "../cart/cartTypes.ts";
import { guestActorScope } from "../cart/cartIdentity.ts";
import type {
  AdminPaymentDto,
  OrderPaymentDto,
  PaymentPreflightDto,
  PaymentRecordDto,
  UploadIntentDto,
} from "./paymentTypes.ts";
import type { ReceiptStorage } from "./receiptStorage.ts";
import { assertSafeStoragePath } from "./receiptStorage.ts";
import { validateReceiptBytes } from "./receiptValidation.ts";

export class PaymentRepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type PaymentRepository = {
  preflight(
    identity: MarketplaceIdentity,
    publicRef: string,
  ): Promise<PaymentPreflightDto>;
  createUploadIntent(
    identity: MarketplaceIdentity,
    publicRef: string,
    idempotencyKey: string,
  ): Promise<UploadIntentDto>;
  /**
   * Authorize → validate receipt → upload to intent path → mark → record.
   * On DB failure after storage upload, orphan object is removed/quarantined.
   */
  submitReceipt(
    identity: MarketplaceIdentity,
    publicRef: string,
    input: {
      uploadIntentId: string;
      mimeType: string;
      bytes: Buffer;
      fileName?: string;
      idempotencyKey: string;
    },
  ): Promise<PaymentRecordDto>;
  listOrderPayments(
    identity: MarketplaceIdentity,
    publicRef: string,
  ): Promise<OrderPaymentDto[]>;
  adminListPayments(
    actorScope: string,
    status?: string,
  ): Promise<AdminPaymentDto[]>;
  adminAction(
    actorScope: string,
    actorId: string,
    paymentId: string,
    action: "verify" | "reject" | "refund",
    input: {
      reason?: string;
      amount?: number;
      idempotencyKey: string;
    },
  ): Promise<Record<string, unknown>>;
  /** Internal: resolve storage path for an intent (never exposed publicly). */
  getIntentStoragePath(uploadIntentId: string): Promise<string>;
};

const SAFE_ERROR_CODES = new Set([
  "ORDER_NOT_FOUND",
  "ORDER_NOT_AUTHORIZED",
  "PAYMENT_NOT_ALLOWED",
  "PAYMENT_ALREADY_RECORDED",
  "PAYMENT_NOT_FOUND",
  "PAYMENT_NOT_PENDING",
  "PAYMENT_ALREADY_VERIFIED",
  "PAYMENT_ALREADY_REJECTED",
  "INVALID_PAYMENT_METHOD",
  "INVALID_AMOUNT",
  "UPLOAD_INTENT_REQUIRED",
  "UPLOAD_INTENT_INVALID",
  "UPLOAD_INTENT_EXPIRED",
  "UPLOAD_INTENT_USED",
  "INVALID_FILE_TYPE",
  "INVALID_FILE_CONTENT",
  "FILE_TOO_LARGE",
  "RECEIPT_UPLOAD_FAILED",
  "REFUND_NOT_ALLOWED",
  "REFUND_AMOUNT_EXCEEDED",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "FORBIDDEN_FIELD",
  "UNKNOWN_FIELD",
  "VALIDATION_ERROR",
  "CONFLICT",
  "INTERNAL_ERROR",
  "INVALID_TOKEN",
  "CART_NOT_FOUND",
  "CART_NOT_AUTHORIZED",
]);

function mapRpcError(err: { message?: string; code?: string } | null): never {
  const raw = String(err?.message || "");
  const match = /([A-Z][A-Z0-9_]+):/.exec(raw);
  const code =
    match?.[1] && SAFE_ERROR_CODES.has(match[1]) ? match[1] : "INTERNAL_ERROR";
  const messages: Record<string, string> = {
    ORDER_NOT_FOUND: "Order not found.",
    ORDER_NOT_AUTHORIZED: "Not authorized.",
    PAYMENT_NOT_ALLOWED: "Payment is not allowed for this order.",
    PAYMENT_ALREADY_RECORDED: "A payment has already been recorded.",
    PAYMENT_NOT_FOUND: "Payment not found.",
    PAYMENT_NOT_PENDING: "Payment is not pending verification.",
    PAYMENT_ALREADY_VERIFIED: "Payment is already verified.",
    PAYMENT_ALREADY_REJECTED: "Payment is already rejected.",
    INVALID_PAYMENT_METHOD: "Invalid payment method.",
    INVALID_AMOUNT: "Invalid amount.",
    UPLOAD_INTENT_REQUIRED: "Upload intent is required.",
    UPLOAD_INTENT_INVALID: "Upload intent is invalid.",
    UPLOAD_INTENT_EXPIRED: "Upload intent has expired.",
    UPLOAD_INTENT_USED: "Upload intent has already been used.",
    INVALID_FILE_TYPE: "Receipt file type is not allowed.",
    INVALID_FILE_CONTENT: "Receipt content is invalid.",
    FILE_TOO_LARGE: "Receipt exceeds maximum size.",
    RECEIPT_UPLOAD_FAILED: "Receipt upload failed.",
    REFUND_NOT_ALLOWED: "Refund is not allowed.",
    REFUND_AMOUNT_EXCEEDED: "Refund amount exceeds refundable balance.",
    IDEMPOTENCY_CONFLICT: "Idempotency-Key conflict.",
    CONFLICT: "Conflict.",
    VALIDATION_ERROR: "Validation failed.",
    FORBIDDEN_FIELD: "Request contains unsupported fields.",
    UNKNOWN_FIELD: "Request contains unsupported fields.",
  };
  throw new PaymentRepositoryError(code, messages[code] || "Request failed.");
}

function assertNoForbiddenPayload(payload: unknown): void {
  const forbidden = [
    "actual_purchase_cost",
    "actualPurchaseCost",
    "supplier_public_price",
    "supplierPublicPrice",
    "margin",
    "profit",
    "guest_token_hash",
    "guestTokenHash",
    "possessionToken",
    "service_role",
    "storage_path",
    "storagePath",
  ];
  const text = JSON.stringify(payload);
  for (const key of forbidden) {
    if (text.includes(`"${key}"`)) {
      throw new PaymentRepositoryError(
        "INTERNAL_ERROR",
        "Response failed safety validation.",
      );
    }
  }
}

function ownershipParams(identity: MarketplaceIdentity): {
  p_customer_id: string | null;
  p_guest_token_hash: string | null;
  p_actor_scope: string;
} {
  if (identity.kind === "customer") {
    return {
      p_customer_id: identity.customerId,
      p_guest_token_hash: null,
      p_actor_scope: identity.actorScope,
    };
  }
  return {
    p_customer_id: null,
    p_guest_token_hash: identity.tokenHash,
    p_actor_scope: identity.actorScope,
  };
}

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new PaymentRepositoryError("INTERNAL_ERROR", "Invalid numeric result.");
  }
  return n;
}

function requestHash(parts: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export type PaymentRepositoryDeps = {
  clientFactory?: () => SupabaseClient | null;
  storage: ReceiptStorage;
  /** Optional direct RPC executor for local pg tests (bypasses Supabase). */
  rpc?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
};

export function createPaymentRepository(
  deps: PaymentRepositoryDeps,
): PaymentRepository {
  const clientFactory = deps.clientFactory ?? getSupabase;
  const storage = deps.storage;

  const INTERNAL_RPCS = new Set([
    "mp_get_upload_intent_path",
    "mp_mark_upload_intent_uploaded",
    "mp_quarantine_unattached_upload",
    "mp_reconcile_stale_claimed_intent",
    "mp_idempotency_preflight",
  ]);

  async function callRpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (deps.rpc) {
      try {
        const row = await deps.rpc(name, args);
        if (row.ok === false && typeof row.error === "string") {
          const code = SAFE_ERROR_CODES.has(row.error)
            ? row.error
            : "INTERNAL_ERROR";
          throw new PaymentRepositoryError(code, "Request failed.");
        }
        if (!INTERNAL_RPCS.has(name)) assertNoForbiddenPayload(row);
        return row;
      } catch (err) {
        if (err instanceof PaymentRepositoryError) throw err;
        mapRpcError({ message: String((err as Error)?.message || err) });
      }
    }

    if (!isSupabaseActive()) {
      throw new PaymentRepositoryError(
        "INTERNAL_ERROR",
        "Marketplace database is unavailable.",
      );
    }
    const client = clientFactory();
    if (!client) {
      throw new PaymentRepositoryError(
        "INTERNAL_ERROR",
        "Marketplace database is unavailable.",
      );
    }
    const { data, error } = await client.rpc(name, args);
    if (error) mapRpcError(error);
    if (!data || typeof data !== "object") {
      throw new PaymentRepositoryError("INTERNAL_ERROR", "Empty RPC result.");
    }
    const row = data as Record<string, unknown>;
    if (row.ok === false && typeof row.error === "string") {
      const code = SAFE_ERROR_CODES.has(row.error) ? row.error : "INTERNAL_ERROR";
      throw new PaymentRepositoryError(code, "Request failed.");
    }
    if (!INTERNAL_RPCS.has(name)) assertNoForbiddenPayload(row);
    return row;
  }

  function scopedIdentity(
    identity: MarketplaceIdentity,
    publicRef: string,
  ): MarketplaceIdentity {
    if (identity.kind === "guest") {
      return { ...identity, actorScope: guestActorScope(publicRef) };
    }
    return identity;
  }

  return {
    async preflight(identity, publicRef) {
      const owned = ownershipParams(scopedIdentity(identity, publicRef));
      const row = await callRpc("mp_payment_preflight", {
        p_public_ref: publicRef,
        p_customer_id: owned.p_customer_id,
        p_guest_token_hash: owned.p_guest_token_hash,
        p_actor_scope: owned.p_actor_scope,
      });
      const constraints = (row.receiptConstraints || {}) as Record<string, unknown>;
      const dto: PaymentPreflightDto = {
        publicRef: String(row.publicRef),
        orderStatus: String(row.orderStatus),
        planType: String(row.planType),
        paymentMethod: "bank_transfer",
        currency: String(row.currency || "PKR"),
        amountDue: asNumber(row.amountDue),
        grandTotal: asNumber(row.grandTotal),
        netPaid: asNumber(row.netPaid),
        receiptConstraints: {
          allowedMimeTypes: Array.isArray(constraints.allowedMimeTypes)
            ? constraints.allowedMimeTypes.map(String)
            : ["image/jpeg", "image/png", "application/pdf"],
          maxBytes: asNumber(constraints.maxBytes ?? 5242880),
        },
      };
      assertNoForbiddenPayload(dto);
      return dto;
    },

    async createUploadIntent(identity, publicRef, idempotencyKey) {
      const scoped = scopedIdentity(identity, publicRef);
      const owned = ownershipParams(scoped);
      const hash = requestHash({
        publicRef,
        operation: "bank_transfer_receipt",
        step: "upload_intent",
      });
      const row = await callRpc("mp_create_upload_intent_for_order", {
        p_public_ref: publicRef,
        p_customer_id: owned.p_customer_id,
        p_guest_token_hash: owned.p_guest_token_hash,
        p_actor_scope: owned.p_actor_scope,
        p_idempotency_key: idempotencyKey,
        p_request_hash: hash,
      });
      if (row.ok === false) {
        throw new PaymentRepositoryError(
          String(row.error || "INTERNAL_ERROR"),
          "Upload intent failed.",
        );
      }
      const dto: UploadIntentDto = {
        uploadIntentId: String(row.uploadIntentId),
        status: String(row.status || "claimed"),
        expiresAt: row.expiresAt ? String(row.expiresAt) : null,
        allowedMimeTypes: Array.isArray(row.allowedMimeTypes)
          ? row.allowedMimeTypes.map(String)
          : ["image/jpeg", "image/png", "application/pdf"],
        maxBytes: asNumber(row.maxBytes ?? 5242880),
        amountDue: asNumber(row.amountDue),
        currency: String(row.currency || "PKR"),
        replay: Boolean(row.replay),
      };
      assertNoForbiddenPayload(dto);
      return dto;
    },

    async getIntentStoragePath(uploadIntentId) {
      const row = await callRpc("mp_get_upload_intent_path", {
        p_upload_intent_id: uploadIntentId,
      });
      const storagePath = String(row.storage_path || row.storagePath || "");
      assertSafeStoragePath(storagePath);
      return storagePath;
    },

    async submitReceipt(identity, publicRef, input) {
      const scoped = scopedIdentity(identity, publicRef);
      const owned = ownershipParams(scoped);

      // 1. Authorize ownership before storage I/O or durable claims.
      await callRpc("mp_list_order_payments", {
        p_public_ref: publicRef,
        p_customer_id: owned.p_customer_id,
        p_guest_token_hash: owned.p_guest_token_hash,
      });

      // Idempotency hash must match upload-intent claim (no storage I/O yet).
      const boundHash = requestHash({
        publicRef,
        operation: "bank_transfer_receipt",
        step: "upload_intent",
      });

      const claim = await callRpc("mp_idempotency_preflight", {
        p_idempotency_key: input.idempotencyKey,
        p_operation_type: "bank_transfer_receipt",
        p_actor_scope: owned.p_actor_scope,
        p_request_hash: boundHash,
        p_ref: publicRef,
      });
      if (claim.status === "COMPLETED_REPLAY") {
        const payload = (claim.result_payload || {}) as Record<string, unknown>;
        const dto: PaymentRecordDto = {
          paymentId: String(payload.paymentId || payload.payment_id || ""),
          receiptId: String(payload.receiptId || payload.receipt_id || ""),
          status: String(payload.status || "submitted"),
          replay: true,
        };
        assertNoForbiddenPayload(dto);
        return dto;
      }
      if (claim.status === "REQUEST_HASH_CONFLICT") {
        throw new PaymentRepositoryError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key conflict.",
        );
      }

      // Resolve server path BEFORE any storage I/O
      const pathRow = await callRpc("mp_get_upload_intent_path", {
        p_upload_intent_id: input.uploadIntentId,
        p_actor_scope: owned.p_actor_scope,
        p_order_public_ref: publicRef,
        p_customer_id: owned.p_customer_id,
        p_guest_token_hash: owned.p_guest_token_hash,
      });
      const storagePath = String(pathRow.storage_path || pathRow.storagePath || "");
      assertSafeStoragePath(storagePath);

      const pre = await callRpc("mp_payment_preflight", {
        p_public_ref: publicRef,
        p_customer_id: owned.p_customer_id,
        p_guest_token_hash: owned.p_guest_token_hash,
        p_actor_scope: owned.p_actor_scope,
      });
      const maxBytes = asNumber(
        (pre.receiptConstraints as Record<string, unknown>)?.maxBytes ?? 5242880,
      );

      const validated = validateReceiptBytes({
        declaredMime: input.mimeType,
        bytes: input.bytes,
        fileName: input.fileName,
        maxBytes,
      });
      if (validated.ok === false) {
        throw new PaymentRepositoryError(validated.code, validated.message);
      }

      let uploaded = false;
      try {
        await storage.upload(storagePath, validated.bytes, validated.mimeType);
        uploaded = true;

        await callRpc("mp_mark_upload_intent_uploaded", {
          p_upload_intent_id: input.uploadIntentId,
          p_byte_size: validated.byteSize,
          p_sha256: validated.sha256,
        });

        const amountDue = asNumber(pre.amountDue);

        const row = await callRpc("mp_record_payment_for_order", {
          p_public_ref: publicRef,
          p_customer_id: owned.p_customer_id,
          p_guest_token_hash: owned.p_guest_token_hash,
          p_actor_scope: owned.p_actor_scope,
          p_upload_intent_id: input.uploadIntentId,
          p_amount: amountDue,
          p_sha256: validated.sha256,
          p_byte_size: validated.byteSize,
          p_idempotency_key: input.idempotencyKey,
          p_request_hash: boundHash,
        });

        if (row.ok === false) {
          throw new PaymentRepositoryError(
            String(row.error || "INTERNAL_ERROR"),
            "Payment recording failed.",
          );
        }

        const dto: PaymentRecordDto = {
          paymentId: String(row.paymentId || row.payment_id),
          receiptId: String(row.receiptId || row.receipt_id),
          status: String(row.status || "submitted"),
          replay: Boolean(row.replay),
        };
        assertNoForbiddenPayload(dto);
        return dto;
      } catch (err) {
        if (uploaded) {
          // Do not claim storage rolled back with the DB — remove/quarantine orphan.
          try {
            await storage.remove(storagePath);
          } catch {
            /* best-effort local remove */
          }
          try {
            await callRpc("mp_quarantine_unattached_upload", {
              p_upload_intent_id: input.uploadIntentId,
            });
          } catch {
            /* best-effort DB quarantine + storage cleanup outbox */
          }
        }
        if (err instanceof PaymentRepositoryError) throw err;
        mapRpcError({ message: String((err as Error)?.message || err) });
      }
    },

    async listOrderPayments(identity, publicRef) {
      const owned = ownershipParams(scopedIdentity(identity, publicRef));
      const row = await callRpc("mp_list_order_payments", {
        p_public_ref: publicRef,
        p_customer_id: owned.p_customer_id,
        p_guest_token_hash: owned.p_guest_token_hash,
      });
      const payments = Array.isArray(row.payments) ? row.payments : [];
      return payments.map((p) => {
        const item = p as Record<string, unknown>;
        return {
          paymentId: String(item.paymentId),
          amount: asNumber(item.amount),
          method: String(item.method),
          status: String(item.status),
          createdAt: String(item.createdAt),
          hasReceipt: Boolean(item.hasReceipt),
        };
      });
    },

    async adminListPayments(actorScope, status) {
      const row = await callRpc("mp_admin_list_payments", {
        p_actor_scope: actorScope,
        p_status: status ?? null,
        p_limit: 50,
      });
      const payments = Array.isArray(row.payments) ? row.payments : [];
      return payments.map((p) => {
        const item = p as Record<string, unknown>;
        return {
          paymentId: String(item.paymentId),
          publicRef: String(item.publicRef),
          amount: asNumber(item.amount),
          method: String(item.method),
          status: String(item.status),
          createdAt: String(item.createdAt),
          verifiedAt: item.verifiedAt ? String(item.verifiedAt) : null,
          hasReceipt: Boolean(item.hasReceipt),
        };
      });
    },

    async adminAction(actorScope, actorId, paymentId, action, input) {
      const hash = requestHash({
        paymentId,
        action,
        reason: input.reason ?? null,
        amount: input.amount ?? null,
      });
      const row = await callRpc("mp_admin_payment_action", {
        p_actor_scope: actorScope,
        p_payment_id: paymentId,
        p_action: action,
        p_actor_id: actorId,
        p_reason: input.reason ?? null,
        p_amount: input.amount ?? null,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: hash,
      });
      assertNoForbiddenPayload(row);
      return row;
    },
  };
}
