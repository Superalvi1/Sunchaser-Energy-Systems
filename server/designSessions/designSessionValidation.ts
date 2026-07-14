/**
 * Design session request validation (RC-1.1 audit).
 * Fail-closed helpers for payload size, version, status, and secret scrubbing.
 */

import { parseDesignSessionPayload } from "../../src/lib/designSessionClient.ts";

export const DESIGN_SESSION_MAX_PAYLOAD_BYTES = 2_000_000; // 2 MB
export const DESIGN_SESSION_ALLOWED_STATUS = new Set(["draft", "archived"] as const);

const SECRET_KEY_RE =
  /^(api[_-]?key|apikey|token|access[_-]?token|refresh[_-]?token|password|secret|authorization|bearer|private[_-]?key|service[_-]?role)$/i;

export type DesignSessionValidationOk = {
  ok: true;
  payload: Record<string, unknown>;
  expectedVersion: number | null;
  status: "draft" | "archived";
};

export type DesignSessionValidationErr = {
  ok: false;
  status: number;
  error: string;
};

function byteLengthOfJson(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

export function scrubSecretsDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSecretsDeep);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) continue;
    out[k] = scrubSecretsDeep(v);
  }
  return out;
}

export function parseSafeExpectedVersion(raw: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === "string" && raw.trim() === "") return { ok: true, value: null };
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) {
    return { ok: false, error: "expectedVersion must be a non-negative safe integer or null" };
  }
  return { ok: true, value: n };
}

export function parseDesignSessionStatus(raw: unknown): { ok: true; value: "draft" | "archived" } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: "draft" };
  }
  const s = String(raw).trim();
  if (s !== "draft" && s !== "archived") {
    return { ok: false, error: "status must be 'draft' or 'archived'" };
  }
  return { ok: true, value: s };
}

export function validateDesignSessionPutBody(body: unknown): DesignSessionValidationOk | DesignSessionValidationErr {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Request body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  // Reject client-supplied actor fields
  if ("lastModifiedBy" in b || "last_modified_by" in b) {
    return { ok: false, status: 400, error: "last_modified_by is server-managed and must not be sent" };
  }

  const payload = b.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, status: 400, error: "payload object is required" };
  }

  const size = byteLengthOfJson(payload);
  if (size > DESIGN_SESSION_MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `payload exceeds ${DESIGN_SESSION_MAX_PAYLOAD_BYTES} bytes`,
    };
  }

  const version = parseSafeExpectedVersion(b.expectedVersion);
  if (!version.ok) return { ok: false, status: 400, error: version.error };

  const status = parseDesignSessionStatus(b.status);
  if (!status.ok) return { ok: false, status: 400, error: status.error };

  const scrubbed = scrubSecretsDeep(payload) as Record<string, unknown>;
  const parsed = parseDesignSessionPayload(scrubbed);
  if (!parsed) {
    return { ok: false, status: 400, error: "payload failed design-session schema validation" };
  }

  return {
    ok: true,
    payload: scrubbed,
    expectedVersion: version.value,
    status: status.value,
  };
}

export function isDesignSessionDevFallbackAllowed(): boolean {
  // Production deploys must use Supabase design_sessions. Local/dev (including
  // NODE_ENV unset under tsx) may fall back to database.json.
  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  const render = String(process.env.RENDER || "").trim();
  if (render) return false;
  return nodeEnv !== "production";
}

/** Safe roof image for PDF embed: data:image only (no remote http/javascript). */
export function isSafeRoofImageDataUrl(url: string | null | undefined): boolean {
  if (url == null || url === "") return true;
  const u = String(url);
  if (u.length > 5_000_000) return false;
  return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(u);
}
