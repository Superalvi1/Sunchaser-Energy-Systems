/** Manual quotation discount calculations (percentage or fixed amount). */

export type QuoteDiscountType = "percentage" | "fixed";

export type QuoteDiscountInput = {
  discountType?: QuoteDiscountType | string;
  discountValue?: number;
  /** Legacy flat discount amount (fixed PKR). */
  discount?: number;
};

export function resolveQuoteDiscountAmount(
  subtotal: number,
  input: QuoteDiscountInput = {}
): {
  discountAmount: number;
  discountType: QuoteDiscountType;
  discountValue: number;
  discountLabel: string;
} {
  const base = Math.max(0, Number(subtotal) || 0);
  const legacy = Math.max(0, Number(input.discount) || 0);
  const rawType = String(input.discountType || "").toLowerCase();
  const type: QuoteDiscountType = rawType === "percentage" ? "percentage" : "fixed";

  if (!input.discountType && legacy > 0) {
    return {
      discountAmount: Math.min(base, legacy),
      discountType: "fixed",
      discountValue: legacy,
      discountLabel: "Discount",
    };
  }

  const value = Math.max(0, Number(input.discountValue) || 0);

  if (type === "percentage") {
    const pct = Math.min(100, value);
    const amount = Math.round(base * (pct / 100));
    return {
      discountAmount: amount,
      discountType: "percentage",
      discountValue: pct,
      discountLabel: `Discount (${pct}%)`,
    };
  }

  const amount = Math.min(base, value);
  return {
    discountAmount: amount,
    discountType: "fixed",
    discountValue: value,
    discountLabel: "Discount",
  };
}

export function computeNetProposalValue(
  subtotal: number,
  discountAmount: number,
  extras: { taxAmount?: number; societyCharges?: number } = {}
): number {
  const tax = Math.max(0, Number(extras.taxAmount) || 0);
  const society = Math.max(0, Number(extras.societyCharges) || 0);
  return Math.max(0, subtotal - discountAmount + tax + society);
}
