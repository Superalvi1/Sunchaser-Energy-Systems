/** Phase 24 — Invoice-linked partial delivery challans */

export const PUBLIC_VERIFICATION_STATUSES = [
  "pending",
  "verified",
  "disputed",
  "expired",
] as const;

export type PublicVerificationStatus = (typeof PUBLIC_VERIFICATION_STATUSES)[number];

export const DELIVERY_STATUSES = [
  "draft",
  "out_for_delivery",
  "delivered_pending_verification",
  "verified_received",
  "disputed",
  "cancelled",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const PHOTO_TYPES = [
  "material",
  "serial",
  "vehicle",
  "site",
  "receiver",
  "damaged",
  "other",
] as const;

export type PhotoType = (typeof PHOTO_TYPES)[number];

export const RECEIVER_RELATIONS = [
  "owner",
  "brother",
  "guard",
  "supervisor",
  "other",
] as const;

export type ReceiverRelation = (typeof RECEIVER_RELATIONS)[number];

export type VerificationChecklist = {
  receivedMaterial: boolean;
  quantityCorrect: boolean;
  conditionAcceptable: boolean;
};

export type DisputeItemReport = {
  itemId: string;
  itemName?: string;
  issueType: "missing" | "damaged";
  notes?: string;
};

export type DisputeDetails = {
  comments?: string;
  items?: DisputeItemReport[];
};

export type DeliveryChallanItem = {
  id: string;
  challanId: string;
  invoiceItemId: string | null;
  inventoryItemId: string | null;
  itemName: string;
  category: string;
  invoiceQty: number;
  previouslyDeliveredQty: number;
  deliverNowQty: number;
  remainingQtyAfter: number;
  serialNumber: string;
  conditionNotes: string;
  createdAt: string;
};

export type DeliveryChallanPhoto = {
  id: string;
  challanId: string;
  photoUrl: string;
  photoType: PhotoType;
  caption: string;
  uploadedBy: string | null;
  uploadedAt: string;
};

export type DeliveryChallan = {
  id: string;
  challanNumber: string;
  invoiceId: string;
  projectId: string | null;
  customerId: string | null;
  leadId: string | null;
  quotationId: string | null;
  status: DeliveryStatus;
  deliveryTitle: string;
  deliveryDate: string | null;
  vehicleNumber: string;
  driverName: string;
  installerName: string;
  receiverName: string;
  receiverPhone: string;
  receiverCnic: string;
  receiverRelation: string;
  otpCode: string | null;
  otpSentAt: string | null;
  otpVerifiedAt: string | null;
  verifiedByPhone: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsAddress: string;
  signedAt: string | null;
  signatureImageUrl: string | null;
  verificationChecklist: VerificationChecklist;
  disputeReason: string | null;
  disputeDetails: DisputeDetails;
  verificationToken: string | null;
  tokenExpiresAt: string | null;
  publicVerificationStatus: PublicVerificationStatus;
  verifiedAt: string | null;
  verifiedIp: string | null;
  verifiedUserAgent: string | null;
  signedByName: string | null;
  signedByPhone: string | null;
  signedRelation: string | null;
  notes: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  items?: DeliveryChallanItem[];
  photos?: DeliveryChallanPhoto[];
};

export type InvoiceDeliverySummary = {
  invoiceId: string;
  totalInvoiceQty: number;
  totalDeliveredQty: number;
  deliveredPercent: number;
  remainingQty: number;
  challanCount: number;
  verifiedCount: number;
  pendingCount: number;
  lineSummaries: {
    invoiceItemId: string;
    itemName: string;
    invoiceQty: number;
    deliveredQty: number;
    remainingQty: number;
  }[];
};

const LOCKED_STATUSES = new Set<DeliveryStatus>(["verified_received", "disputed"]);

export function isChallanLocked(status: string): boolean {
  return LOCKED_STATUSES.has(status as DeliveryStatus);
}

export function moneyRound(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Statuses that allocate qty against invoice remaining (not draft/cancelled). */
export const ALLOCATING_STATUSES = new Set<DeliveryStatus>([
  "out_for_delivery",
  "delivered_pending_verification",
  "verified_received",
  "disputed",
]);

export function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function generateVerificationToken(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function tokenExpiresInDays(days = 7): string {
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
}

export function isVerificationTokenExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

export function buildWhatsAppVerificationMessage(input: {
  customerName: string;
  invoiceNumber: string;
  challanNumber: string;
  verificationUrl: string;
}): string {
  const name = input.customerName || "Customer";
  return `Dear ${name},

Thank you for choosing Sunchaser Energy Systems.

Your material delivery is ready for confirmation.

Invoice: ${input.invoiceNumber}
Delivery Challan: ${input.challanNumber}

Please verify your received material using the secure link below:

${input.verificationUrl}

This link is valid for 7 days and is unique to your delivery.

Thank you,
Sunchaser Energy Systems`;
}

export function buildWhatsAppVerificationLink(phone: string | undefined, message: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  const text = encodeURIComponent(message);
  if (digits) return `https://wa.me/${digits}?text=${text}`;
  return `https://wa.me/?text=${text}`;
}

export function validateDeliverNowQty(
  deliverNow: unknown,
  invoiceQty: unknown,
  previouslyDelivered: unknown
): { ok: true; qty: number } | { ok: false; error: string } {
  const qty = num(deliverNow);
  const inv = Math.max(0, num(invoiceQty));
  const prev = Math.max(0, num(previouslyDelivered));
  const remaining = Math.max(0, inv - prev);
  if (qty <= 0) return { ok: false, error: "Deliver now quantity must be greater than 0." };
  if (qty > remaining) {
    return {
      ok: false,
      error: `Cannot deliver ${qty}. Only ${remaining} remaining (${prev} already allocated).`,
    };
  }
  return { ok: true, qty };
}

export function computeInvoiceDeliverySummary(
  invoiceItems: { id?: string; itemName?: string; description?: string; qty?: number }[],
  challans: DeliveryChallan[],
  challanItemsByChallan: Map<string, DeliveryChallanItem[]>
): InvoiceDeliverySummary {
  const invoiceId = challans[0]?.invoiceId || "";
  const lineSummaries = (invoiceItems || []).map((it) => {
    const invoiceItemId = String(it.id || "");
    const invoiceQty = Math.max(0, num(it.qty, 1));
    let deliveredQty = 0;
    let allocatedQty = 0;
    for (const ch of challans) {
      if (ch.status === "cancelled" || ch.status === "draft") continue;
      const items = challanItemsByChallan.get(ch.id) || [];
      for (const row of items) {
        if (row.invoiceItemId !== invoiceItemId) continue;
        allocatedQty += row.deliverNowQty;
        if (ch.status === "verified_received") deliveredQty += row.deliverNowQty;
      }
    }
    return {
      invoiceItemId,
      itemName: String(it.itemName || it.description || "Item"),
      invoiceQty,
      deliveredQty,
      remainingQty: Math.max(0, invoiceQty - allocatedQty),
    };
  });

  const totalInvoiceQty = lineSummaries.reduce((s, l) => s + l.invoiceQty, 0);
  const totalDeliveredQty = lineSummaries.reduce((s, l) => s + l.deliveredQty, 0);
  const remainingQty = lineSummaries.reduce((s, l) => s + l.remainingQty, 0);
  const deliveredPercent =
    totalInvoiceQty > 0 ? moneyRound((totalDeliveredQty / totalInvoiceQty) * 100) : 0;

  return {
    invoiceId,
    totalInvoiceQty,
    totalDeliveredQty,
    deliveredPercent,
    remainingQty,
    challanCount: challans.filter((c) => c.status !== "cancelled").length,
    verifiedCount: challans.filter((c) => c.status === "verified_received").length,
    pendingCount: challans.filter((c) =>
      ["out_for_delivery", "delivered_pending_verification", "draft"].includes(c.status)
    ).length,
    lineSummaries,
  };
}

export function computePreviouslyDeliveredQty(
  invoiceItemId: string,
  challans: DeliveryChallan[],
  itemsByChallan: Map<string, DeliveryChallanItem[]>,
  excludeChallanId?: string
): number {
  let total = 0;
  for (const ch of challans) {
    if (ch.id === excludeChallanId) continue;
    if (ch.status === "cancelled" || ch.status === "draft") continue;
    const items = itemsByChallan.get(ch.id) || [];
    for (const row of items) {
      if (row.invoiceItemId === invoiceItemId) total += row.deliverNowQty;
    }
  }
  return total;
}

export type DeliveryDashboardSummary = {
  deliveriesToday: number;
  pendingDeliveries: number;
  verifiedDeliveries: number;
  materialsPendingValue: number;
};

export function buildOtpWhatsAppText(challan: DeliveryChallan, customerName: string): string {
  return `Sunchaser Energy — Delivery OTP for ${customerName || "customer"}\nChallan: ${challan.challanNumber}\nOTP: ${challan.otpCode}\nPlease share this code with the delivery team upon receipt.`;
}
