/**
 * Tool allowlist for the customer query agent.
 * Only read-only, non-mutating, non-outbound tools may ever be declared.
 * AI-01 does not execute tools that send messages or write CRM data.
 */

export const QUERY_AGENT_ALLOWED_TOOLS = [
  "lookup_public_product_faq",
  "lookup_public_system_overview",
  "lookup_public_net_metering_faq",
] as const;

export type QueryAgentAllowedTool = (typeof QUERY_AGENT_ALLOWED_TOOLS)[number];

const ALLOWED_SET = new Set<string>(QUERY_AGENT_ALLOWED_TOOLS);

/** Forbidden tool name patterns — outbound, CRM mutation, design calc, quotes. */
const FORBIDDEN_TOOL_PATTERNS: readonly RegExp[] = [
  /send/i,
  /whatsapp/i,
  /outbound/i,
  /reply_auto/i,
  /crm[_-]?write/i,
  /create[_-]?quote/i,
  /create[_-]?lead/i,
  /update[_-]?customer/i,
  /install/i,
  /approve/i,
  /payment[_-]?capture/i,
  /design[_-]?finalize/i,
];

export function isToolAllowed(toolName: string): boolean {
  const name = String(toolName || "").trim();
  if (!name || !ALLOWED_SET.has(name)) return false;
  for (const pattern of FORBIDDEN_TOOL_PATTERNS) {
    if (pattern.test(name)) return false;
  }
  return true;
}

export function filterAllowedTools(toolNames: readonly string[]): string[] {
  return toolNames.filter((name) => isToolAllowed(name));
}

/** Intent → default read-only tools (still allowlist-gated). */
export function toolsForIntent(intent: string): readonly QueryAgentAllowedTool[] {
  switch (intent) {
    case "product_question":
    case "sales":
      return ["lookup_public_product_faq", "lookup_public_system_overview"];
    case "system_selection":
      return ["lookup_public_system_overview"];
    case "net_metering":
      return ["lookup_public_net_metering_faq"];
    case "technical_question":
      return ["lookup_public_product_faq", "lookup_public_system_overview"];
    default:
      return [];
  }
}
