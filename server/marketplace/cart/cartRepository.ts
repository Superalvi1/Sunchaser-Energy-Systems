import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../../dbManager.ts";
import type {
  CartCreatedDto,
  CartItemDto,
  CheckoutDto,
  DeliveryQuoteDto,
  MarketplaceIdentity,
  OrderDto,
} from "./cartTypes.ts";
import { guestActorScope } from "./cartIdentity.ts";

export class CartRepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type CartRepository = {
  createCart(
    identity: MarketplaceIdentity,
    ttlHours: number,
  ): Promise<CartCreatedDto>;
  upsertItem(
    identity: MarketplaceIdentity,
    publicRef: string,
    sku: string,
    quantity: number,
  ): Promise<CartItemDto>;
  quoteDelivery(
    identity: MarketplaceIdentity,
    publicRef: string,
    zoneCode: string,
  ): Promise<DeliveryQuoteDto>;
  checkout(
    identity: MarketplaceIdentity,
    input: {
      publicRef: string;
      zoneCode: string;
      planType: string;
      idempotencyKey: string;
    },
  ): Promise<CheckoutDto>;
  getOrder(
    identity: MarketplaceIdentity,
    publicRef: string,
  ): Promise<OrderDto>;
};

const SAFE_ERROR_CODES = new Set([
  "CART_NOT_FOUND",
  "CART_NOT_AUTHORIZED",
  "CART_EXPIRED",
  "CART_ALREADY_CHECKED_OUT",
  "PRODUCT_NOT_FOUND",
  "VARIANT_NOT_FOUND",
  "PRODUCT_UNAVAILABLE",
  "CONFIRM_PRICE_REQUIRED",
  "STOCK_NOT_ELIGIBLE",
  "INVALID_QUANTITY",
  "INVALID_DELIVERY_ZONE",
  "DELIVERY_NOT_AVAILABLE",
  "COD_NOT_AVAILABLE",
  "PRICE_CHANGED",
  "EMPTY_CART",
  "INVALID_TOKEN",
  "TOKEN_EXPIRED",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "VALIDATION_ERROR",
  "CONFLICT",
  "INTERNAL_ERROR",
]);

function mapRpcError(err: { message?: string; code?: string } | null): never {
  const raw = String(err?.message || "");
  const match = /([A-Z][A-Z0-9_]+):/.exec(raw);
  const code = match?.[1] && SAFE_ERROR_CODES.has(match[1])
    ? match[1]
    : "INTERNAL_ERROR";
  const messages: Record<string, string> = {
    CART_NOT_FOUND: "Cart not found.",
    CART_NOT_AUTHORIZED: "Not authorized.",
    CART_EXPIRED: "Cart has expired.",
    CART_ALREADY_CHECKED_OUT: "Cart already checked out.",
    VARIANT_NOT_FOUND: "Variant not found.",
    PRODUCT_UNAVAILABLE: "Product is unavailable.",
    CONFIRM_PRICE_REQUIRED: "Price confirmation required.",
    STOCK_NOT_ELIGIBLE: "Stock is not eligible.",
    INVALID_QUANTITY: "Invalid quantity.",
    INVALID_DELIVERY_ZONE: "Invalid delivery zone.",
    DELIVERY_NOT_AVAILABLE: "Delivery is not available.",
    COD_NOT_AVAILABLE: "COD is not available.",
    PRICE_CHANGED: "Cart price changed.",
    EMPTY_CART: "Cart is empty.",
    IDEMPOTENCY_CONFLICT: "Idempotency-Key conflict.",
    CONFLICT: "Conflict.",
    VALIDATION_ERROR: "Validation failed.",
  };
  throw new CartRepositoryError(
    code,
    messages[code] || "Request failed.",
  );
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
  ];
  const text = JSON.stringify(payload);
  for (const key of forbidden) {
    if (text.includes(`"${key}"`)) {
      throw new CartRepositoryError(
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
    throw new CartRepositoryError("INTERNAL_ERROR", "Invalid numeric result.");
  }
  return n;
}

function requestHash(input: {
  publicRef: string;
  zoneCode: string;
  planType: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        publicRef: input.publicRef,
        zoneCode: input.zoneCode,
        planType: input.planType,
      }),
    )
    .digest("hex");
}

export function createSupabaseCartRepository(
  clientFactory: () => SupabaseClient | null = getSupabase,
): CartRepository {
  function requireClient(): SupabaseClient {
    if (!isSupabaseActive()) {
      throw new CartRepositoryError(
        "INTERNAL_ERROR",
        "Marketplace database is unavailable.",
      );
    }
    const client = clientFactory();
    if (!client) {
      throw new CartRepositoryError(
        "INTERNAL_ERROR",
        "Marketplace database is unavailable.",
      );
    }
    return client;
  }

  async function callRpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const supabase = requireClient();
    const { data, error } = await supabase.rpc(name, args);
    if (error) mapRpcError(error);
    if (!data || typeof data !== "object") {
      throw new CartRepositoryError("INTERNAL_ERROR", "Empty RPC result.");
    }
    const row = data as Record<string, unknown>;
    if (row.ok === false && row.error && typeof row.error === "object") {
      const err = row.error as { code?: string; message?: string };
      const code =
        err.code && SAFE_ERROR_CODES.has(err.code) ? err.code : "INTERNAL_ERROR";
      throw new CartRepositoryError(code, err.message || "Request failed.");
    }
    assertNoForbiddenPayload(row);
    return row;
  }

  return {
    async createCart(identity, ttlHours) {
      const owned = ownershipParams(identity);
      // Guest create uses guest:pending until publicRef is known.
      const actorScope =
        identity.kind === "guest" ? "guest:pending" : owned.p_actor_scope;
      const row = await callRpc("mp_cart_create", {
        p_actor_scope: actorScope,
        p_customer_id: owned.p_customer_id,
        p_guest_token_hash: owned.p_guest_token_hash,
        p_ttl_hours: ttlHours,
      });

      const dto: CartCreatedDto = {
        publicRef: String(row.publicRef),
        expiresAt: String(row.expiresAt),
      };
      if (identity.kind === "guest" && identity.rawToken) {
        dto.possessionToken = identity.rawToken;
      }
      assertNoForbiddenPayload(dto);
      return dto;
    },

    async upsertItem(identity, publicRef, sku, quantity) {
      const owned = ownershipParams({
        ...identity,
        actorScope:
          identity.kind === "guest"
            ? guestActorScope(publicRef)
            : identity.actorScope,
      });
      const row = await callRpc("mp_cart_upsert_item", {
        ...owned,
        p_public_ref: publicRef,
        p_variant_sku: sku,
        p_quantity: quantity,
      });
      return {
        publicRef: String(row.publicRef),
        sku: String(row.sku),
        quantity: asNumber(row.quantity),
        unitPrice: asNumber(row.unitPrice),
      };
    },

    async quoteDelivery(identity, publicRef, zoneCode) {
      const owned = ownershipParams({
        ...identity,
        actorScope:
          identity.kind === "guest"
            ? guestActorScope(publicRef)
            : identity.actorScope,
      });
      const row = await callRpc("mp_cart_quote_delivery", {
        ...owned,
        p_public_ref: publicRef,
        p_zone_code: zoneCode,
      });
      return {
        publicRef: String(row.publicRef),
        zoneCode: String(row.zoneCode),
        subtotal: asNumber(row.subtotal),
        deliveryCharge: asNumber(row.deliveryCharge),
        codEligible: Boolean(row.codEligible),
        grandTotal: asNumber(row.grandTotal),
      };
    },

    async checkout(identity, input) {
      const actorScope =
        identity.kind === "guest"
          ? guestActorScope(input.publicRef)
          : identity.actorScope;
      const owned = ownershipParams({ ...identity, actorScope });
      const row = await callRpc("mp_cart_checkout", {
        ...owned,
        p_public_ref: input.publicRef,
        p_zone_code: input.zoneCode,
        p_plan_type: input.planType,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: requestHash(input),
      });
      return {
        publicRef: String(row.publicRef),
        orderNumber: String(row.orderNumber),
        cartPublicRef: String(row.cartPublicRef),
        planType: String(row.planType),
        zoneCode: String(row.zoneCode),
        codEligible: Boolean(row.codEligible),
        subtotal: asNumber(row.subtotal),
        deliveryCharge: asNumber(row.deliveryCharge),
        grandTotal: asNumber(row.grandTotal),
        replay: Boolean(row.replay),
      };
    },

    async getOrder(identity, publicRef) {
      const owned = ownershipParams({
        ...identity,
        actorScope:
          identity.kind === "guest"
            ? guestActorScope(publicRef)
            : identity.actorScope,
      });
      const row = await callRpc("mp_order_get", {
        p_public_ref: publicRef,
        p_customer_id: owned.p_customer_id,
        p_guest_token_hash: owned.p_guest_token_hash,
      });
      const items = Array.isArray(row.items) ? row.items : [];
      return {
        publicRef: String(row.publicRef),
        orderNumber: String(row.orderNumber),
        status: String(row.status),
        subtotal: asNumber(row.subtotal),
        deliveryCharge: asNumber(row.deliveryCharge),
        grandTotal: asNumber(row.grandTotal),
        currency: String(row.currency || "PKR"),
        items: items.map((item) => {
          const i = item as Record<string, unknown>;
          return {
            sku: String(i.sku),
            title: String(i.title),
            quantity: asNumber(i.quantity),
            unitPrice: asNumber(i.unitPrice),
            lineTotal: asNumber(i.lineTotal),
          };
        }),
      };
    },
  };
}
