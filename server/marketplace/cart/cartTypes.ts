/**
 * Public cart / delivery / checkout DTOs (API version 1).
 * Never include costs, margins, supplier analytics, or possession tokens (except create).
 */

export {
  MARKETPLACE_API_VERSION,
  MARKETPLACE_API_VERSION_HEADER,
} from "../catalogue/catalogueTypes.ts";

export type CartCreatedDto = {
  publicRef: string;
  expiresAt: string;
  /** Raw guest possession token — present only on guest cart create. */
  possessionToken?: string;
};

export type CartItemDto = {
  publicRef: string;
  sku: string;
  quantity: number;
  unitPrice: number;
};

export type DeliveryQuoteDto = {
  publicRef: string;
  zoneCode: string;
  subtotal: number;
  deliveryCharge: number;
  codEligible: boolean;
  grandTotal: number;
};

export type CheckoutDto = {
  publicRef: string;
  orderNumber: string;
  cartPublicRef: string;
  planType: string;
  zoneCode: string;
  codEligible: boolean;
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  replay: boolean;
};

export type OrderItemDto = {
  sku: string;
  title: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type OrderDto = {
  publicRef: string;
  orderNumber: string;
  status: string;
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  currency: string;
  items: OrderItemDto[];
};

export type MarketplaceIdentity =
  | { kind: "customer"; customerId: string; actorScope: string }
  | { kind: "guest"; tokenHash: string; actorScope: string; rawToken?: string };
