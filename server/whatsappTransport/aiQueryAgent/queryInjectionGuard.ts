/**
 * Prompt-injection resistance for customer query text.
 * Detects instruction-override patterns and returns a sanitized copy
 * that must not be treated as system/policy instructions.
 */

export type InjectionGuardResult = {
  suspected: boolean;
  reasons: string[];
  sanitizedText: string;
};

const INJECTION_PATTERNS: readonly { reason: string; pattern: RegExp }[] = [
  {
    reason: "ignore_instructions",
    pattern: /\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|system)\b.{0,20}\b(instructions?|rules?|prompt)\b/i,
  },
  {
    reason: "system_override",
    pattern: /\b(system\s*prompt|developer\s*mode|jailbreak|DAN\b|act\s+as\s+if\s+you\s+have\s+no\s+restrictions)\b/i,
  },
  {
    reason: "role_hijack",
    pattern: /^\s*(system|assistant|developer)\s*:/im,
  },
  {
    reason: "tool_exfil",
    pattern: /\b(reveal|print|dump|show)\b.{0,30}\b(api[_-]?key|secret|token|system\s*prompt|hidden\s*instructions?)\b/i,
  },
  {
    reason: "forced_auto_send",
    pattern: /\b(send\s+(this|the)\s+(message|reply)\s+(now|immediately)|auto[_-]?reply|bypass\s+human\s+review)\b/i,
  },
  {
    reason: "xml_instruction_tags",
    pattern: /<\/?(?:system|instructions?|policy|tool_call)\b[^>]*>/i,
  },
];

const MAX_TEXT_CHARS = 4_000;

export function guardPromptInjection(rawText: string | null | undefined): InjectionGuardResult {
  const original = String(rawText ?? "");
  const truncated = original.slice(0, MAX_TEXT_CHARS);
  const reasons: string[] = [];

  for (const { reason, pattern } of INJECTION_PATTERNS) {
    if (pattern.test(truncated)) {
      reasons.push(reason);
    }
  }

  // Neutralize common delimiter / role markers so they cannot become instructions.
  let sanitized = truncated
    .replace(/```[\s\S]*?```/g, "[code_block_removed]")
    .replace(/<\/?(?:system|instructions?|policy|tool_call)\b[^>]*>/gi, "[tag_removed]")
    .replace(/^\s*(system|assistant|developer)\s*:/gim, "[role_marker_removed]:")
    .trim();

  if (!sanitized) {
    sanitized = "[empty_message]";
  }

  // Prefix so the provider layer treats this as untrusted customer content only.
  sanitized = `UNTRUSTED_CUSTOMER_TEXT:\n${sanitized}`;

  return {
    suspected: reasons.length > 0,
    reasons,
    sanitizedText: sanitized,
  };
}
