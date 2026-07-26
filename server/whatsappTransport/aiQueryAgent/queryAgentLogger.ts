/**
 * Privacy-safe logger for the AI query agent.
 * Never logs message bodies, phones, JIDs, LIDs, tokens, or prompt content.
 */

export type QueryAgentLogLevel = "info" | "warn" | "error";

const FORBIDDEN_KEY_PATTERN =
  /(message|body|text|prompt|phone|jid|lid|msisdn|waid|token|secret|key|auth|password|cookie|bearer|authorization|raw)/i;

const PII_VALUE_PATTERN =
  /(\+?\d{10,15}|@s\.whatsapp\.net|@lid\b|Bearer\s+\S+|sk-[A-Za-z0-9]{10,}|AIza[A-Za-z0-9_\-]{10,})/i;

export function sanitizeQueryAgentLogMeta(
  safeMeta?: Record<string, unknown>
): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  if (!safeMeta) return meta;

  for (const [k, v] of Object.entries(safeMeta)) {
    if (FORBIDDEN_KEY_PATTERN.test(k)) continue;
    if (v !== null && typeof v === "object") continue;
    if (typeof v === "function" || typeof v === "symbol") continue;
    if (typeof v === "string") {
      if (v.length > 200 || PII_VALUE_PATTERN.test(v)) {
        meta[k] = `[redacted:${v.length}chars]`;
        continue;
      }
    }
    if (
      typeof v !== "string" &&
      typeof v !== "number" &&
      typeof v !== "boolean" &&
      v !== null
    ) {
      continue;
    }
    meta[k] = v;
  }
  return meta;
}

export function logQueryAgent(
  level: QueryAgentLogLevel,
  event: string,
  safeMeta?: Record<string, unknown>
): void {
  const line = JSON.stringify({
    scope: "whatsapp_ai_query_agent",
    level,
    event,
    ...sanitizeQueryAgentLogMeta(safeMeta),
    at: new Date().toISOString(),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
