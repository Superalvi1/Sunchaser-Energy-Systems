/** Resolve sortable timestamp for saved quotations (updated_at preferred). */
export function getQuoteSortTime(quote?: {
  updatedAt?: string;
  updated_at?: string;
  createdAt?: string;
  created_at?: string;
} | null): number {
  const raw =
    quote?.updatedAt ||
    quote?.updated_at ||
    quote?.createdAt ||
    quote?.created_at ||
    "";
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function countQuoteItemRows(quote?: { boqRows?: any[]; boqItems?: any[] } | null): number {
  const rows = quote?.boqRows || quote?.boqItems || [];
  return rows.filter((r) => r && r.type === "item").length;
}

/** Most recently saved quote for a lead (ORDER BY updated_at DESC, LIMIT 1). */
export function getLatestSavedQuote(
  lead?: { quotes?: any[] } | null,
  quoteType?: "manual_boq" | "auto_sizer"
): any | null {
  const list = (lead?.quotes || []).filter((q) => {
    if (!q?.id) return false;
    if (quoteType && q.quote_type !== quoteType) return false;
    return countQuoteItemRows(q) > 0 || quoteType === "auto_sizer";
  });
  if (!list.length) return null;
  return [...list].sort((a, b) => getQuoteSortTime(b) - getQuoteSortTime(a))[0];
}

export function getLeadManualQuotesSorted(lead?: { quotes?: any[] } | null): any[] {
  return (lead?.quotes || [])
    .filter((q) => q?.quote_type === "manual_boq")
    .sort((a, b) => getQuoteSortTime(b) - getQuoteSortTime(a));
}
