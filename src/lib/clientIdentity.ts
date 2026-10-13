/**
 * Conservative "do these two names plausibly refer to the same person?" test.
 *
 * This is a HINT for staff and a guard for already-verified sources. It is NOT an authorisation check: a public Smart
 * Quote never attaches to an existing lead because a name and phone agree (anyone who knows a client's name and number
 * could claim to be them). It is used to (1) word the "possible existing client" note staff see on a new lead,
 * (2) pick among several leads on a number whose phone was authenticated by the channel (the WhatsApp sender), and
 * (3) group likely duplicates in the staff CRM, always labelled unverified. When unsure this returns false.
 *
 * Rule (after normalisation: Unicode NFKC, case-folded, diacritics and punctuation removed, honorifics dropped,
 * Muhammad spellings unified):
 *   1. identical token sets (order and repetition ignored) match;
 *   2. otherwise the shorter name must contain at least TWO tokens and every one of them must appear in the
 *      longer name ("Ahmed Khan" matches "Ahmed Raza Khan");
 *   3. a single shared token never matches on its own ("Ahmed" vs "Ahmed Khan", "Muhammad Ali" vs "Muhammad Hassan").
 * Spelling variants ("Ahmed"/"Ahmad"), initials ("A. Khan") and transliteration (Urdu script vs Latin) do NOT match.
 */

const HONORIFICS = new Set([
  "mr", "mrs", "ms", "miss", "mister", "dr", "doctor", "prof", "professor", "engr", "eng", "engineer",
  "sir", "madam", "madame", "maam", "haji", "hajji", "hj", "sahib", "sahab", "bhai", "baji", "ji",
]);

const MUHAMMAD_SPELLINGS = new Set(["muhammad", "mohammad", "mohammed", "muhammed", "mohamed", "mohamad", "muhamad", "mohd", "muhd", "md"]);

/** Comparable tokens of a person's name; empty when the name carries no usable letters. */
export function clientNameTokens(name: unknown): string[] {
  const folded = String(name ?? "")
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!folded) return [];
  const tokens = folded.split(/\s+/).map((token) => (MUHAMMAD_SPELLINGS.has(token) ? "muhammad" : token));
  const withoutTitles = tokens.filter((token) => !HONORIFICS.has(token));
  return [...new Set(withoutTitles.length ? withoutTitles : tokens)];
}

export function namesPlausiblyMatch(a: unknown, b: unknown): boolean {
  const left = new Set(clientNameTokens(a));
  const right = new Set(clientNameTokens(b));
  if (!left.size || !right.size) return false;
  if (left.size === right.size && [...left].every((token) => right.has(token))) return true;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  return small.size >= 2 && [...small].every((token) => large.has(token));
}
