export {
  MARKETPLACE_API_VERSION,
  MARKETPLACE_API_VERSION_HEADER,
} from "../cart/cartTypes.ts";
export type { MarketplaceIdentity } from "../cart/cartTypes.ts";

export type CodAction =
  | "confirm"
  | "dispatch"
  | "delivery_attempt"
  | "collect"
  | "fail"
  | "refuse"
  | "cancel"
  | "return_start"
  | "return_complete";

export type CodStatusDto = {
  publicRef: string;
  orderStatus: string;
  fulfillmentState: string;
  planType: string;
  paymentMethod: "cash_on_delivery";
  amountDue: number;
  currency: string;
  grandTotal: number;
  deliveryCharge: number;
  codEligibleZone: boolean;
  paymentStatus: string;
  deliveryAttemptCount: number;
  codConfirmedAt: string | null;
  dispatchedAt: string | null;
};

export type CodMutationDto = {
  publicRef: string;
  orderStatus: string;
  fulfillmentState: string;
  paymentStatus: string;
  amountDue?: number;
  amountCollected?: number;
  currency?: string;
  deliveryAttemptCount?: number;
  replay: boolean;
};
