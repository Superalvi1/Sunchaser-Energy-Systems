/**
 * AI-01 feature flags and operational limits.
 * Draft generation and automatic replies are separate flags.
 * Automatic replies default OFF and must remain unusable in this phase.
 */

export type QueryAgentConfig = {
  /** Enables staff-requested draft generation only. Default false. */
  draftEnabled: boolean;
  /**
   * Future automatic replies flag. Default false.
   * AI-01 never sends outbound even if this is somehow true.
   */
  autoReplyEnabled: boolean;
  /** Provider selection: mock | env-backed gateway. */
  provider: "mock" | "env";
  timeoutMs: number;
  maxRetries: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  /** Minimum confidence below which policy escalates. */
  minConfidence: number;
};

function readFlag(env: NodeJS.ProcessEnv, key: string, defaultValue = false): boolean {
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

function readFloat(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = String(env[key] ?? "").trim();
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function readProvider(env: NodeJS.ProcessEnv): "mock" | "env" {
  const raw = String(env.WHATSAPP_AI_QUERY_PROVIDER ?? "env")
    .trim()
    .toLowerCase();
  return raw === "mock" ? "mock" : "env";
}

/**
 * Resolve query-agent env. Defaults fail closed:
 * - draft OFF
 * - auto-reply OFF
 */
export function readQueryAgentConfig(
  env: NodeJS.ProcessEnv = process.env
): QueryAgentConfig {
  return {
    draftEnabled: readFlag(env, "WHATSAPP_AI_QUERY_DRAFT_ENABLED", false),
    // Hard default OFF — never treat auto-reply as enabled in AI-01 wiring.
    autoReplyEnabled: readFlag(env, "WHATSAPP_AI_AUTO_REPLY_ENABLED", false),
    provider: readProvider(env),
    timeoutMs: readInt(env, "WHATSAPP_AI_QUERY_TIMEOUT_MS", 8_000, 50, 60_000),
    maxRetries: readInt(env, "WHATSAPP_AI_QUERY_MAX_RETRIES", 1, 0, 3),
    rateLimitWindowMs: readInt(
      env,
      "WHATSAPP_AI_QUERY_RATE_LIMIT_WINDOW_MS",
      60_000,
      1_000,
      3_600_000
    ),
    rateLimitMax: readInt(env, "WHATSAPP_AI_QUERY_RATE_LIMIT_MAX", 20, 1, 1_000),
    minConfidence: readFloat(env, "WHATSAPP_AI_QUERY_MIN_CONFIDENCE", 0.55, 0, 1),
  };
}

export function isQueryDraftEnabled(config: QueryAgentConfig): boolean {
  return config.draftEnabled === true;
}

/**
 * Auto-reply must remain OFF for AI-01. Exposed for future gates only —
 * the service never uses this to send WhatsApp messages.
 */
export function isQueryAutoReplyEnabled(config: QueryAgentConfig): boolean {
  return config.autoReplyEnabled === true;
}
