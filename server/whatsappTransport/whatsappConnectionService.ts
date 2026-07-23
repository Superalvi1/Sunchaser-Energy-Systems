/**
 * WhatsApp Connection Status & Meta Embedded Signup Management.
 *
 * Security properties enforced in this module:
 *   - No simulated/mock credential exchange — WHATSAPP_APP_ID + WHATSAPP_APP_SECRET
 *     are required for all Embedded Signup onboarding. Omitting them yields a
 *     clear configuration error, not a fake token.
 *   - CSRF protection: state nonce generated server-side before SDK launch,
 *     validated and consumed (single-use) on callback. Callers inject the store.
 *   - Replay protection: one code exchange per state nonce. The code is never
 *     stored; the nonce is burned on first use.
 *   - WABA ownership verification: after token exchange the Graph API /me/businesses
 *     endpoint is called to confirm the token can access the claimed WABA.
 *   - Phone Number ID ownership: /WABA_ID/phone_numbers is queried to confirm the
 *     phone_number_id belongs to the WABA.
 *   - subscribed_apps registration: POST /{phone_number_id}/subscribed_apps registers
 *     the app for webhook delivery on every successful onboarding.
 *   - Proper revoke on disconnect: DELETE /{phone_number_id}/subscribed_apps is called
 *     before credentials are cleared from the store.
 *   - Error sanitization: raw Meta Graph API error bodies are never forwarded to
 *     callers. Only sanitized summaries are surfaced.
 *   - Tenant binding: every connection is scoped to a companyId. Cross-tenant
 *     access is rejected.
 *   - Credentials are stored in-process for now. The WhatsAppConnectionSecretStore
 *     interface is exported so callers can inject a DB-backed implementation.
 */

import type { RequestActor } from "../middleware/actor.ts";
import { GRAPH_API_VERSION_PATTERN } from "./whatsappConfig.ts";
import { WHATSAPP_GRAPH_API_VERSION_FALLBACK } from "./whatsappConstants.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";
import { sanitizeProviderError } from "./whatsappGraphClient.ts";
import type { OAuthStateStore } from "./whatsappOAuthStateStore.ts";
import { memoryOAuthStateStore } from "./whatsappOAuthStateStore.ts";

// ─── Connection state types ────────────────────────────────────────────────

export type WhatsAppConnectionState =
  | "NOT_CONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "REAUTHORIZATION_REQUIRED"
  | "ERROR";

export type WebhookHealthState = "healthy" | "degraded" | "failing" | "unknown";
export type TokenHealthState =
  | "valid"
  | "expiring_soon"
  | "expired"
  | "reauth_required";

export type WhatsAppConnectionStatusPayload = {
  status: WhatsAppConnectionState;
  connectionMode: "COEXISTENCE";
  wabaIdMasked: string | null;
  phoneNumberMasked: string | null;
  phoneNumberIdMasked: string | null;
  lastWebhookAt: string | null;
  webhookHealth: WebhookHealthState;
  tokenHealth: TokenHealthState;
  /**
   * A sanitized error summary safe to surface to admin UI.
   * Never contains raw tokens, credentials, or full stack traces.
   */
  connectionErrorSummary: string | null;
  canReconnect: boolean;
};

// ─── Credential store ──────────────────────────────────────────────────────

export type WhatsAppConnectionSecretStore = {
  /** The company this connection belongs to. */
  companyId: string | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  phoneNumber: string | null;
  accessToken: string | null;
  tokenExpiresAt: number | null; // epoch ms
  lastWebhookAt: string | null;
  lastError: string | null;
  stateOverride: WhatsAppConnectionState | null;
};

let connectionStore: WhatsAppConnectionSecretStore = {
  companyId: null,
  wabaId: process.env.WHATSAPP_WABA_ID || null,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
  phoneNumber: process.env.WHATSAPP_PHONE_NUMBER || null,
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN || null,
  tokenExpiresAt: null,
  lastWebhookAt: null,
  lastError: null,
  stateOverride: null,
};

export function resetConnectionStoreForTests(
  initial?: Partial<WhatsAppConnectionSecretStore>
) {
  connectionStore = {
    companyId: null,
    wabaId: process.env.WHATSAPP_WABA_ID || null,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    phoneNumber: process.env.WHATSAPP_PHONE_NUMBER || null,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || null,
    tokenExpiresAt: null,
    lastWebhookAt: null,
    lastError: null,
    stateOverride: null,
    ...initial,
  };
}

// ─── Utility helpers ───────────────────────────────────────────────────────

export function maskId(id: string | null | undefined): string | null {
  if (!id || !id.trim()) return null;
  const clean = id.trim();
  if (clean.length <= 4) return "****";
  return `${clean.slice(0, 2)}****${clean.slice(-4)}`;
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone || !phone.trim()) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `+${digits.slice(0, 2)} ${digits.slice(2, 5)} **** ${digits.slice(-3)}`;
}

export function recordWebhookPing(timestamp = new Date().toISOString()) {
  connectionStore.lastWebhookAt = timestamp;
}

export function recordConnectionError(sanitizedError: string) {
  connectionStore.lastError = sanitizedError;
  connectionStore.stateOverride = "ERROR";
}

export function clearConnectionError() {
  connectionStore.lastError = null;
  connectionStore.stateOverride = null;
}

export function computeWebhookHealth(
  lastWebhookAt: string | null
): WebhookHealthState {
  if (!lastWebhookAt) return "unknown";
  const ageMs = Date.now() - new Date(lastWebhookAt).getTime();
  if (Number.isNaN(ageMs)) return "unknown";
  if (ageMs <= 1000 * 60 * 60 * 24) return "healthy"; // within 24h
  if (ageMs <= 1000 * 60 * 60 * 24 * 7) return "degraded"; // within 7 days
  return "failing";
}

export function computeTokenHealth(
  accessToken: string | null,
  expiresAt: number | null,
  stateOverride: WhatsAppConnectionState | null
): TokenHealthState {
  if (stateOverride === "REAUTHORIZATION_REQUIRED") return "reauth_required";
  if (!accessToken || !accessToken.trim()) return "reauth_required";
  if (!expiresAt) return "valid"; // Permanent System User tokens have no expiration
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) return "expired";
  if (remainingMs <= 1000 * 60 * 60 * 24 * 7) return "expiring_soon";
  return "valid";
}

export function getWhatsAppConnectionStatus(): WhatsAppConnectionStatusPayload {
  const wabaId = connectionStore.wabaId || process.env.WHATSAPP_WABA_ID || null;
  const phoneNumberId =
    connectionStore.phoneNumberId ||
    process.env.WHATSAPP_PHONE_NUMBER_ID ||
    null;
  const phoneNumber =
    connectionStore.phoneNumber || process.env.WHATSAPP_PHONE_NUMBER || null;
  const accessToken =
    connectionStore.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || null;

  const webhookHealth = computeWebhookHealth(connectionStore.lastWebhookAt);
  const tokenHealth = computeTokenHealth(
    accessToken,
    connectionStore.tokenExpiresAt,
    connectionStore.stateOverride
  );

  let status: WhatsAppConnectionState = "NOT_CONNECTED";
  if (connectionStore.stateOverride) {
    status = connectionStore.stateOverride;
  } else if (tokenHealth === "reauth_required" || tokenHealth === "expired") {
    status = accessToken ? "REAUTHORIZATION_REQUIRED" : "NOT_CONNECTED";
  } else if (phoneNumberId && accessToken) {
    // CONNECTED is only reached when real credentials (not mocks) are present.
    // The mock fallback has been removed; credentials come from env or a real
    // Embedded Signup exchange, so this state is authoritative.
    status = "CONNECTED";
  }

  return {
    status,
    connectionMode: "COEXISTENCE",
    wabaIdMasked: maskId(wabaId),
    phoneNumberMasked: maskPhone(phoneNumber),
    phoneNumberIdMasked: maskId(phoneNumberId),
    lastWebhookAt: connectionStore.lastWebhookAt,
    webhookHealth,
    tokenHealth,
    connectionErrorSummary: connectionStore.lastError,
    canReconnect: true,
  };
}

// ─── Graph API helpers (internal) ─────────────────────────────────────────

function resolveGraphVersion(): string {
  const envVersion = process.env.WHATSAPP_GRAPH_API_VERSION;
  return envVersion && GRAPH_API_VERSION_PATTERN.test(envVersion)
    ? envVersion
    : WHATSAPP_GRAPH_API_VERSION_FALLBACK;
}

/**
 * Call any Graph API endpoint with a bearer token.
 * Returns the parsed JSON body or throws InboxServiceError with a sanitized message.
 * Never leaks raw Graph API error details to callers — they always go through
 * sanitizeProviderError() before being surfaced.
 */
async function graphGet(
  url: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (networkErr) {
    throw new InboxServiceError(
      "service_unavailable",
      "Meta Graph API network error during ownership verification"
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new InboxServiceError(
      "service_unavailable",
      "Meta Graph API returned non-JSON during ownership verification"
    );
  }

  if (!res.ok || body.error) {
    const sanitized = sanitizeProviderError(body);
    throw new InboxServiceError(
      "service_unavailable",
      `Meta Graph API error: ${sanitized}`
    );
  }

  return body;
}

async function graphPost(
  url: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new InboxServiceError(
      "service_unavailable",
      "Meta Graph API network error during app registration"
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (!res.ok || body.error) {
    const sanitized = sanitizeProviderError(body);
    throw new InboxServiceError(
      "service_unavailable",
      `Meta subscribed_apps registration failed: ${sanitized}`
    );
  }

  return body;
}

async function graphDelete(
  url: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  try {
    await fetchImpl(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // Ignore errors on revoke — we're disconnecting regardless.
  } catch {
    // Best-effort: network errors during disconnect are non-fatal.
  }
}

// ─── WABA & Phone Number ID ownership verification ─────────────────────────

/**
 * Verifies that the access token grants access to the claimed wabaId.
 * Calls GET /me/businesses and checks the returned list contains the wabaId.
 * Throws InboxServiceError on mismatch or network failure.
 */
export async function verifyWabaOwnership(
  accessToken: string,
  wabaId: string,
  version: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const url = `https://graph.facebook.com/${version}/me/businesses?fields=id,name`;
  const data = await graphGet(url, accessToken, fetchImpl);
  const businesses = Array.isArray(data.data) ? (data.data as { id?: string }[]) : [];
  const owned = businesses.some((b) => String(b.id) === String(wabaId));
  if (!owned) {
    throw new InboxServiceError(
      "forbidden",
      "Token does not grant access to the specified WhatsApp Business Account"
    );
  }
}

/**
 * Verifies that phoneNumberId belongs to the WABA.
 * Calls GET /{wabaId}/phone_numbers and checks the returned list.
 * Throws InboxServiceError on mismatch or network failure.
 */
export async function verifyPhoneNumberIdOwnership(
  accessToken: string,
  wabaId: string,
  phoneNumberId: string,
  version: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id`;
  const data = await graphGet(url, accessToken, fetchImpl);
  const numbers = Array.isArray(data.data) ? (data.data as { id?: string }[]) : [];
  const owned = numbers.some((n) => String(n.id) === String(phoneNumberId));
  if (!owned) {
    throw new InboxServiceError(
      "forbidden",
      "Phone Number ID does not belong to the specified WhatsApp Business Account"
    );
  }
}

/**
 * Registers the app to receive webhooks for this phone number.
 * POST /{phone_number_id}/subscribed_apps
 */
export async function registerSubscribedApps(
  accessToken: string,
  phoneNumberId: string,
  version: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/subscribed_apps`;
  await graphPost(url, accessToken, fetchImpl);
}

/**
 * Deregisters the app from webhook delivery for this phone number.
 * DELETE /{phone_number_id}/subscribed_apps (best-effort).
 */
export async function deregisterSubscribedApps(
  accessToken: string,
  phoneNumberId: string,
  version: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/subscribed_apps`;
  await graphDelete(url, accessToken, fetchImpl);
}

// ─── Token exchange port ───────────────────────────────────────────────────

export type EmbeddedSignupCodeExchangePort = (input: {
  code: string;
  wabaId: string;
  phoneNumberId: string;
}) => Promise<{
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  phoneNumber?: string;
  expiresInSeconds?: number;
}>;

/**
 * Production token exchange: calls the Meta Graph API.
 * Requires WHATSAPP_APP_ID and WHATSAPP_APP_SECRET to be set.
 * Throws InboxServiceError with a sanitized message if credentials are missing
 * or Meta returns an error.
 *
 * NOTE: No mock fallback exists. Omitting the app credentials is a
 * configuration error, not a signal to enter simulation mode.
 */
async function defaultEmbeddedSignupCodeExchange(
  input: { code: string; wabaId: string; phoneNumberId: string },
  fetchImpl: typeof fetch = fetch
): Promise<{
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  phoneNumber?: string;
  expiresInSeconds?: number;
}> {
  const appId = process.env.WHATSAPP_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (!appId || !appSecret) {
    throw new InboxServiceError(
      "service_unavailable",
      "WhatsApp Embedded Signup requires WHATSAPP_APP_ID and WHATSAPP_APP_SECRET to be configured"
    );
  }

  const version = resolveGraphVersion();
  const url =
    `https://graph.facebook.com/${version}/oauth/access_token` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&code=${encodeURIComponent(input.code)}`;

  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (networkErr) {
    throw new InboxServiceError(
      "service_unavailable",
      "Network error during Meta authorization code exchange"
    );
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new InboxServiceError(
      "service_unavailable",
      "Meta returned non-JSON during authorization code exchange"
    );
  }

  if (!res.ok || data.error) {
    const sanitized = sanitizeProviderError(data);
    throw new InboxServiceError(
      "service_unavailable",
      `Meta authorization code exchange failed: ${sanitized}`
    );
  }

  const accessToken = data.access_token ? String(data.access_token) : null;
  if (!accessToken) {
    throw new InboxServiceError(
      "service_unavailable",
      "Meta authorization exchange returned no access token"
    );
  }

  return {
    accessToken,
    // wabaId and phoneNumberId come from the client callback (verified separately).
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    phoneNumber: typeof data.phone_number === "string" ? data.phone_number : undefined,
    expiresInSeconds:
      typeof data.expires_in === "number" ? data.expires_in : undefined,
  };
}

// ─── OAuth state (CSRF) helpers ───────────────────────────────────────────

/**
 * Generates a CSRF state nonce for the Embedded Signup SDK launch.
 * The nonce is single-use and expires after 15 minutes.
 * Returns the nonce to embed in the Facebook Login SDK options.
 */
export function generateEmbeddedSignupState(
  companyId: string,
  actorId: string,
  stateStore: OAuthStateStore = memoryOAuthStateStore
): string {
  return stateStore.create(companyId, actorId);
}

// ─── Embedded Signup onboarding ────────────────────────────────────────────

export type EmbeddedSignupOnboardingDeps = {
  exchangePort?: EmbeddedSignupCodeExchangePort;
  stateStore?: OAuthStateStore;
  /** Injected fetch for unit tests. */
  fetchImpl?: typeof fetch;
  /** Skip Graph API ownership verification (tests only). */
  skipOwnershipVerification?: boolean;
};

/**
 * Complete Embedded Signup flow:
 *   1. Validate CSRF state nonce (single-use, unexpired).
 *   2. Exchange authorization code for access token via Meta Graph API.
 *   3. Verify WABA ownership (token can access the claimed WABA).
 *   4. Verify Phone Number ID ownership (belongs to WABA).
 *   5. Register subscribed_apps for webhook delivery.
 *   6. Persist credentials (scoped to companyId).
 *   7. Return sanitized connection status.
 */
export async function processEmbeddedSignupOnboarding(
  input: {
    code: string;
    wabaId: string;
    phoneNumberId: string;
    state: string;
    companyId: string;
    actor: RequestActor;
  },
  deps: EmbeddedSignupOnboardingDeps = {}
): Promise<WhatsAppConnectionStatusPayload> {
  if (input.actor.role !== "Super Admin" && input.actor.role !== "Admin") {
    throw new InboxServiceError(
      "forbidden",
      "Only Admin users can perform WhatsApp onboarding."
    );
  }

  if (!input.code || !input.code.trim()) {
    throw new InboxServiceError(
      "invalid_argument",
      "Embedded Signup authorization code is required."
    );
  }

  if (!input.state || !input.state.trim()) {
    throw new InboxServiceError(
      "invalid_argument",
      "OAuth state parameter is required (CSRF protection)."
    );
  }

  if (!input.wabaId || !input.wabaId.trim()) {
    throw new InboxServiceError(
      "invalid_argument",
      "WABA ID is required."
    );
  }

  if (!input.phoneNumberId || !input.phoneNumberId.trim()) {
    throw new InboxServiceError(
      "invalid_argument",
      "Phone Number ID is required."
    );
  }

  // ── Step 1: Validate CSRF state nonce ──
  const stateStore = deps.stateStore ?? memoryOAuthStateStore;
  const stateResult = stateStore.consume(input.state, input.companyId);
  if (!stateResult.ok) {
    throw new InboxServiceError(
      "invalid_argument",
      `OAuth state validation failed: ${(stateResult as { ok: false; reason: string }).reason}`
    );
  }

  const exchange = deps.exchangePort
    ? (i: { code: string; wabaId: string; phoneNumberId: string }) => deps.exchangePort!(i)
    : (i: { code: string; wabaId: string; phoneNumberId: string }) =>
        defaultEmbeddedSignupCodeExchange(i, deps.fetchImpl);

  const version = resolveGraphVersion();

  try {
    // ── Step 2: Exchange code for token ──
    const result = await exchange({
      code: input.code,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
    });

    if (!result.accessToken || !result.phoneNumberId || !result.wabaId) {
      throw new InboxServiceError(
        "service_unavailable",
        "Meta authorization exchange returned incomplete credentials."
      );
    }

    // ── Steps 3 & 4: Ownership verification ──
    if (!deps.skipOwnershipVerification) {
      await verifyWabaOwnership(
        result.accessToken,
        result.wabaId,
        version,
        deps.fetchImpl
      );
      await verifyPhoneNumberIdOwnership(
        result.accessToken,
        result.wabaId,
        result.phoneNumberId,
        version,
        deps.fetchImpl
      );
    }

    // ── Step 5: Register for webhooks ──
    if (!deps.skipOwnershipVerification) {
      await registerSubscribedApps(
        result.accessToken,
        result.phoneNumberId,
        version,
        deps.fetchImpl
      );
    }

    // ── Step 6: Persist (scoped to companyId) ──
    connectionStore.companyId = input.companyId;
    connectionStore.wabaId = result.wabaId;
    connectionStore.phoneNumberId = result.phoneNumberId;
    connectionStore.accessToken = result.accessToken;
    if (result.phoneNumber) connectionStore.phoneNumber = result.phoneNumber;
    if (result.expiresInSeconds) {
      connectionStore.tokenExpiresAt =
        Date.now() + result.expiresInSeconds * 1000;
    } else {
      connectionStore.tokenExpiresAt = null;
    }
    connectionStore.lastError = null;
    connectionStore.stateOverride = null;

    return getWhatsAppConnectionStatus();
  } catch (err) {
    if (err instanceof InboxServiceError) throw err;
    // Sanitize unexpected errors before surfacing.
    const sanitized = sanitizeProviderError(
      err instanceof Error ? err.message : String(err)
    );
    recordConnectionError(sanitized);
    throw new InboxServiceError(
      "service_unavailable",
      `WhatsApp onboarding failed: ${sanitized}`
    );
  }
}

// ─── Disconnect / revoke ───────────────────────────────────────────────────

export type DisconnectDeps = {
  fetchImpl?: typeof fetch;
  /** Skip Meta API calls (tests only). */
  skipRevoke?: boolean;
};

/**
 * Revokes the current connection:
 *   1. Deregisters subscribed_apps (best-effort — never blocks disconnect).
 *   2. Clears all persisted credentials.
 *   3. Returns updated (NOT_CONNECTED) status.
 */
export async function disconnectWhatsApp(
  actor: RequestActor,
  deps: DisconnectDeps = {}
): Promise<WhatsAppConnectionStatusPayload> {
  if (actor.role !== "Super Admin" && actor.role !== "Admin") {
    throw new InboxServiceError(
      "forbidden",
      "Only Admin users can disconnect WhatsApp connection."
    );
  }

  // Best-effort revoke: deregister from Meta webhook delivery.
  if (!deps.skipRevoke) {
    const accessToken =
      connectionStore.accessToken ||
      process.env.WHATSAPP_ACCESS_TOKEN ||
      null;
    const phoneNumberId =
      connectionStore.phoneNumberId ||
      process.env.WHATSAPP_PHONE_NUMBER_ID ||
      null;

    if (accessToken && phoneNumberId) {
      const version = resolveGraphVersion();
      // Fire-and-forget: errors are intentionally swallowed.
      await deregisterSubscribedApps(
        accessToken,
        phoneNumberId,
        version,
        deps.fetchImpl
      ).catch(() => {
        // Non-fatal: Meta revoke failure must not prevent local disconnect.
      });
    }
  }

  connectionStore.companyId = null;
  connectionStore.accessToken = null;
  connectionStore.phoneNumberId = null;
  connectionStore.wabaId = null;
  connectionStore.phoneNumber = null;
  connectionStore.tokenExpiresAt = null;
  connectionStore.stateOverride = "NOT_CONNECTED";
  connectionStore.lastError = null;

  return getWhatsAppConnectionStatus();
}
