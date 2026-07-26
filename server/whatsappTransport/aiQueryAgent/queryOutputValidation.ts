/**
 * Deterministic post-generation validation for provider draft text.
 * Unsafe output must be denied or escalated — never accepted as a clean draft.
 */

import type { EscalationReason } from "./queryAgentTypes.ts";

/** Hard ceiling for customer-facing draft length (characters). */
export const MAX_DRAFT_CHARS = 1_500;

const FORBIDDEN_GUARANTEE_PATTERNS: readonly RegExp[] = [
  /\bguarantee(d)?\s+(savings?|roi|payback|approval|installation)\b/i,
  /\b(will|surely)\s+save\b/i,
  /\b\d+\s*%\s*(savings?|roi|payback)\b/i,
  /\bnet\s*metering\s+(approved|guaranteed|confirmed|assured)\b/i,
  /\binstallation\s+(guaranteed|confirmed|completed\s+by|assured)\b/i,
  /\bapproval\s+(is\s+)?(certain|guaranteed|assured)\b/i,
  /\bpromise(d|s)?\s+(savings?|roi|payback|approval)\b/i,
];

const LEAKAGE_PATTERNS: readonly RegExp[] = [
  /(\+?\d{10,15})/,
  /@s\.whatsapp\.net/i,
  /@lid\b/i,
  /\bBearer\s+\S+/i,
  /\bsk-[A-Za-z0-9]{10,}\b/,
  /\bAIza[A-Za-z0-9_\-]{10,}\b/,
  /\b(api[_-]?key|access[_-]?token|secret[_-]?key)\b\s*[:=]/i,
  /\b\d{10,15}@s\.whatsapp\.net\b/i,
  /\b[0-9]{5,}@lid\b/i,
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

  for (const pattern of LEAKAGE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        ok: false,
        action: "deny",
        reasonCode: "unsafe_output",
        message: "AI provider draft contained sensitive tokens or identifiers.",
        violation: "token_jid_lid_leak",
      };
    }
  }

  for (const pattern of FORBIDDEN_GUARANTEE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        ok: false,
        action: "escalate",
        reasonCode: "unsafe_output",
        message:
          "AI provider draft contained forbidden guarantees or outcome promises.",
        violation: "forbidden_guarantee",
      };
    }
  }

  return { ok: true, text };
}

/** Safe staff-facing fallback when provider output must escalate. */
export const SAFE_ESCALATION_DRAFT =
  "Thank you for your message. A Sunchaser team member will review this and follow up with you shortly.";
