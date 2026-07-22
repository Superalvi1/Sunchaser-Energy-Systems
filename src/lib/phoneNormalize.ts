/** Strip spaces/dashes and common phone punctuation for parsing. */
export function stripPhoneFormatting(phone: string): string {
  return String(phone || "").replace(/[\s\-().]/g, "").trim();
}

/**
 * Normalize a Pakistan mobile number to canonical `92XXXXXXXXXX` (12 digits).
 *
 * Accepted equivalent inputs (formatting spaces/dashes stripped first):
 * - `03XXXXXXXXX` (11 digits)
 * - `3XXXXXXXXX` (10 digits)
 * - `923XXXXXXXXX`
 * - `+923XXXXXXXXX`
 * - `00923XXXXXXXXX`
 *
 * Returns null for empty, non-mobile, or otherwise unusable values.
 * Does not invent placeholders.
 */
export function normalizePakistanPhone(phone: string): string | null {
  let raw = stripPhoneFormatting(phone);
  if (!raw) return null;

  if (raw.startsWith("+")) raw = raw.slice(1);
  if (raw.startsWith("00")) raw = raw.slice(2);
  raw = raw.replace(/\D/g, "");
  if (!raw) return null;

  let candidate: string | null = null;
  if (raw.startsWith("92") && raw.length === 12) {
    candidate = raw;
  } else if (raw.startsWith("0") && raw.length === 11) {
    candidate = `92${raw.slice(1)}`;
  } else if (raw.length === 10 && raw.startsWith("3")) {
    candidate = `92${raw}`;
  }

  // Pakistan mobiles: 92 + 3XXXXXXXXX
  if (!candidate || !/^923\d{9}$/.test(candidate)) return null;
  return candidate;
}

/**
 * Bounded exact-match forms for DB lookup when no normalized_phone column exists.
 * Limitation: leads stored with unusual formatting (embedded spaces, etc.) may not hit.
 */
export function pakistanMobileLookupForms(canonical92: string): string[] {
  const normalized = normalizePakistanPhone(canonical92);
  if (!normalized) return [];
  const national = normalized.slice(2); // 3XXXXXXXXX
  return [
    normalized,
    `0${national}`,
    `+${normalized}`,
    `00${normalized}`,
  ];
}

/** Compare two phone strings after canonical Pakistan mobile normalization. */
export function phonesMatch(a: string, b: string): boolean {
  const na = normalizePakistanPhone(a);
  const nb = normalizePakistanPhone(b);
  if (!na || !nb) return false;
  return na === nb;
}
