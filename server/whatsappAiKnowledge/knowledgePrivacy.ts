/**
 * Privacy helpers for the WhatsApp AI knowledge engine.
 *
 * Guarantees:
 * - No full customer message or PII in indexes, fixtures, or logs.
 * - Query fingerprints are HMAC digests only when a server-side secret exists.
 */

import { createHmac } from "node:crypto";

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE =
  /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}\b/g;
const CNIC_RE = /\b\d{5}-\d{7}-\d\b/g;
const NAME_HINT_RE =
  /\b(?:my name is|i am|i'm)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/gi;

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /disregard\s+(all\s+)?(previous|prior|above)/gi,
  /you\s+are\s+now\s+/gi,
  /system\s*:\s*/gi,
  /<<\s*sys\s*>>/gi,
  /\[\[\s*system\s*\]\]/gi,
  /reveal\s+(your|the)\s+(system\s+)?prompt/gi,
  /act\s+as\s+(if\s+you\s+are|a)\s+/gi,
];

/**
 * Currency markers with common whitespace / punctuation separators
 * (PKR-900000, PKR: 900000, Rs/-900000, Rs.900000, PKR 900,000/-).
 */
const CURRENCY_PREFIX_PRICE_RE =
  /\b(?:PKR|Rs)(?:\.?\s*[:=\-\/]*\s*|[:=\-\/]+\s*)-?[\d,]+(?:\.\d+)?(?:\s*\/-)?/gi;

/** Amount followed by a currency marker (e.g. 900000 PKR, 900,000/- Rs). */
const CURRENCY_SUFFIX_PRICE_RE =
  /\b[\d,]+(?:\.\d+)?(?:\s*\/-)?\s*(?:PKR|Rs\.?)\b/gi;

/**
 * Price-word prefixes with separators (price-900000, rate: 900000).
 * Catches "package price 900,000/-" via the `price` token.
 */
const PRICE_WORD_AMOUNT_RE =
  /\b(?:price|cost|rate|amount|fee|tariff)(?:\s*[:=\-\/]+\s*|\s+)-?[\d,]+(?:\.\d+)?(?:\s*\/-)?/gi;

/** Comma-grouped amounts such as 900,000 or 900,000/-. */
const COMMA_GROUPED_AMOUNT_RE =
  /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:\s*\/-)?/g;

/** Bare large numbers that may be unformatted PKR amounts (e.g. 900000). */
const BARE_LARGE_AMOUNT_RE = /\b\d{5,}(?:\.\d+)?\b/g;

/**
 * Technical unit suffixes that make a number non-monetary
 * (panel wattage, electrical ratings, dimensions, counts).
 */
const TECHNICAL_UNIT_SUFFIX_RE =
  /^(?:\s*)(?:k?w(?:p)?|v(?:olts?)?|a(?:mps?)?|ah|hz|mm|cm|m\b|kg|cells?|modules?|panels?|pcs|pieces|cycles?)\b/i;

/** Tokens that look like currency/price labels, not model identifiers. */
const MONETARY_TOKEN_PREFIX_RE =
  /^(?:PKR|Rs\.?|price|cost|rate|amount|fee|tariff)(?:$|[\s:=\-\/.])/i;

/**
 * Validated hyphenated model token:
 * starts with a letter, contains a digit, and has 2+ alphanumeric segments
 * (e.g. LONGi-LR5-72HPH-550M). Arbitrary letter/hyphen adjacency is not enough.
 */
const VALIDATED_MODEL_TOKEN_RE =
  /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z][A-Za-z0-9]*(-[A-Za-z0-9]+)+$/;

function expandToModelTokenBounds(
  text: string,
  start: number,
  end: number,
): { tokenStart: number; tokenEnd: number; token: string } {
  let tokenStart = start;
  let tokenEnd = end;
  while (tokenStart > 0 && /[A-Za-z0-9._-]/.test(text.charAt(tokenStart - 1))) {
    tokenStart -= 1;
  }
  while (tokenEnd < text.length && /[A-Za-z0-9._-]/.test(text.charAt(tokenEnd))) {
    tokenEnd += 1;
  }
  return {
    tokenStart,
    tokenEnd,
    token: text.slice(tokenStart, tokenEnd),
  };
}

function isValidatedModelToken(token: string): boolean {
  if (!token || MONETARY_TOKEN_PREFIX_RE.test(token)) return false;
  return VALIDATED_MODEL_TOKEN_RE.test(token);
}

/**
 * True when a bare numeric match is a technical rating or validated model token.
 * Adjacency to an arbitrary letter/hyphen alone is NOT sufficient.
 */
function isTechnicalNumberContext(
  text: string,
  start: number,
  matched: string,
): boolean {
  const end = start + matched.length;
  const after = text.slice(end, end + 24);
  if (TECHNICAL_UNIT_SUFFIX_RE.test(after)) return true;

  const { token } = expandToModelTokenBounds(text, start, end);
  return isValidatedModelToken(token);
}

function collectEmbeddedPriceMatches(text: string): Array<{
  start: number;
  end: number;
  value: string;
}> {
  const sample = String(text || "");
  const matches: Array<{ start: number; end: number; value: string }> = [];

  const pushAll = (re: RegExp, allowTechnicalEscape: boolean) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sample)) !== null) {
      if (
        allowTechnicalEscape &&
        isTechnicalNumberContext(sample, m.index, m[0])
      ) {
        continue;
      }
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        value: m[0],
      });
    }
  };

  // Monetary markers first (no technical escape).
  pushAll(CURRENCY_PREFIX_PRICE_RE, false);
  pushAll(CURRENCY_SUFFIX_PRICE_RE, false);
  pushAll(PRICE_WORD_AMOUNT_RE, false);
  pushAll(COMMA_GROUPED_AMOUNT_RE, false);
  // Bare amounts may escape only via wattage units or validated model tokens.
  pushAll(BARE_LARGE_AMOUNT_RE, true);

  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  // Drop overlaps (prefer earlier / longer).
  const deduped: typeof matches = [];
  let cursor = -1;
  for (const match of matches) {
    if (match.start < cursor) continue;
    deduped.push(match);
    cursor = match.end;
  }
  return deduped;
}

/**
 * Env var for the HMAC secret used by query fingerprints.
 * Without this secret, fingerprints are not derived from query content.
 */
export const KNOWLEDGE_QUERY_FINGERPRINT_SECRET_ENV =
  "WHATSAPP_AI_KNOWLEDGE_FINGERPRINT_SECRET";

export const FINGERPRINT_UNCONFIGURED = "qfp_unconfigured";

/** Redact common PII patterns from free text before indexing or logging. */
export function redactPii(text: string): string {
  return String(text || "")
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(CNIC_RE, "[redacted-cnic]")
    .replace(PHONE_RE, "[redacted-phone]")
    .replace(NAME_HINT_RE, "[redacted-name]");
}

/** Strip instruction-like prompt-injection phrases from knowledge body text. */
export function sanitizeKnowledgeContent(text: string): string {
  let out = String(text || "");
  for (const pattern of INJECTION_PATTERNS) {
    out = out.replace(pattern, "[filtered-instruction]");
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * True when free text embeds customer-facing monetary amounts
 * (PKR/Rs, comma-grouped, or bare large unformatted amounts).
 * Technical ratings/model numbers are preserved.
 */
export function hasEmbeddedPriceAmount(text: string): boolean {
  return collectEmbeddedPriceMatches(text).length > 0;
}

/**
 * Replace embedded monetary amounts so they cannot bypass structured
 * price controls. Technical wattage / model-number digits are kept.
 */
export function omitEmbeddedPriceAmounts(text: string): string {
  const sample = String(text || "");
  const matches = collectEmbeddedPriceMatches(sample);
  if (matches.length === 0) return sample.replace(/\s+/g, " ").trim();

  let out = "";
  let cursor = 0;
  for (const match of matches) {
    out += sample.slice(cursor, match.start);
    out += "[price-omitted]";
    cursor = match.end;
  }
  out += sample.slice(cursor);
  return out.replace(/\s+/g, " ").trim();
}

function normalizeFingerprintMaterial(queryText: string): {
  joined: string;
  tokenCount: number;
} {
  const redacted = redactPii(queryText).toLowerCase().trim();
  const tokens = redacted
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 8);
  return {
    joined: tokens.join("|") || "empty",
    tokenCount: tokens.length,
  };
}

/**
 * Resolve the HMAC secret for query fingerprints.
 * Prefer an explicit argument (tests); otherwise read the process env.
 */
export function resolveFingerprintSecret(
  secret?: string | null,
): string | null {
  if (typeof secret === "string" && secret.trim()) return secret.trim();
  const fromEnv = process.env[KNOWLEDGE_QUERY_FINGERPRINT_SECRET_ENV];
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  return null;
}

/**
 * Build a short, privacy-preserving fingerprint of a query for logs/meta.
 * Uses HMAC-SHA256 with a server-side secret. Never stores the raw message.
 *
 * If no secret is configured, returns {@link FINGERPRINT_UNCONFIGURED}
 * rather than an unsalted reversible/weak digest of query content.
 */
export function fingerprintQuery(
  queryText: string,
  secret?: string | null,
): string {
  const resolved = resolveFingerprintSecret(secret);
  if (!resolved) return FINGERPRINT_UNCONFIGURED;

  const { joined, tokenCount } = normalizeFingerprintMaterial(queryText);
  const digest = createHmac("sha256", resolved)
    .update(joined, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `qfp_${digest}_${tokenCount}`;
}

/** True if text still appears to contain residual PII patterns. */
export function containsLikelyPii(text: string): boolean {
  const sample = String(text || "");
  EMAIL_RE.lastIndex = 0;
  PHONE_RE.lastIndex = 0;
  CNIC_RE.lastIndex = 0;
  return EMAIL_RE.test(sample) || PHONE_RE.test(sample) || CNIC_RE.test(sample);
}

/** Assert a knowledge body is safe for fixtures/indexes. */
export function assertSafeKnowledgeBody(body: string, label: string): void {
  if (containsLikelyPii(body)) {
    throw new Error(`Knowledge body for ${label} contains likely PII`);
  }
  if (/ignore\s+previous\s+instructions/i.test(body)) {
    throw new Error(
      `Knowledge body for ${label} contains unsanitized injection text`,
    );
  }
}
