/** Coerce Supabase/local row payloads into arrays for .find/.map/.filter. */

export function normalizeRows(input: unknown): any[] {
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeRows(parsed);
    } catch {
      return [];
    }
  }
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.rows)) return obj.rows;
    if (Array.isArray(obj.boqRows)) return obj.boqRows;
    if (Array.isArray(obj.boq_rows)) return obj.boq_rows;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.boqItems)) return obj.boqItems;
    if (Array.isArray(obj.boq_items)) return obj.boq_items;
  }
  return [];
}

/** BOQ rows from a manual quote record (Supabase extended_data shapes). */
export function normalizeQuoteBoqRows(quote: unknown): any[] {
  if (!quote || typeof quote !== "object") return [];
  const q = quote as Record<string, unknown>;
  const fromBoq = normalizeRows(q.boqRows ?? q.boq_rows);
  if (fromBoq.length > 0) return fromBoq;
  const fromItems = normalizeRows(q.boqItems ?? q.boq_items);
  if (fromItems.length > 0) return fromItems;
  return [];
}

export function describeRowsInput(input: unknown): {
  typeofRows: string;
  isArray: boolean;
  normalizedLength: number;
} {
  return {
    typeofRows: typeof input,
    isArray: Array.isArray(input),
    normalizedLength: normalizeRows(input).length,
  };
}
