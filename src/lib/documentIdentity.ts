/**
 * Whose identity a document carries when the company has not set a value.
 *
 * Founding company (and single-company mode): the long-standing Sunchaser defaults stay, so nothing changes for the existing business.
 * Any other company: NO Sunchaser default is ever used. A missing value renders empty or as a neutral word, never as another company's
 * name, address, phone number, e-mail address, website, logo, bank account or legal text.
 *
 * The state a document is rendered from carries the choice: `state.documentIdentity = { neutral: true }` (set where the state is loaded).
 * Branding objects carry `legacyDefaults: false`. A state or branding without the mark behaves exactly as before.
 */
export type DocumentIdentity = { neutral: boolean };

export function isNeutralState(state: unknown): boolean {
  return (state as any)?.documentIdentity?.neutral === true;
}

export function isNeutralBranding(branding: unknown): boolean {
  return (branding as any)?.legacyDefaults === false;
}

/** Picks the Sunchaser default for the founding company and the neutral replacement for every other company. */
export function identityDefault<T>(neutral: boolean, founding: T, neutralValue: T): T {
  return neutral ? neutralValue : founding;
}

/** Generic clauses for a company that has set no terms of its own. They name no company and no region. */
export const NEUTRAL_FALLBACK_QUOTE_TERMS = [
  "This quotation is valid for the period stated on it.",
  "Prices are based on the equipment and rates current on the date of the quotation. Changes in taxes, duties or equipment cost may change the final price.",
  "Payment is due according to the payment schedule agreed with the company.",
  "Work starts after the agreed advance payment is received.",
  "Warranty is as provided by the equipment manufacturer.",
];
