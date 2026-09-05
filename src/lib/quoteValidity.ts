/**
 * Quotation validity is an existing Sunchaser commercial term
 * ("valid for three (3) calendar days") — not a new legal period.
 *
 * Resolution order:
 *   1. saved quote.validityDays
 *   2. parse quote.termsAndConditions
 *   3. parse company_terms
 *   4. parse settings.termsAndConditionsList
 *   5. existing company default of 3 days (same seed / old PDF compiler)
 */

const WORD_TO_DAYS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  ten: 10,
  fifteen: 15,
  thirty: 30,
};

/** Existing company_terms / settings seed and the pre-existing 11-page PDF compiler. */
export const EXISTING_COMPANY_VALIDITY_DAYS = 3;

export type QuoteValiditySource =
  | "quote.validityDays"
  | "quote.termsAndConditions"
  | "company_terms"
  | "settings.termsAndConditionsList"
  | "existing_company_default";

export interface ResolvedQuoteValidity {
  days: number;
  source: QuoteValiditySource;
}

export function parseValidityDaysFromText(raw: unknown): number | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (!/valid/.test(lower)) return null;

  const combined = lower.match(
    /valid(?:ity)?[\s\S]{0,80}?(?:(one|two|three|four|five|six|seven|ten|fifteen|thirty)|(\d{1,3}))\s*(?:\(\s*\d+\s*\))?\s*(?:calendar\s*)?days/
  );
  if (combined) {
    if (combined[1] && WORD_TO_DAYS[combined[1]]) return WORD_TO_DAYS[combined[1]];
    const n = Number(combined[2]);
    if (Number.isFinite(n) && n > 0 && n < 366) return n;
  }

  return null;
}

function readCompanyTerms(activeState: any): string[] {
  const rows = Array.isArray(activeState?.companyTerms) ? activeState.companyTerms : [];
  return rows
    .map((t: any) => String(t?.termText || t?.term_text || "").trim())
    .filter(Boolean);
}

function readSettingsTermList(activeState: any): string[] {
  const settings = activeState?.settings;
  const blob = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  const list = Array.isArray(blob.termsAndConditionsList) ? blob.termsAndConditionsList : [];
  return list.map((t: unknown) => String(t || "").trim()).filter(Boolean);
}

export function resolveQuoteValidityDays(quoteObj: any, activeState?: any): ResolvedQuoteValidity {
  const saved = Number(quoteObj?.validityDays ?? quoteObj?.validity_days);
  if (Number.isFinite(saved) && saved > 0 && saved < 366) {
    return { days: Math.floor(saved), source: "quote.validityDays" };
  }

  const fromQuoteTerms = parseValidityDaysFromText(quoteObj?.termsAndConditions);
  if (fromQuoteTerms) {
    return { days: fromQuoteTerms, source: "quote.termsAndConditions" };
  }

  for (const clause of readCompanyTerms(activeState)) {
    const days = parseValidityDaysFromText(clause);
    if (days) return { days, source: "company_terms" };
  }

  for (const clause of readSettingsTermList(activeState)) {
    const days = parseValidityDaysFromText(clause);
    if (days) return { days, source: "settings.termsAndConditionsList" };
  }

  return { days: EXISTING_COMPANY_VALIDITY_DAYS, source: "existing_company_default" };
}
