/**
 * Deterministic post-generation validation for provider draft text.
 * Unsafe output must be denied or escalated — never accepted, returned, or
 * partially cleaned as a clean draft.
 */

import type { EscalationReason } from "./queryAgentTypes.ts";

/** Hard ceiling for customer-facing draft length (characters). */
export const MAX_DRAFT_CHARS = 1_500;

/**
 * Strong certainty / promise markers used for combinatorial detection with
 * outcome topics. Broad "we will / you will" alone is not enough — those are
 * handled via targeted bridges so benign scheduling language can pass.
 */
const STRONG_CERTAINTY_PATTERNS: readonly RegExp[] = [
  /\bguarantee(d|s)?\b/i,
  /\bpromises?\b/i,
  /\bpromised\b/i,
  /\bassur(e|ed|es|ance)\b/i,
  /\bcertainly\b/i,
  /\bdefinitely\b/i,
  /\bsurely\b/i,
];

/** Outcome topics that must not be promised with certainty language. */
const OUTCOME_PATTERNS: readonly RegExp[] = [
  /\bsavings?\b/i,
  /\bsave\s+money\b/i,
  /\broi\b/i,
  /\breturn\s+on\s+investment\b/i,
  /\bpayback\b/i,
  /\brecover\s+your\s+investment\b/i,
  /\binvestment\b/i,
  /\bapproval\b/i,
  /\bapproved\b/i,
  /\bgranted\b/i,
  /\bnet[\s-]*metering\b/i,
  /\binstallation\b/i,
];

/**
 * Explicit outcome-promise phrases (Codex R2 examples and close variants).
 */
const STANDALONE_OUTCOME_PROMISES: readonly RegExp[] = [
  /\bguarantee(d)?\s+you\s+will\s+save\b/i,
  /\bwe\s+guarantee\b[\s\S]{0,60}\bsave\b/i,
  /\byou\s+will\s+save\s+money\b/i,
  /\byour\s+approval\s+will\s+(definitely|surely|certainly)\s+be\s+granted\b/i,
  /\bapproval\s+will\s+(definitely|surely|certainly)\s+be\s+granted\b/i,
  /\bwill\s+definitely\s+be\s+granted\b/i,
  /\bnet[\s-]*metering\s+will\s+(surely|definitely|certainly)\s+be\s+approved\b/i,
  /\bwill\s+surely\s+be\s+approved\b/i,
  /\binstallation\s+will\s+be\s+completed\b/i,
  /\byou\s+will\s+recover\s+your\s+investment\b/i,
  /\brecover\s+your\s+investment\s+in\b/i,
  /\b\d+\s*%\s*(savings?|roi|payback)\b/i,
  /\bnet[\s-]*metering\s+(approved|guaranteed|confirmed|assured)\b/i,
  /\binstallation\s+(guaranteed|confirmed|assured|completed\s+by)\b/i,
  /\bapproval\s+(is\s+)?(certain|guaranteed|assured)\b/i,
  /\bpromise(d|s)?\s+(savings?|roi|payback|approval)\b/i,
  /\bguarantee(d)?\s+(savings?|roi|payback|approval|installation)\b/i,
  /\b(will|surely)\s+save\b/i,
];

/**
 * Flexible bridges: certainty / future-promise near an outcome topic.
 * Windowed so intervening wording still fails closed.
 */
const CERTAINTY_OUTCOME_BRIDGES: readonly RegExp[] = [
  /\b(guarantee|promised?|assur(?:e|ed|es|ance)|definitely|surely|certainly)\b[\s\S]{0,80}\b(save|savings?|roi|payback|approval|approved|granted|net[\s-]*metering|installation|investment)\b/i,
  /\b(save|savings?|roi|payback|approval|approved|granted|net[\s-]*metering|installation|investment)\b[\s\S]{0,80}\b(guarantee|promised?|assured|definitely|surely|certainly)\b/i,
  /\b(you|we|your\s+\w+)\s+will\b[\s\S]{0,40}\b(save|recover|be\s+approved|be\s+granted|be\s+completed)\b/i,
  /\bwill\s+(definitely|surely|certainly)\b[\s\S]{0,40}\b(granted|approved|completed|save)\b/i,
  /\binstallation\b[\s\S]{0,40}\b(will\s+be\s+completed|completed\s+tomorrow|guaranteed)\b/i,
  /\bnet[\s-]*metering\b[\s\S]{0,40}\b(will\s+.{0,30}approved|approved)\b/i,
  /\bapproval\b[\s\S]{0,40}\b(will\s+.{0,30}granted|definitely|surely|guaranteed)\b/i,
  /\binvestment\b[\s\S]{0,40}\b(recover|payback|roi)\b/i,
  /\brecover\b[\s\S]{0,40}\binvestment\b/i,
];

const LEAKAGE_PATTERNS: readonly RegExp[] = [
  // Phones / WhatsApp identifiers
  /(\+?\d{10,15})/,
  /@s\.whatsapp\.net/i,
  /@g\.us\b/i,
  /@lid\b/i,
  /\b\d{10,15}@s\.whatsapp\.net\b/i,
  /\b[0-9]{5,}@lid\b/i,
  /\b[0-9]{10,}[:@]lid\b/i,
  // Bearer / JWT / API tokens
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\bsk-[A-Za-z0-9]{10,}\b/,
  /\bAIza[A-Za-z0-9_\-]{10,}\b/,
  /\b(api[_-]?key|access[_-]?token|secret[_-]?key|auth[_-]?token)\b\s*[:=]\s*\S+/i,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bYA29\.[A-Za-z0-9_\-.]+/,
];

export type ProviderOutputValidationOk = {
  ok: true;
  text: string;
};

export type ProviderOutputValidationFail = {
  ok: false;
  /** Deny hard-fails; escalate returns a safe human-review draft without unsafe text. */
  action: "deny" | "escalate";
  reasonCode: EscalationReason;
  message: string;
  /** Machine-readable validation hit for logs/tests (never includes raw output). */
  violation: "empty" | "forbidden_guarantee" | "token_jid_lid_leak" | "excessive_output";
};

export type ProviderOutputValidationResult =
  | ProviderOutputValidationOk
  | ProviderOutputValidationFail;

function hasMatch(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * True when certainty/promise language is combined with a savings/ROI/payback/
 * approval/net-metering/installation outcome — including intervening words.
 */
export function containsForbiddenGuaranteeLanguage(text: string): boolean {
  const normalized = String(text ?? "");
  if (!normalized.trim()) return false;

  if (hasMatch(STANDALONE_OUTCOME_PROMISES, normalized)) return true;
  if (hasMatch(CERTAINTY_OUTCOME_BRIDGES, normalized)) return true;

  const hasCertainty = hasMatch(STRONG_CERTAINTY_PATTERNS, normalized);
  const hasOutcome = hasMatch(OUTCOME_PATTERNS, normalized);
  return hasCertainty && hasOutcome;
}

export function containsIdentifierOrTokenLeakage(text: string): boolean {
  return hasMatch(LEAKAGE_PATTERNS, String(text ?? ""));
}

export function validateProviderDraftOutput(
  raw: string | null | undefined,
  options: { maxChars?: number } = {}
): ProviderOutputValidationResult {
  const maxChars = options.maxChars ?? MAX_DRAFT_CHARS;
  const text = String(raw ?? "").trim();

  if (!text) {
    return {
      ok: false,
      action: "deny",
      reasonCode: "unsafe_output",
      message: "AI provider returned an empty draft.",
      violation: "empty",
    };
  }

  if (text.length > maxChars) {
    return {
      ok: false,
      action: "deny",
      reasonCode: "unsafe_output",
      message: "AI provider draft exceeded the safe length limit.",
      violation: "excessive_output",
    };
  }

  if (containsIdentifierOrTokenLeakage(text)) {
    return {
      ok: false,
      action: "deny",
      reasonCode: "unsafe_output",
      message: "AI provider draft contained sensitive tokens or identifiers.",
      violation: "token_jid_lid_leak",
    };
  }

  if (containsForbiddenGuaranteeLanguage(text)) {
    return {
      ok: false,
      action: "escalate",
      reasonCode: "unsafe_output",
      message:
        "AI provider draft contained forbidden guarantees or outcome promises.",
      violation: "forbidden_guarantee",
    };
  }

  // Never mutate/partially clean unsafe text — only untouched safe drafts pass.
  return { ok: true, text };
}

/** Safe staff-facing fallback when provider output must escalate. */
export const SAFE_ESCALATION_DRAFT =
  "Thank you for your message. A Sunchaser team member will review this and follow up with you shortly.";
