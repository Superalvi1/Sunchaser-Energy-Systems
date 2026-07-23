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
 *   - WABA ownership verification: after token exchange, GET /{wabaId} confirms the
 *     token can access the claimed WhatsApp Business Account (not Business Portfolio IDs).
 *   - Phone Number ID ownership: /WABA_ID/phone_numbers is queried to confirm the
 *     phone_number_id belongs to the WABA.
 *   - subscribed_apps registration: POST /{wabaId}/subscribed_apps registers
 *     the app for webhook delivery on every successful onboarding.
 *   - Proper revoke on disconnect: DELETE /{wabaId}/subscribed_apps is called
 *     before credentials are cleared from the repository.
 *   - Error sanitization: raw Meta Graph API error bodies are never forwarded to
 *     callers. Only sanitized summaries are surfaced.
 *   - Tenant binding: every connection is scoped to a companyId. Cross-tenant
 *     access is rejected.
 *   - Credentials are persisted via WhatsAppConnectionRepository (Supabase in
 *     production, in-memory for tests). WHATSAPP_* env vars are bootstrap-only
 *     and never produce CONNECTED status without a tenant-bound repository record.
 */

import type { RequestActor } from "../middleware/actor.ts";
import { GRAPH_API_VERSION_PATTERN } from "./whatsappConfig.ts";
import {
  DEFAULT_COMPANY_ID,
  resolveCompanyId,
  WHATSAPP_GRAPH_API_VERSION_FALLBACK,
} from "./whatsappConstants.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";
import { sanitizeProviderError } from "./whatsappGraphClient.ts";
import type { OAuthStateStore } from "./whatsappOAuthStateStore.ts";
import { memoryOAuthStateStore } from "./whatsappOAuthStateStore.ts";

/** Injectable OAuth state store (memory in tests; Supabase in production). */
let oauthStateStore: OAuthStateStore = memoryOAuthStateStore;

export function setWhatsAppOAuthStateStore(store: OAuthStateStore): void {
  oauthStateStore = store;
}

export function getWhatsAppOAuthStateStore(): OAuthStateStore {
  return oauthStateStore;
}
import type {
  WhatsAppConnectionRecord,
  WhatsAppConnectionRepository,
} from "./whatsappConnectionRepository.ts";
import {
  InMemoryWhatsAppConnectionRepository,
} from "./whatsappConnectionRepository.ts";

// ─── Connection state types ────────────────────────────────────────────────

export type WhatsAppConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "ERROR"
  | "TOKEN_EXPIRED"
  | "WEBHOOK_PENDING";

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
  /** Set when local disconnect succeeded but Meta revoke did not. */
  revokeWarning?: string | null;
};

/** Map persisted / legacy override values onto the onboarding status enum. */
export function normalizeWhatsAppConnectionStatus(
  raw: string | null | undefined
): WhatsAppConnectionState | null {
  if (!raw) return null;
  switch (raw) {
    case "DISCONNECTED":
    case "CONNECTING":
    case "CONNECTED":
    case "ERROR":
    case "TOKEN_EXPIRED":
    case "WEBHOOK_PENDING":
      return raw;
    case "NOT_CONNECTED":
      return "DISCONNECTED";
    case "REAUTHORIZATION_REQUIRED":
      return "TOKEN_EXPIRED";
    default:
      return null;
  }
}

// ─── Credential repository ─────────────────────────────────────────────────

let connectionRepository: WhatsAppConnectionRepository =
  new InMemoryWhatsAppConnectionRepository();

export function setWhatsAppConnectionRepository(
  repo: WhatsAppConnectionRepository
): void {
  connectionRepository = repo;
}

export function getWhatsAppConnectionRepository(): WhatsAppConnectionRepository {
  return connectionRepository;
}

export type WhatsAppConnectionTestSeed = Partial<
  Omit<WhatsAppConnectionRecord, "companyId">
>;

/** Reset to a fresh in-memory repository; optionally seed DEFAULT_COMPANY_ID. */
export async function resetConnectionStoreForTests(
  initial?: WhatsAppConnectionTestSeed
): Promise<void> {
  connectionRepository = new InMemoryWhatsAppConnectionRepository();
  oauthStateStore = memoryOAuthStateStore;
  await memoryOAuthStateStore.clear();
  if (initial) {
    await connectionRepository.upsert({
      companyId: DEFAULT_COMPANY_ID,
      wabaId: initial.wabaId ?? null,
      phoneNumberId: initial.phoneNumberId ?? null,
      phoneNumber: initial.phoneNumber ?? null,
      accessToken: initial.accessToken ?? null,
      tokenExpiresAt: initial.tokenExpiresAt ?? null,
      lastWebhookAt: initial.lastWebhookAt ?? null,
      lastError: initial.lastError ?? null,
      stateOverride: initial.stateOverride ?? null,
    });
  }
}

function parseTokenExpiresAtMs(
  tokenExpiresAt: string | null | undefined
): number | null {
  if (!tokenExpiresAt) return null;
  const ms = new Date(tokenExpiresAt).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function formatTokenExpiresAt(expiresInSeconds?: number): string | null {
  if (!expiresInSeconds) return null;
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

async function getOrCreateRecord(
  companyId: string
): Promise<WhatsAppConnectionRecord> {
  const existing = await connectionRepository.get(companyId);
  if (existing) return existing;
  return {
    companyId,
    wabaId: null,
    phoneNumberId: null,
    phoneNumber: null,
    accessToken: null,
    tokenExpiresAt: null,
    lastWebhookAt: null,
    lastError: null,
    stateOverride: null,
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

export async function recordWebhookPing(
  timestamp = new Date().toISOString(),
  companyId?: string
): Promise<void> {
  const cid = resolveCompanyId(companyId);
  const record = await connectionRepository.get(cid);
  if (!record) return;
  await connectionRepository.upsert({
    ...record,
    lastWebhookAt: timestamp,
  });
}

export async function recordConnectionError(
  sanitizedError: string,
  companyId?: string
): Promise<void> {
  const cid = resolveCompanyId(companyId);
  const base = await getOrCreateRecord(cid);
  await connectionRepository.upsert({
    ...base,
    lastError: sanitizedError,
    stateOverride: "ERROR",
  });
}

export async function clearConnectionError(companyId?: string): Promise<void> {
  const cid = resolveCompanyId(companyId);
  const record = await connectionRepository.get(cid);
  if (!record) return;
  await connectionRepository.upsert({
    ...record,
    lastError: null,
    stateOverride: null,
  });
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
  if (stateOverride === "TOKEN_EXPIRED") return "reauth_required";
  if (!accessToken || !accessToken.trim()) return "reauth_required";
  if (!expiresAt) return "valid"; // Permanent System User tokens have no expiration
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) return "expired";
  if (remainingMs <= 1000 * 60 * 60 * 24 * 7) return "expiring_soon";
  return "valid";
}

function buildStatusFromRecord(
  record: WhatsAppConnectionRecord | null
): WhatsAppConnectionStatusPayload {
  const wabaId = record?.wabaId ?? null;
  const phoneNumberId = record?.phoneNumberId ?? null;
  const phoneNumber = record?.phoneNumber ?? null;
  const accessToken = record?.accessToken ?? null;
  const lastWebhookAt = record?.lastWebhookAt ?? null;
  const lastError = record?.lastError ?? null;
  const stateOverride = normalizeWhatsAppConnectionStatus(record?.stateOverride);
  const tokenExpiresAtMs = parseTokenExpiresAtMs(record?.tokenExpiresAt);

  const webhookHealth = computeWebhookHealth(lastWebhookAt);
  const tokenHealth = computeTokenHealth(
    accessToken,
    tokenExpiresAtMs,
    stateOverride
  );

  let status: WhatsAppConnectionState = "DISCONNECTED";
  if (stateOverride === "CONNECTING" || stateOverride === "ERROR") {
    status = stateOverride;
  } else if (stateOverride === "DISCONNECTED") {
    status = "DISCONNECTED";
  } else if (tokenHealth === "expired" || tokenHealth === "reauth_required") {
    status = accessToken ? "TOKEN_EXPIRED" : "DISCONNECTED";
  } else if (phoneNumberId && accessToken) {
    status = lastWebhookAt ? "CONNECTED" : "WEBHOOK_PENDING";
  }

  return {
    status,
    connectionMode: "COEXISTENCE",
    wabaIdMasked: maskId(wabaId),
    phoneNumberMasked: maskPhone(phoneNumber),
    phoneNumberIdMasked: maskId(phoneNumberId),
    lastWebhookAt,
    webhookHealth,
    tokenHealth,
    connectionErrorSummary: lastError,
    canReconnect: true,
  };
}

export async function getWhatsAppConnectionStatus(
  companyId?: string
): Promise<WhatsAppConnectionStatusPayload> {
  const cid = resolveCompanyId(companyId);
  const record = await connectionRepository.get(cid);
  return buildStatusFromRecord(record);
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
  } catch {
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
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new InboxServiceError(
      "service_unavailable",
      "Meta Graph API network error during app deregistration"
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
      `Meta subscribed_apps deregistration failed: ${sanitized}`
    );
  }
}

// ─── WABA & Phone Number ID ownership verification ─────────────────────────

/**
 * Verifies that the access token can access the claimed WhatsApp Business Account.
 *
 * Uses GET /{wabaId}?fields=id — success with a matching id proves WABA access.
 * Do NOT compare Meta Business Portfolio IDs (/me/businesses) to WABA IDs; those
 * are different identifier namespaces.
 */
export async function verifyWabaOwnership(
  accessToken: string,
  wabaId: string,
  version: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}?fields=id`;
  const data = await graphGet(url, accessToken, fetchImpl);
  if (String(data.id ?? "") !== String(wabaId)) {
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
 * Registers the app to receive webhooks for this WABA.
 * POST /{wabaId}/subscribed_apps
 */
export async function registerSubscribedApps(
  accessToken: string,
  wabaId: string,
  version: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/subscribed_apps`;
  await graphPost(url, accessToken, fetchImpl);
}

/**
 * Deregisters the app from webhook delivery for this WABA.
 * DELETE /{wabaId}/subscribed_apps
 */
export async function deregisterSubscribedApps(
  accessToken: string,
  wabaId: string,
  version: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/subscribed_apps`;
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
  } catch {
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
export async function generateEmbeddedSignupState(
  companyId: string,
  actorId: string,
  stateStore: OAuthStateStore = oauthStateStore
): Promise<string> {
  return stateStore.create(companyId, actorId);
}

// ─── Embedded Signup onboarding ────────────────────────────────────────────

export type EmbeddedSignupOnboardingDeps = {
  exchangePort?: EmbeddedSignupCodeExchangePort;
  stateStore?: OAuthStateStore;
  connectionRepository?: WhatsAppConnectionRepository;
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

  const stateStore = deps.stateStore ?? oauthStateStore;
  const repo = deps.connectionRepository ?? connectionRepository;

  // ── Step 1: Validate CSRF state nonce ──
  const stateResult = await stateStore.consume(
    input.state,
    input.companyId,
    input.actor.id
  );
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
        result.wabaId,
        version,
        deps.fetchImpl
      );
    }

    // ── Step 6: Persist (scoped to companyId) ──
    await repo.upsert({
      companyId: input.companyId,
      wabaId: result.wabaId,
      phoneNumberId: result.phoneNumberId,
      phoneNumber: result.phoneNumber ?? null,
      accessToken: result.accessToken,
      tokenExpiresAt: formatTokenExpiresAt(result.expiresInSeconds),
      lastWebhookAt: null,
      lastError: null,
      stateOverride: null,
    });

    return getWhatsAppConnectionStatus(input.companyId);
  } catch (err) {
    if (err instanceof InboxServiceError) throw err;
    const sanitized = sanitizeProviderError(
      err instanceof Error ? err.message : String(err)
    );
    await recordConnectionError(sanitized, input.companyId);
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
  connectionRepository?: WhatsAppConnectionRepository;
  companyId?: string;
};

/**
 * Revokes the current connection:
 *   1. Deregisters subscribed_apps on the tenant WABA (best-effort).
 *   2. Clears all persisted credentials via repository.
 *   3. Returns updated (DISCONNECTED) status, with revokeWarning if Meta revoke failed.
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

  const cid = resolveCompanyId(deps.companyId);
  const repo = deps.connectionRepository ?? connectionRepository;
  const record = await repo.get(cid);
  let revokeWarning: string | null = null;

  if (!deps.skipRevoke && record?.accessToken && record?.wabaId) {
    const version = resolveGraphVersion();
    try {
      await deregisterSubscribedApps(
        record.accessToken,
        record.wabaId,
        version,
        deps.fetchImpl
      );
    } catch (err) {
      revokeWarning =
        err instanceof InboxServiceError
          ? err.message
          : sanitizeProviderError(
              err instanceof Error ? err.message : String(err)
            );
    }
  }

  await repo.clear(cid);

  const status = await getWhatsAppConnectionStatus(cid);
  return revokeWarning ? { ...status, revokeWarning } : status;
}

// ─── Test Connection (admin diagnostics) ───────────────────────────────────

export type WhatsAppConnectionTestResult = {
  ok: boolean;
  tokenValid: boolean;
  wabaAccessOk: boolean;
  phoneAccessOk: boolean;
  status: WhatsAppConnectionStatusPayload;
  summary: string;
  details: {
    wabaIdMasked: string | null;
    phoneNumberIdMasked: string | null;
  };
};

/**
 * Live Graph API probe: validates stored token, WABA access, and phone ownership.
 * Does not mutate credentials. Sanitized results only.
 */
export async function testWhatsAppConnection(
  companyId?: string,
  deps: { fetchImpl?: typeof fetch } = {}
): Promise<WhatsAppConnectionTestResult> {
  const cid = resolveCompanyId(companyId);
  const record = await connectionRepository.get(cid);
  const status = buildStatusFromRecord(record);
  const fetchImpl = deps.fetchImpl ?? fetch;

  if (!record?.accessToken || !record.wabaId || !record.phoneNumberId) {
    return {
      ok: false,
      tokenValid: false,
      wabaAccessOk: false,
      phoneAccessOk: false,
      status,
      summary: "No connected WhatsApp credentials to test",
      details: {
        wabaIdMasked: status.wabaIdMasked,
        phoneNumberIdMasked: status.phoneNumberIdMasked,
      },
    };
  }

  const version = resolveGraphVersion();
  let tokenValid = false;
  let wabaAccessOk = false;
  let phoneAccessOk = false;
  let summary = "Connection test failed";

  try {
    // Token + WABA access
    await verifyWabaOwnership(
      record.accessToken,
      record.wabaId,
      version,
      fetchImpl
    );
    tokenValid = true;
    wabaAccessOk = true;

    await verifyPhoneNumberIdOwnership(
      record.accessToken,
      record.wabaId,
      record.phoneNumberId,
      version,
      fetchImpl
    );
    phoneAccessOk = true;
    summary = "Token, WABA access, and phone access validated";
  } catch (err) {
    summary =
      err instanceof InboxServiceError
        ? err.message
        : "Connection test failed";
  }

  return {
    ok: tokenValid && wabaAccessOk && phoneAccessOk,
    tokenValid,
    wabaAccessOk,
    phoneAccessOk,
    status,
    summary,
    details: {
      wabaIdMasked: maskId(record.wabaId),
      phoneNumberIdMasked: maskId(record.phoneNumberId),
    },
  };
}
