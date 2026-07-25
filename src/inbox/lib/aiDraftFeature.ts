/**
 * Client gate for AI-03 “Generate AI draft” UI.
 * Default OFF. Server still enforces WHATSAPP_AI_QUERY_DRAFT_ENABLED.
 */

function readViteFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === null || String(value).trim() === "") {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

/** True only when VITE_WHATSAPP_AI_QUERY_DRAFT_ENABLED is explicitly enabled. */
export function isAiDraftUiEnabled(
  env: Record<string, string | undefined> = import.meta.env as Record<
    string,
    string | undefined
  >
): boolean {
  return readViteFlag(env.VITE_WHATSAPP_AI_QUERY_DRAFT_ENABLED, false);
}
