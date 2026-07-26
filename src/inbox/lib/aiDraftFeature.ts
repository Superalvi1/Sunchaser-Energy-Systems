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

function readImportMetaEnv(): Record<string, string | undefined> {
  try {
    // Vite injects import.meta.env at build time; guard for tsc without vite/client types.
    const meta = import.meta as ImportMeta & {
      env?: Record<string, string | undefined>;
    };
    return meta.env ?? {};
  } catch {
    return {};
  }
}

/** True only when VITE_WHATSAPP_AI_QUERY_DRAFT_ENABLED is explicitly enabled. */
export function isAiDraftUiEnabled(
  env: Record<string, string | undefined> = readImportMetaEnv()
): boolean {
  return readViteFlag(env.VITE_WHATSAPP_AI_QUERY_DRAFT_ENABLED, false);
}
