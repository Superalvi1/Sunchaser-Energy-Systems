/**
 * Pakistan mobile phone normalization (RC-1.2.1 / Codex remediation).
 *
 * Strict accepted forms only (after trimming and approved-separator removal):
 * - 03XXXXXXXXX
 * - 3XXXXXXXXX
 * - 923XXXXXXXXX
 * - +923XXXXXXXXX
 * - 00923XXXXXXXXX
 *
 * Approved separators (existing repository policy): spaces, dashes, (), .
 * Letters, HTML, extra plus signs, and foreign prefixes are rejected — never
 * stripped via a catch-all non-digit filter.
 */

/** Existing separator policy — do not expand without an explicit product decision. */
const APPROVED_SEPARATORS = /[\s\-().]/g;

/**
 * National mobile body `3XXXXXXXXX` (10 digits) is a placeholder when the
 * 9-digit subscriber tail is all zeros or a single repeated digit.
 * Does not reject ordinary numbers that merely contain some repeated digits.
 */
export function isPlaceholderPakistanMobileNational(national10: string): boolean {
  if (!/^3\d{9}$/.test(national10)) return false;
  const tail = national10.slice(1);
  if (/^0{9}$/.test(tail)) return true;
  if (/^(\d)\1{8}$/.test(tail)) return true;
  return false;
}

/** Strip only approved separators; does not remove letters or other characters. */
export function stripPhoneFormatting(phone: string): string {
  return String(phone || "").replace(APPROVED_SEPARATORS, "").trim();
}

/**
 * Normalize a Pakistan mobile number to canonical `923XXXXXXXXX` (12 digits).
 * Returns null for empty, malformed, foreign, placeholder, or otherwise unusable values.
 */
export function normalizePakistanPhone(phone: string): string | null {
  const trimmed = String(phone ?? "").trim();
  if (!trimmed) return null;

  const compact = stripPhoneFormatting(trimmed);
  if (!compact) return null;

  let national: string | null = null;
  if (/^\+923\d{9}$/.test(compact)) {
    national = compact.slice(3);
  } else if (/^00923\d{9}$/.test(compact)) {
    national = compact.slice(4);
  } else if (/^923\d{9}$/.test(compact)) {
    national = compact.slice(2);
  } else if (/^03\d{9}$/.test(compact)) {
    national = compact.slice(1);
  } else if (/^3\d{9}$/.test(compact)) {
    national = compact;
  } else {
    return null;
  }

  if (!/^3\d{9}$/.test(national)) return null;
  if (isPlaceholderPakistanMobileNational(national)) return null;
  return `92${national}`;
}

/**
 * Bounded exact-match storage forms for DB lookup (no normalized_phone column).
 * Deterministic order, fixed size (5), no duplicates, no malformed variants.
 */
export function pakistanMobileLookupForms(canonical92: string): string[] {
  const normalized = normalizePakistanPhone(canonical92);
  if (!normalized) return [];
  const national = normalized.slice(2); // 3XXXXXXXXX
  return [
    normalized,
    `+${normalized}`,
    `00${normalized}`,
    `0${national}`,
    national,
  ];
}

/** Compare two phone strings after canonical Pakistan mobile normalization. */
export function phonesMatch(a: string, b: string): boolean {
  const na = normalizePakistanPhone(a);
  const nb = normalizePakistanPhone(b);
  if (!na || !nb) return false;
  return na === nb;
}
