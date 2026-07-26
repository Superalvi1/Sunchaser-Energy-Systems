import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../../dbManager.ts";
import type { MarketplaceIdentity } from "../cart/cartTypes.ts";
import { guestActorScope } from "../cart/cartIdentity.ts";
import type { CodAction, CodMutationDto, CodStatusDto } from "./codTypes.ts";

export class CodRepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type CodRepository = {
  get(
    identity: MarketplaceIdentity,
    publicRef: string,
  ): Promise<CodStatusDto>;
  confirm(
    identity: MarketplaceIdentity,
    publicRef: string,
    idempotencyKey: string,
  ): Promise<CodMutationDto>;
  adminList(actorScope: string): Promise<CodStatusDto[]>;
  adminTransition(
    actorScope: string,
    actorId: string,
    publicRef: string,
    action: CodAction,
    input: { reason?: string; idempotencyKey: string },
  ): Promise<CodMutationDto>;
};

const SAFE = new Set([
  "ORDER_NOT_FOUND",
  "ORDER_NOT_AUTHORIZED",
  "COD_NOT_ALLOWED",
  "COD_ALREADY_CONFIRMED",
  "COD_NOT_CONFIRMED",
  "COD_ALREADY_COLLECTED",
  "COD_COLLECTION_NOT_ALLOWED",
  "INVALID_PAYMENT_METHOD",
  "INVALID_ORDER_STATUS",
  "INVALID_STATUS_TRANSITION",
  "DELIVERY_NOT_DISPATCHED",
  "DELIVERY_ALREADY_COMPLETED",
  "DELIVERY_ATTEMPT_NOT_ALLOWED",
  "DELIVERY_FAILURE_NOT_ALLOWED",
  "DELIVERY_REFUSAL_NOT_ALLOWED",
  "CANCELLATION_NOT_ALLOWED",
  "RETURN_TO_ORIGIN_NOT_ALLOWED",
  "PAYMENT_NOT_FOUND",
  "INVALID_AMOUNT",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "FORBIDDEN_FIELD",
  "UNKNOWN_FIELD",
  "VALIDATION_ERROR",
  "CONFLICT",
  "INTERNAL_ERROR",
  "INVALID_TOKEN",
]);

function mapRpcError(err: { message?: string } | null): never {
  const raw = String(err?.message || "");
  const match = /([A-Z][A-Z0-9_]+):/.exec(raw);
  const code = match?.[1] && SAFE.has(match[1]) ? match[1] : "INTERNAL_ERROR";
  const messages: Record<string, string> = {
    ORDER_NOT_FOUND: "Order not found.",
    ORDER_NOT_AUTHORIZED: "Not authorized.",
    COD_NOT_ALLOWED: "COD is not allowed for this order.",
    COD_ALREADY_CONFIRMED: "COD is already confirmed.",
    COD_NOT_CONFIRMED: "COD is not confirmed.",
    COD_ALREADY_COLLECTED: "COD cash is already collected.",
    COD_COLLECTION_NOT_ALLOWED: "COD collection is not allowed.",
    INVALID_PAYMENT_METHOD: "Invalid payment method.",
    INVALID_ORDER_STATUS: "Invalid order status.",
    INVALID_STATUS_TRANSITION: "Invalid status transition.",
    DELIVERY_ATTEMPT_NOT_ALLOWED: "Delivery attempt is not allowed.",
    DELIVERY_FAILURE_NOT_ALLOWED: "Delivery failure is not allowed.",
    DELIVERY_REFUSAL_NOT_ALLOWED: "Delivery refusal is not allowed.",
    CANCELLATION_NOT_ALLOWED: "Cancellation is not allowed.",
    RETURN_TO_ORIGIN_NOT_ALLOWED: "Return to origin is not allowed.",
    PAYMENT_NOT_FOUND: "Payment not found.",
    INVALID_AMOUNT: "Invalid amount.",
    IDEMPOTENCY_CONFLICT: "Idempotency-Key conflict.",
    CONFLICT: "Conflict.",
    VALIDATION_ERROR: "Validation failed.",
  };
  throw new CodRepositoryError(code, messages[code] || "Request failed.");
}

function assertSafe(payload: unknown): void {
  const forbidden = [
    "actual_purchase_cost",
    "supplier_public_price",
    "margin",
    "profit",
    "guest_token_hash",
    "possessionToken",
    "service_role",
  ];
  const text = JSON.stringify(payload);
  for (const key of forbidden) {
    if (text.includes(`"${key}"`)) {
      throw new CodRepositoryError("INTERNAL_ERROR", "Response failed safety validation.");
    }
  }
}

function ownership(identity: MarketplaceIdentity, publicRef: string) {
  if (identity.kind === "customer") {
    return {
      p_customer_id: identity.customerId,
      p_guest_token_hash: null as string | null,
      p_actor_scope: identity.actorScope,
    };
  }
  return {
    p_customer_id: null as string | null,
    p_guest_token_hash: identity.tokenHash,
    p_actor_scope: guestActorScope(publicRef),
  };
}

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new CodRepositoryError("INTERNAL_ERROR", "Invalid numeric result.");
  }
  return n;
}

function requestHash(parts: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function mapStatus(row: Record<string, unknown>): CodStatusDto {
  return {
    publicRef: String(row.publicRef),
    orderStatus: String(row.orderStatus),
    fulfillmentState: String(row.fulfillmentState),
    planType: String(row.planType || "cod_eligible"),
    paymentMethod: "cash_on_delivery",
    amountDue: asNumber(row.amountDue ?? row.grandTotal ?? 0),
    currency: String(row.currency || "PKR"),
    grandTotal: asNumber(row.grandTotal ?? 0),
    deliveryCharge: asNumber(row.deliveryCharge ?? 0),
    codEligibleZone: Boolean(row.codEligibleZone ?? true),
    paymentStatus: String(row.paymentStatus || "pending"),
    deliveryAttemptCount: asNumber(row.deliveryAttemptCount ?? 0),
    codConfirmedAt: row.codConfirmedAt ? String(row.codConfirmedAt) : null,
    dispatchedAt: row.dispatchedAt ? String(row.dispatchedAt) : null,
  };
}

export type CodRepositoryDeps = {
  clientFactory?: () => SupabaseClient | null;
  rpc?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
};

export function createCodRepository(deps: CodRepositoryDeps = {}): CodRepository {
  const clientFactory = deps.clientFactory ?? getSupabase;

  async function callRpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (deps.rpc) {
      try {
        const row = await deps.rpc(name, args);
        if (row.ok === false && typeof row.error === "string") {
          throw new CodRepositoryError(
            SAFE.has(row.error) ? row.error : "INTERNAL_ERROR",
            "Request failed.",
          );
        }
        assertSafe(row);
        return row;
      } catch (err) {
        if (err instanceof CodRepositoryError) throw err;
        mapRpcError({ message: String((err as Error)?.message || err) });
      }
    }
    if (!isSupabaseActive()) {
      throw new CodRepositoryError("INTERNAL_ERROR", "Marketplace database is unavailable.");
    }
    const client = clientFactory();
    if (!client) {
      throw new CodRepositoryError("INTERNAL_ERROR", "Marketplace database is unavailable.");
    }
    const { data, error } = await client.rpc(name, args);
    if (error) mapRpcError(error);
    if (!data || typeof data !== "object") {
      throw new CodRepositoryError("INTERNAL_ERROR", "Empty RPC result.");
    }
    const row = data as Record<string, unknown>;
    if (row.ok === false && typeof row.error === "string") {
      throw new CodRepositoryError(
        SAFE.has(row.error) ? row.error : "INTERNAL_ERROR",
        "Request failed.",
      );
    }
    assertSafe(row);
    return row;
  }

  return {
    async get(identity, publicRef) {
      const owned = ownership(identity, publicRef);
      const row = await callRpc("mp_cod_get", {
        p_public_ref: publicRef,
        p_customer_id: owned.p_customer_id,
        p_guest_token_hash: owned.p_guest_token_hash,
      });
      return mapStatus(row);
    },

    async confirm(identity, publicRef, idempotencyKey) {
      const owned = ownership(identity, publicRef);
      const hash = requestHash({ publicRef, action: "cod_confirm" });
      const row = await callRpc("mp_cod_confirm", {
        p_public_ref: publicRef,
        p_customer_id: owned.p_customer_id,
        p_guest_token_hash: owned.p_guest_token_hash,
        p_actor_scope: owned.p_actor_scope,
        p_idempotency_key: idempotencyKey,
        p_request_hash: hash,
      });
      return {
        publicRef: String(row.publicRef),
        orderStatus: String(row.orderStatus),
        fulfillmentState: String(row.fulfillmentState),
        paymentStatus: String(row.paymentStatus),
        amountDue: row.amountDue !== undefined ? asNumber(row.amountDue) : undefined,
        currency: row.currency ? String(row.currency) : undefined,
        replay: Boolean(row.replay),
      };
    },

    async adminList(actorScope) {
      const row = await callRpc("mp_admin_list_cod_orders", {
        p_actor_scope: actorScope,
        p_limit: 50,
      });
      const orders = Array.isArray(row.orders) ? row.orders : [];
      return orders.map((o) => mapStatus(o as Record<string, unknown>));
    },

    async adminTransition(actorScope, actorId, publicRef, action, input) {
      const hash = requestHash({
        publicRef,
        action,
        reason: input.reason ?? null,
      });
      const row = await callRpc("mp_cod_admin_transition", {
        p_actor_scope: actorScope,
        p_public_ref: publicRef,
        p_action: action,
        p_actor_id: actorId,
        p_reason: input.reason ?? null,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: hash,
      });
      return {
        publicRef: String(row.publicRef),
        orderStatus: String(row.orderStatus),
        fulfillmentState: String(row.fulfillmentState),
        paymentStatus: String(row.paymentStatus),
        amountDue: row.amountDue !== undefined ? asNumber(row.amountDue) : undefined,
        amountCollected:
          row.amountCollected !== undefined
            ? asNumber(row.amountCollected)
            : undefined,
        deliveryAttemptCount:
          row.deliveryAttemptCount !== undefined
            ? asNumber(row.deliveryAttemptCount)
            : undefined,
        replay: Boolean(row.replay),
      };
    },
  };
}
