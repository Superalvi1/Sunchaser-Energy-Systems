/**
 * Privacy helpers for the WhatsApp AI knowledge engine.
 *
 * Guarantees:
 * - No full customer message or PII in indexes, fixtures, or logs.
 * - Query fingerprints are truncated + redacted digests only.
 */

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
 * Build a short, non-reversible fingerprint of a query for logs/meta.
 * Never stores the raw customer message.
 */
export function fingerprintQuery(queryText: string): string {
  const redacted = redactPii(queryText).toLowerCase().trim();
  const tokens = redacted
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 8);
  const joined = tokens.join("|") || "empty";
  let hash = 2166136261;
  for (let i = 0; i < joined.length; i += 1) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `qfp_${hex}_${tokens.length}`;
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
