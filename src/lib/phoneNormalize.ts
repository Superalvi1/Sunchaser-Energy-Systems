/** Strip spaces/dashes and non-digits except leading + for parsing. */
export function stripPhoneFormatting(phone: string): string {
  return String(phone || "").replace(/[\s\-().]/g, "").trim();
}

/**
 * Normalize Pakistan mobile to canonical `92XXXXXXXXXX` (12 digits after country code).
 * Handles 03xx, +923xx, 923xx.
 */
export function normalizePakistanPhone(phone: string): string | null {
  let raw = stripPhoneFormatting(phone);
  if (!raw) return null;
  if (raw.startsWith("+")) raw = raw.slice(1);
  raw = raw.replace(/\D/g, "");
  if (!raw) return null;

  if (raw.startsWith("92") && raw.length >= 12) {
    return raw.slice(0, 12);
  }
  if (raw.startsWith("0") && raw.length === 11) {
    return `92${raw.slice(1)}`;
  }
  if (raw.length === 10 && raw.startsWith("3")) {
    return `92${raw}`;
  }
  return raw.length >= 10 ? raw : null;
}

/** Compare two phone strings after normalization. */
export function phonesMatch(a: string, b: string): boolean {
  const na = normalizePakistanPhone(a);
  const nb = normalizePakistanPhone(b);
  if (!na || !nb) return false;
  return na === nb;
}
