/**
 * AI-03 feature flags for human-approved AI drafts.
 * Aligns with AI-01 env names so both fail closed together.
 */

export type AiDraftConfig = {
  /** Staff-requested draft generation. Default false. */
  draftEnabled: boolean;
  /**
   * Future automatic replies. Default false.
   * AI-03 never sends outbound even if this is somehow true.
   */
  autoReplyEnabled: boolean;
  /** Adapter mode: mock only until AI-01 is rebased in. */
  adapter: "mock";
  timeoutMs: number;
};

function readFlag(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue = false
): boolean {
  const raw = env[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return defaultValue;
  }
  const normalized = String(raw).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function readInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = String(env[key] ?? "").trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Resolve draft-workflow env. Defaults fail closed:
 * - draft OFF
 * - auto-reply OFF
 */
export function readAiDraftConfig(
  env: NodeJS.ProcessEnv = process.env
): AiDraftConfig {
  return {
    draftEnabled: readFlag(env, "WHATSAPP_AI_QUERY_DRAFT_ENABLED", false),
    autoReplyEnabled: readFlag(env, "WHATSAPP_AI_AUTO_REPLY_ENABLED", false),
    adapter: "mock",
    timeoutMs: readInt(env, "WHATSAPP_AI_QUERY_TIMEOUT_MS", 8_000, 50, 60_000),
  };
}

export function isAiDraftEnabled(config: AiDraftConfig): boolean {
  return config.draftEnabled === true;
}

/** Exposed for future gates only — never used to send WhatsApp. */
export function isAiAutoReplyEnabled(config: AiDraftConfig): boolean {
  return config.autoReplyEnabled === true;
}
