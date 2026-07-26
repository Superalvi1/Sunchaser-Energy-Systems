export {
  MARKETPLACE_API_VERSION,
  MARKETPLACE_API_VERSION_HEADER,
} from "../cart/cartTypes.ts";
export type { MarketplaceIdentity } from "../cart/cartTypes.ts";

export const RECEIPT_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "application/pdf",
] as const;

export type ReceiptMimeType = (typeof RECEIPT_ALLOWED_MIME)[number];

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

export type PaymentPreflightDto = {
  publicRef: string;
  orderStatus: string;
  planType: string;
  paymentMethod: "bank_transfer";
  currency: string;
  amountDue: number;
  grandTotal: number;
  netPaid: number;
  receiptConstraints: {
    allowedMimeTypes: string[];
    maxBytes: number;
  };
};

export type UploadIntentDto = {
  uploadIntentId: string;
  status: string;
  expiresAt: string | null;
  allowedMimeTypes: string[];
  maxBytes: number;
  amountDue: number;
  currency: string;
  replay: boolean;
};

export type PaymentRecordDto = {
  paymentId: string;
  receiptId: string;
  status: string;
  replay: boolean;
};

export type OrderPaymentDto = {
  paymentId: string;
  amount: number;
  method: string;
  status: string;
  createdAt: string;
  hasReceipt: boolean;
};

export type AdminPaymentDto = {
  paymentId: string;
  publicRef: string;
  amount: number;
  method: string;
  status: string;
  createdAt: string;
  verifiedAt: string | null;
  hasReceipt: boolean;
};
