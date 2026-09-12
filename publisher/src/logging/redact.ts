/**
 * Secret redaction for logs. Never emit tokens, keys, or auth headers.
 */

const SENSITIVE_KEY =
  /^(authorization|access[_-]?token|refresh[_-]?token|client_secret|app_secret|api[_-]?secret|api[_-]?key|encryption[_-]?key|password|id_token|fb_exchange_token|input_token)$/i;

const TOKENISH =
  /(?:Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi;

const QUERY_SECRET =
  /(?:access_token|refresh_token|client_secret|app_secret|fb_exchange_token|input_token|code)=([^&\s]+)/gi;

const ENVELOPE = /\bv1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+\b/g;

export const REDACTED = "[redacted]";

export function redactString(input: string, maxLen = 2_000): string {
  const cleaned = input
    .replace(TOKENISH, `Bearer ${REDACTED}`)
    .replace(QUERY_SECRET, (full, _value) => {
      const key = full.slice(0, full.indexOf("="));
      return `${key}=${REDACTED}`;
    })
    .replace(ENVELOPE, `v1:${REDACTED}`)
    .replace(/EAAG[A-Za-z0-9]+/g, REDACTED)
    .replace(/act\.[A-Za-z0-9._-]+/g, REDACTED);
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned;
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return redactString(value);
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = REDACTED;
    } else {
      out[k] = redactValue(v, depth + 1);
    }
  }
  return out;
}

export function assertNoSecrets(payload: unknown): void {
  const serialized = JSON.stringify(payload) ?? "";
  if (
    /Bearer\s+(?!\[redacted\])\S+/i.test(serialized) ||
    /EAAG[A-Za-z0-9]{20,}/.test(serialized) ||
    /"access_token"\s*:\s*"(?!\[redacted\])/.test(serialized) ||
    /"refresh_token"\s*:\s*"(?!\[redacted\])/.test(serialized)
  ) {
    throw new Error("Refusing to log payload that appears to contain secrets");
  }
}
