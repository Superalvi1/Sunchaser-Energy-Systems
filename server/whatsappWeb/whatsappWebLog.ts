/**
 * Structured logging for WhatsApp Web QR — never logs credentials, QR payloads,
 * auth directory contents, phone numbers, or session secrets.
 */

export type WhatsAppWebLogLevel = "info" | "warn" | "error";

const FORBIDDEN_KEY_PATTERN =
  /(cred|secret|token|key|auth|session|qr|password|cookie|noise|identity|prekey)/i;

export function logWhatsAppWeb(
  level: WhatsAppWebLogLevel,
  event: string,
  safeMeta?: Record<string, unknown>
): void {
  const meta: Record<string, unknown> = {};
  if (safeMeta) {
    for (const [k, v] of Object.entries(safeMeta)) {
      if (FORBIDDEN_KEY_PATTERN.test(k)) continue;
      if (typeof v === "string" && v.length > 200) {
        meta[k] = `[redacted:${v.length}chars]`;
        continue;
      }
      meta[k] = v;
    }
  }
  const line = JSON.stringify({
    scope: "whatsapp_web_qr",
    level,
    event,
    ...meta,
    at: new Date().toISOString(),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

/** Silent pino-compatible logger for Baileys (suppresses library dumps). */
export function createSilentBaileysLogger(): {
  level: string;
  child: () => ReturnType<typeof createSilentBaileysLogger>;
  trace: (..._args: unknown[]) => void;
  debug: (..._args: unknown[]) => void;
  info: (..._args: unknown[]) => void;
  warn: (..._args: unknown[]) => void;
  error: (..._args: unknown[]) => void;
  fatal: (..._args: unknown[]) => void;
} {
  const noop = () => undefined;
  const logger = {
    level: "silent",
    child: () => logger,
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
  };
  return logger;
}
