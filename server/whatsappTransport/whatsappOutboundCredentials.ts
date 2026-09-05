/**
 * Outbound Meta Cloud API credential resolution.
 *
 * Official Meta WhatsApp Cloud API only.
 *
 * PRIMARY source: the connection created by Meta Embedded Signup and stored in
 * `whatsapp_connections` (token encrypted at rest, decrypted by the connection
 * repository immediately before use).
 *
 * LEGACY source: WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID. Retained as
 * a deprecated compatibility path so that deployments which have not completed
 * Embedded Signup keep sending, and used ONLY when no stored connection record
 * exists at all. A stored connection that is inactive/incomplete FAILS CLOSED
 * rather than silently falling back to environment credentials, because that is
 * exactly the drift that could send from the wrong WhatsApp number.
 *
 * Nothing here logs, persists or returns token material.
 */
import type { WhatsAppConnectionRecord } from "./whatsappConnectionRepository.ts";
import { isValidPhoneNumberId, type WhatsAppConfig } from "./whatsappConfig.ts";
import { normalizeWhatsAppConnectionStatus } from "./whatsappConnectionService.ts";

export type OutboundCredentialSource = "embedded_signup" | "legacy_env";

/** Sanitized failure codes — safe to audit, never contain credential material. */
export type OutboundCredentialFailure =
  | "connection_lookup_failed"
  | "connection_incomplete"
  | "connection_inactive"
  | "connection_ambiguous"
  | "connection_phone_mismatch"
  | "no_credentials";

export type OutboundCredentials = {
  accessToken: string;
  phoneNumberId: string;
  source: OutboundCredentialSource;
};

export type OutboundCredentialResolution =
  | ({ ok: true } & OutboundCredentials)
  | { ok: false; reason: OutboundCredentialFailure };

/** Connection lookup surface. Kept minimal so tests need no Supabase. */
export type OutboundConnectionLookup = {
  get(companyId: string): Promise<WhatsAppConnectionRecord | null>;
};

export type ResolveOutboundCredentialsDeps = {
  config: WhatsAppConfig;
  connectionLookup: OutboundConnectionLookup;
  companyId: string;
  /**
   * phone_number_id of the channel that owns the conversation. When provided,
   * a stored connection for a different sender identity is rejected.
   */
  expectedPhoneNumberId?: string | null;
  env?: NodeJS.ProcessEnv;
};

/** A stored connection may only send when Meta considers it usable. */
function isSendableState(record: WhatsAppConnectionRecord): boolean {
  const state = normalizeWhatsAppConnectionStatus(record.stateOverride);
  if (state === "DISCONNECTED" || state === "ERROR" || state === "TOKEN_EXPIRED") {
    return false;
  }
  if (record.tokenExpiresAt) {
    const expiresAtMs = Date.parse(record.tokenExpiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) return false;
  }
  return true;
}

function hasUsableCredentials(record: WhatsAppConnectionRecord): boolean {
  const token = record.accessToken?.trim() ?? "";
  const phoneNumberId = record.phoneNumberId?.trim() ?? "";
  return token.length > 0 && isValidPhoneNumberId(phoneNumberId);
}

/**
 * Deterministic selection across candidate connections.
 *
 * The current schema stores at most one connection per company, so ambiguity is
 * not reachable through the repository. The rule is implemented (and tested)
 * anyway so that any future multi-connection lookup fails closed instead of
 * silently picking one.
 */
export function selectOutboundConnection(
  candidates: readonly WhatsAppConnectionRecord[],
  expectedPhoneNumberId?: string | null
):
  | { ok: true; record: WhatsAppConnectionRecord }
  | { ok: false; reason: OutboundCredentialFailure } {
  if (candidates.length === 0) return { ok: false, reason: "no_credentials" };

  const complete = candidates.filter(hasUsableCredentials);
  if (complete.length === 0) return { ok: false, reason: "connection_incomplete" };

  const active = complete.filter(isSendableState);
  if (active.length === 0) return { ok: false, reason: "connection_inactive" };

  const expected = expectedPhoneNumberId?.trim();
  if (expected) {
    const matching = active.filter(
      (record) => record.phoneNumberId?.trim() === expected
    );
    if (matching.length === 0) {
      return { ok: false, reason: "connection_phone_mismatch" };
    }
    if (matching.length > 1) return { ok: false, reason: "connection_ambiguous" };
    return { ok: true, record: matching[0]! };
  }

  if (active.length > 1) return { ok: false, reason: "connection_ambiguous" };
  return { ok: true, record: active[0]! };
}

/** Deprecated env credential path. Disabled by setting the flag to false. */
export function isLegacyEnvFallbackEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = String(env.WHATSAPP_LEGACY_ENV_CREDENTIALS_ENABLED ?? "true")
    .trim()
    .toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export function hasLegacyEnvCredentials(config: WhatsAppConfig): boolean {
  return (
    config.accessToken.trim().length > 0 &&
    isValidPhoneNumberId(config.phoneNumberId.trim())
  );
}

let legacyFallbackWarned = false;

/** Sanitized one-shot deprecation notice. Never includes credential material. */
function warnLegacyFallbackOnce(): void {
  if (legacyFallbackWarned) return;
  legacyFallbackWarned = true;
  console.warn(
    JSON.stringify({
      scope: "whatsapp-outbound",
      event: "legacy_env_credentials_used",
      detail:
        "No Meta Embedded Signup connection found; sending with deprecated WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID",
    })
  );
}

/** Test seam: reset the one-shot deprecation notice. */
export function resetLegacyFallbackWarningForTests(): void {
  legacyFallbackWarned = false;
}

/**
 * Resolve the credentials for one outbound send.
 * Connection-first; env fallback only when no connection record exists.
 */
export async function resolveOutboundCredentials(
  deps: ResolveOutboundCredentialsDeps
): Promise<OutboundCredentialResolution> {
  const env = deps.env ?? process.env;

  let record: WhatsAppConnectionRecord | null = null;
  try {
    record = await deps.connectionLookup.get(deps.companyId);
  } catch {
    // Never fall back to env on a lookup failure: we cannot prove which
    // sender identity is correct, so fail closed.
    return { ok: false, reason: "connection_lookup_failed" };
  }

  if (record) {
    const selected = selectOutboundConnection([record], deps.expectedPhoneNumberId);
    if (selected.ok === false) return { ok: false, reason: selected.reason };
    return {
      ok: true,
      accessToken: selected.record.accessToken!.trim(),
      phoneNumberId: selected.record.phoneNumberId!.trim(),
      source: "embedded_signup",
    };
  }

  if (!isLegacyEnvFallbackEnabled(env) || !hasLegacyEnvCredentials(deps.config)) {
    return { ok: false, reason: "no_credentials" };
  }
  warnLegacyFallbackOnce();
  return {
    ok: true,
    accessToken: deps.config.accessToken.trim(),
    phoneNumberId: deps.config.phoneNumberId.trim(),
    source: "legacy_env",
  };
}
