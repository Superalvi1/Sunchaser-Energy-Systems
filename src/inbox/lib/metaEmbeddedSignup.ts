/**
 * Official Meta Embedded Signup (Facebook JS SDK) — no fabricated IDs/codes.
 *
 * Captures WABA / Phone Number IDs only from documented WA_EMBEDDED_SIGNUP
 * postMessage events, and the authorization code from FB.login (code mode).
 *
 * Settlement is coordinated through a single result promise so timeout,
 * cancel, and success always unblock the launcher — even when FB.login
 * never invokes its callback.
 */

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
/** Max wait for Facebook JS SDK readiness before FB.login. */
export const SDK_LOAD_TIMEOUT_MS = 15_000;
const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
const SDK_POLL_INTERVAL_MS = 50;
const SDK_LOAD_TIMEOUT_MESSAGE =
  "Meta SDK did not finish loading. Please refresh and try again.";

const ALLOWED_MESSAGE_ORIGINS = new Set([
  "https://www.facebook.com",
  "https://facebook.com",
  "https://web.facebook.com",
  "https://www.facebook.com/",
  "https://business.facebook.com",
]);

function readViteEnv(): Record<string, string | undefined> {
  return (import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }).env ?? {};
}

export type MetaEmbeddedSignupConfig = {
  appId: string;
  configId: string;
  graphVersion: string;
};

export type MetaEmbeddedSignupResult = {
  code: string;
  /** Server-issued OAuth state that was bound into FB.login. */
  state: string;
  wabaId: string;
  phoneNumberId: string;
};

export type MetaEmbeddedSignupErrorCode =
  | "missing_config"
  | "missing_state"
  | "sdk_load_failed"
  | "sdk_config_conflict"
  | "cancelled"
  | "timeout"
  | "invalid_origin"
  | "malformed_payload"
  | "missing_code"
  | "missing_assets"
  | "missing_phone_number_id"
  | "login_error";

export type MetaEmbeddedSignupProviderError = {
  message?: string;
  code?: string | number;
  error_subcode?: string | number;
  fbtrace_id?: string;
  httpStatus?: number;
};

export class MetaEmbeddedSignupError extends Error {
  readonly code: MetaEmbeddedSignupErrorCode;
  readonly providerError?: MetaEmbeddedSignupProviderError;

  constructor(
    code: MetaEmbeddedSignupErrorCode,
    message: string,
    providerError?: MetaEmbeddedSignupProviderError
  ) {
    super(message);
    this.name = "MetaEmbeddedSignupError";
    this.code = code;
    this.providerError = providerError;
  }
}

const PROVIDER_ERROR_LOG_KEYS = [
  "message",
  "code",
  "error_subcode",
  "fbtrace_id",
  "httpStatus",
] as const;

const DEBUG_REDACTED = "[REDACTED]";

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object") return null;
  if (value instanceof Error) return null;
  return value as Record<string, unknown>;
}

function parseProviderHttpStatus(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}

/**
 * Extract only allowlisted Meta provider-error fields that Meta actually supplied.
 * Never copies app codes/messages, OAuth secrets, asset IDs, or raw payloads.
 */
export function extractEmbeddedSignupProviderError(
  source: unknown
): MetaEmbeddedSignupProviderError | undefined {
  if (source instanceof MetaEmbeddedSignupError) {
    return source.providerError;
  }

  const root = asPlainRecord(source);
  if (!root) return undefined;

  // Only inspect known Meta envelopes; never recurse into authResponse / tokens.
  const envelopes = [root, asPlainRecord(root.error), asPlainRecord(root.data)].filter(
    (v): v is Record<string, unknown> => v != null
  );

  const providerError: MetaEmbeddedSignupProviderError = {};

  for (const envelope of envelopes) {
    if (providerError.message == null) {
      const message = envelope.error_message ?? envelope.message;
      if (typeof message === "string" && message.trim()) {
        providerError.message = message.trim();
      }
    }
    if (providerError.code == null) {
      const code = envelope.error_code ?? envelope.code;
      if (typeof code === "number" && Number.isFinite(code)) {
        providerError.code = code;
      } else if (typeof code === "string" && code.trim()) {
        providerError.code = code.trim();
      }
    }
    if (providerError.error_subcode == null) {
      const subcode = envelope.error_subcode;
      if (typeof subcode === "number" && Number.isFinite(subcode)) {
        providerError.error_subcode = subcode;
      } else if (typeof subcode === "string" && subcode.trim()) {
        providerError.error_subcode = subcode.trim();
      }
    }
    if (providerError.fbtrace_id == null) {
      const traceId = envelope.fbtrace_id;
      if (typeof traceId === "string" && traceId.trim()) {
        providerError.fbtrace_id = traceId.trim();
      }
    }
    if (providerError.httpStatus == null) {
      const httpStatus = parseProviderHttpStatus(envelope.httpStatus);
      if (httpStatus != null) providerError.httpStatus = httpStatus;
    }
  }

  return Object.keys(providerError).length > 0 ? providerError : undefined;
}

/** Redact sensitive substrings from Meta provider strings before logging. */
export function sanitizeProviderDebugString(value: string): string | undefined {
  let out = value;

  out = out.replace(/\bEAA[A-Za-z0-9]+\b/g, DEBUG_REDACTED);
  out = out.replace(/\bEAAB[A-Za-z0-9]+\b/g, DEBUG_REDACTED);
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, DEBUG_REDACTED);
  out = out.replace(
    /\b(?:access[_-]?token|app[_-]?secret|client[_-]?secret|authorization[_-]?code|oauth[_-]?state|nonce)\b\s*[:=]\s*\S+/gi,
    DEBUG_REDACTED
  );
  // Phone-number-like values.
  out = out.replace(/\+?\d[\d\s().-]{7,}\d/g, DEBUG_REDACTED);
  // Long numeric IDs (WABA / phone-number IDs).
  out = out.replace(/\b\d{10,}\b/g, DEBUG_REDACTED);
  // Long opaque alphanumeric tokens / states / codes.
  out = out.replace(/\b[A-Za-z0-9_-]{20,}\b/g, DEBUG_REDACTED);

  const trimmed = out.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

/**
 * Build a fresh allowlisted object for console logging.
 * Never returns/logs the previously attached providerError reference.
 */
export function sanitizeProviderErrorForDebug(
  providerError: MetaEmbeddedSignupProviderError | undefined
): MetaEmbeddedSignupProviderError | undefined {
  if (!providerError || typeof providerError !== "object") return undefined;

  const source = providerError as Record<string, unknown>;
  const fresh: MetaEmbeddedSignupProviderError = {};

  for (const key of PROVIDER_ERROR_LOG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];

    if (key === "httpStatus") {
      const httpStatus = parseProviderHttpStatus(value);
      if (httpStatus != null) fresh.httpStatus = httpStatus;
      continue;
    }

    if (key === "code" || key === "error_subcode") {
      if (typeof value === "number" && Number.isFinite(value)) {
        // Keep compact Meta numeric codes; omit ID-length numerics.
        if (String(Math.trunc(Math.abs(value))).length >= 10) continue;
        fresh[key] = value;
      } else if (typeof value === "string") {
        const safe = sanitizeProviderDebugString(value);
        if (safe != null) fresh[key] = safe;
      }
      continue;
    }

    if (typeof value === "string") {
      const safe = sanitizeProviderDebugString(value);
      if (safe != null) fresh[key] = safe;
    }
  }

  return Object.keys(fresh).length > 0 ? fresh : undefined;
}

/**
 * TEMPORARY DEBUG — remove after Meta Embedded Signup failure investigation.
 * Logs only phase + a freshly sanitized allowlisted providerError.
 */
export function logMetaEmbeddedSignupDebug(
  phase: string,
  providerError?: MetaEmbeddedSignupProviderError
): void {
  console.error("[MetaEmbeddedSignup DEBUG]", {
    phase,
    providerError: sanitizeProviderErrorForDebug(providerError),
  });
}

/** Accepted WA_EMBEDDED_SIGNUP event classifications (parser contract). */
export const META_EMBEDDED_SIGNUP_ACCEPTED_EVENTS = [
  "FINISH",
  "FINISH_*", // any event whose uppercase form starts with FINISH_ (except handled FINISH_ONLY_WABA)
  "FINISH_ONLY_WABA",
  "CANCEL",
  "CANCEL*", // any event whose uppercase form starts with CANCEL
  "ERROR",
] as const;

export type MetaEmbeddedSignupIgnoreReason =
  | "origin_not_allowed"
  | "unsupported_data_type"
  | "json_parse_failed"
  | "wrong_message_type"
  | "unsupported_event"
  | "malformed_event";

/** Fixed origin labels only — never log runtime hostnames/URLs. */
export type SafeOriginClass =
  | "facebook"
  | "facebook_web"
  | "facebook_business"
  | "unknown"
  | "invalid";

/** Fixed message-type labels only — never log runtime type strings. */
export type SafeMessageType = "WA_EMBEDDED_SIGNUP" | "other" | "missing";

/**
 * Fixed event labels mirroring parser recognition — does not broaden acceptance.
 */
export type SafeEmbeddedSignupEvent =
  | "FINISH"
  | "FINISH_VARIANT"
  | "FINISH_ONLY_WABA"
  | "CANCEL"
  | "CANCEL_VARIANT"
  | "ERROR"
  | "UNSUPPORTED"
  | "MISSING";

/** Fixed FB.login status labels only — never log runtime status strings. */
export type SafeFbLoginStatus =
  | "connected"
  | "not_authorized"
  | "unknown"
  | "unexpected";

const TRACE_DATA_KEY_ALLOWLIST = new Set([
  "waba_id",
  "phone_number_id",
  "business_id",
  "error_message",
  "error_code",
  "error_subcode",
  "fbtrace_id",
  "httpStatus",
]);

/**
 * TEMPORARY TRACE — remove after timeout diagnosis.
 * Caller must pass only already-safe fields (no payload values / secrets).
 */
export function logMetaEmbeddedSignupTrace(
  payload: Record<string, unknown>
): void {
  console.error("[MetaEmbeddedSignup TRACE]", payload);
}

/**
 * Map event.origin to a fixed allowlist-consistent label.
 * Never returns hostname/path/query/fragment.
 */
export function classifySafeOriginClass(origin: string): SafeOriginClass {
  const raw = String(origin || "").trim();
  if (!raw) return "invalid";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    if (host === "facebook.com" || host === "www.facebook.com") return "facebook";
    if (host === "web.facebook.com") return "facebook_web";
    if (host === "business.facebook.com") return "facebook_business";
    return "unknown";
  } catch {
    return "invalid";
  }
}

export function classifySafeMessageType(type: unknown): SafeMessageType {
  if (typeof type !== "string") return "missing";
  if (type === "WA_EMBEDDED_SIGNUP") return "WA_EMBEDDED_SIGNUP";
  return "other";
}

/**
 * Classify event strings using the same recognition rules as the parser.
 * Does not broaden which events parseEmbeddedSignupMessageData accepts.
 */
export function classifySafeEmbeddedSignupEvent(
  event: unknown
): SafeEmbeddedSignupEvent {
  if (typeof event !== "string") return "MISSING";
  const eventKey = event.trim().toUpperCase();
  if (!eventKey) return "MISSING";
  // Mirror parseEmbeddedSignupMessageData order/semantics exactly.
  if (eventKey === "CANCEL" || eventKey.startsWith("CANCEL")) {
    return eventKey === "CANCEL" ? "CANCEL" : "CANCEL_VARIANT";
  }
  if (eventKey === "ERROR") return "ERROR";
  if (eventKey === "FINISH_ONLY_WABA") return "FINISH_ONLY_WABA";
  if (eventKey === "FINISH" || eventKey.startsWith("FINISH_")) {
    return eventKey === "FINISH" ? "FINISH" : "FINISH_VARIANT";
  }
  return "UNSUPPORTED";
}

export function classifySafeFbLoginStatus(
  status: unknown
): SafeFbLoginStatus | undefined {
  if (typeof status !== "string") return undefined;
  if (status === "connected") return "connected";
  if (status === "not_authorized") return "not_authorized";
  if (status === "unknown") return "unknown";
  return "unexpected";
}

function describeDataType(data: unknown): string {
  if (data === null) return "null";
  return typeof data;
}

function allowlistedDataKeysFromPayload(raw: unknown): string[] {
  let payload: unknown = raw;
  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const obj = asPlainRecord(payload);
  if (!obj) return [];
  const data = asPlainRecord(obj.data);
  if (!data) return [];
  return Object.keys(data)
    .filter((key) => TRACE_DATA_KEY_ALLOWLIST.has(key))
    .sort();
}

function readMessageTypeAndEvent(raw: unknown): {
  type: unknown;
  event: unknown;
  jsonParseFailed?: boolean;
  unsupportedDataType?: boolean;
} {
  let payload: unknown = raw;
  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw);
    } catch {
      return { type: undefined, event: undefined, jsonParseFailed: true };
    }
  }
  if (payload == null || typeof payload !== "object") {
    return {
      type: undefined,
      event: undefined,
      unsupportedDataType: true,
    };
  }
  const obj = payload as Record<string, unknown>;
  return {
    type: obj.type,
    event: obj.event,
  };
}

/**
 * Classify why an incoming message cannot drive Embedded Signup settlement.
 * Settlement behavior remains owned by parseEmbeddedSignupMessageData().
 * Returns only fixed enums — never runtime origin/type/event strings.
 */
export function classifyIgnoredEmbeddedSignupMessage(
  origin: string,
  raw: unknown
): {
  reason: MetaEmbeddedSignupIgnoreReason;
  originClass: SafeOriginClass;
  type: SafeMessageType;
  event: SafeEmbeddedSignupEvent;
} | null {
  const originClass = classifySafeOriginClass(origin);
  if (!isAllowedMetaMessageOrigin(origin)) {
    return {
      reason: "origin_not_allowed",
      originClass,
      type: "missing",
      event: "MISSING",
    };
  }

  const meta = readMessageTypeAndEvent(raw);
  const type = classifySafeMessageType(meta.type);
  const event = classifySafeEmbeddedSignupEvent(meta.event);

  if (meta.jsonParseFailed) {
    return { reason: "json_parse_failed", originClass, type, event };
  }
  if (meta.unsupportedDataType) {
    return {
      reason: "unsupported_data_type",
      originClass,
      type,
      event,
    };
  }
  if (type !== "WA_EMBEDDED_SIGNUP") {
    return {
      reason: "wrong_message_type",
      originClass,
      type,
      event,
    };
  }

  const parsed = parseEmbeddedSignupMessageData(raw);
  if (parsed == null) {
    return {
      reason: "wrong_message_type",
      originClass,
      type,
      event,
    };
  }

  if (event === "UNSUPPORTED") {
    // WA-typed but unrecognized event — parser returns malformed and fails closed.
    return {
      reason: "unsupported_event",
      originClass,
      type,
      event,
    };
  }

  if (parsed.status === "malformed") {
    return {
      reason: "malformed_event",
      originClass,
      type,
      event,
    };
  }

  return null;
}

type FbLoginResponse = {
  authResponse?: { code?: string } | null;
  status?: string;
};

type FbSdk = {
  init: (opts: {
    appId: string;
    cookie?: boolean;
    xfbml?: boolean;
    version: string;
  }) => void;
  login: (
    callback: (response: FbLoginResponse) => void,
    options: Record<string, unknown>
  ) => void;
};

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

export function resolveMetaEmbeddedSignupConfig(
  env: Record<string, string | undefined> = readViteEnv()
): MetaEmbeddedSignupConfig {
  const appId = String(env.VITE_META_APP_ID || "").trim();
  const configId = String(env.VITE_META_CONFIG_ID || "").trim();
  const graphVersion = String(env.VITE_META_GRAPH_VERSION || "").trim();
  if (!appId || !configId || !graphVersion) {
    throw new MetaEmbeddedSignupError(
      "missing_config",
      "WhatsApp Embedded Signup is not configured (missing VITE_META_APP_ID, VITE_META_CONFIG_ID, or VITE_META_GRAPH_VERSION)."
    );
  }
  return { appId, configId, graphVersion };
}

export function isAllowedMetaMessageOrigin(origin: string): boolean {
  const o = String(origin || "").trim().replace(/\/$/, "");
  if (!o) return false;
  if (ALLOWED_MESSAGE_ORIGINS.has(o) || ALLOWED_MESSAGE_ORIGINS.has(`${o}/`)) {
    return true;
  }
  try {
    const url = new URL(o.includes("://") ? o : `https://${o}`);
    const host = url.hostname.toLowerCase();
    return (
      host === "facebook.com" ||
      host === "www.facebook.com" ||
      host === "web.facebook.com" ||
      host === "business.facebook.com"
    );
  } catch {
    return false;
  }
}

export type ParsedEmbeddedSignupMessage =
  | {
      status: "success";
      event: string;
      wabaId: string;
      phoneNumberId: string;
    }
  | { status: "cancelled"; event: string }
  | {
      status: "error";
      event: string;
      providerError?: MetaEmbeddedSignupProviderError;
    }
  | { status: "missing_phone"; event: string; wabaId: string }
  | { status: "malformed" }
  | null;

function decodeMessagePayload(raw: unknown): Record<string, unknown> | null {
  let payload: unknown = raw;
  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== "object") return null;
  return payload as Record<string, unknown>;
}

/**
 * Classify Meta session-info postMessage payloads.
 * CANCEL / ERROR are recognized before requiring asset IDs.
 */
export function parseEmbeddedSignupMessageData(
  raw: unknown
): ParsedEmbeddedSignupMessage {
  const obj = decodeMessagePayload(raw);
  if (!obj) return null;
  if (obj.type !== "WA_EMBEDDED_SIGNUP") return null;

  const event = typeof obj.event === "string" ? obj.event.trim() : "";
  const eventKey = event.toUpperCase();
  const data =
    obj.data && typeof obj.data === "object"
      ? (obj.data as Record<string, unknown>)
      : null;
  const wabaId =
    data && data.waba_id != null ? String(data.waba_id).trim() : "";
  const phoneNumberId =
    data && data.phone_number_id != null
      ? String(data.phone_number_id).trim()
      : "";

  // Cancel / error before requiring asset IDs.
  if (eventKey === "CANCEL" || eventKey.startsWith("CANCEL")) {
    return { status: "cancelled", event: event || "CANCEL" };
  }
  if (eventKey === "ERROR") {
    // Extract only from Meta `data` allowlisted fields — never the full event envelope.
    const providerError = extractEmbeddedSignupProviderError(data);
    return {
      status: "error",
      event: event || "ERROR",
      ...(providerError ? { providerError } : {}),
    };
  }

  if (eventKey === "FINISH_ONLY_WABA") {
    if (wabaId) {
      return {
        status: "missing_phone",
        event: event || "FINISH_ONLY_WABA",
        wabaId,
      };
    }
    return { status: "malformed" };
  }

  // Documented FINISH* variants require both IDs — never fabricate phoneNumberId.
  if (eventKey === "FINISH" || eventKey.startsWith("FINISH_")) {
    if (wabaId && phoneNumberId) {
      return {
        status: "success",
        event: event || "FINISH",
        wabaId,
        phoneNumberId,
      };
    }
    return { status: "malformed" };
  }

  // WA-typed but unrecognized / incomplete.
  return { status: "malformed" };
}

/** In-flight load keyed by appId|graphVersion. */
let sdkLoadPromise: Promise<FbSdk> | null = null;
let sdkLoadKey: string | null = null;
/** Tracks last successful FB.init identity to avoid duplicate init calls. */
let sdkInitKey: string | null = null;
let sdkLoadTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
let sdkPollHandle: ReturnType<typeof setInterval> | null = null;
/** Loader-owned fbAsyncInit wrapper (for safe restore). */
let sdkOwnedFbAsyncInit: (() => void) | null = null;
let sdkPreviousFbAsyncInit: (() => void) | undefined;

function sdkConfigKey(appId: string, graphVersion: string): string {
  return `${appId}|${graphVersion}`;
}

function restoreFbAsyncInitIfOwned(): void {
  if (typeof window === "undefined") return;
  if (
    sdkOwnedFbAsyncInit != null &&
    window.fbAsyncInit === sdkOwnedFbAsyncInit
  ) {
    window.fbAsyncInit = sdkPreviousFbAsyncInit;
  }
  sdkOwnedFbAsyncInit = null;
  sdkPreviousFbAsyncInit = undefined;
}

function clearSdkLoadWatchers(): void {
  if (sdkLoadTimeoutHandle != null) {
    clearTimeout(sdkLoadTimeoutHandle);
    sdkLoadTimeoutHandle = null;
  }
  if (sdkPollHandle != null) {
    clearInterval(sdkPollHandle);
    sdkPollHandle = null;
  }
  restoreFbAsyncInitIfOwned();
}

export function resetMetaSdkLoaderForTests(): void {
  clearSdkLoadWatchers();
  sdkLoadPromise = null;
  sdkLoadKey = null;
  sdkInitKey = null;
}

function initFbOnce(fb: FbSdk, appId: string, graphVersion: string): FbSdk {
  const key = sdkConfigKey(appId, graphVersion);
  if (sdkInitKey !== key) {
    fb.init({ appId, cookie: true, xfbml: false, version: graphVersion });
    sdkInitKey = key;
  }
  return fb;
}

export type LoadFacebookSdkOptions = {
  /** Override SDK readiness timeout (tests). Defaults to SDK_LOAD_TIMEOUT_MS. */
  timeoutMs?: number;
};

/**
 * Load + initialize the Facebook JS SDK exactly once per pending config key.
 * Every path resolves or rejects within timeoutMs (default 15s).
 */
export function loadFacebookSdk(
  appId: string,
  graphVersion: string,
  options: LoadFacebookSdkOptions = {}
): Promise<FbSdk> {
  if (typeof window === "undefined") {
    const err = new MetaEmbeddedSignupError(
      "sdk_load_failed",
      "Facebook SDK requires a browser"
    );
    logMetaEmbeddedSignupDebug("loadFacebookSdk.no_window");
    return Promise.reject(err);
  }

  const key = sdkConfigKey(appId, graphVersion);

  if (window.FB) {
    return Promise.resolve(initFbOnce(window.FB, appId, graphVersion));
  }

  if (sdkLoadPromise) {
    if (sdkLoadKey === key) return sdkLoadPromise;
    const err = new MetaEmbeddedSignupError(
      "sdk_config_conflict",
      "Meta SDK is already loading with a different app configuration. Please refresh and try again."
    );
    logMetaEmbeddedSignupDebug("loadFacebookSdk.sdk_config_conflict");
    return Promise.reject(err);
  }

  const timeoutMs = options.timeoutMs ?? SDK_LOAD_TIMEOUT_MS;
  sdkLoadKey = key;

  sdkLoadPromise = new Promise<FbSdk>((resolve, reject) => {
    let settled = false;

    const settleOk = (fb: FbSdk) => {
      if (settled) return;
      settled = true;
      clearSdkLoadWatchers();
      try {
        const ready = initFbOnce(fb, appId, graphVersion);
        // Drop in-flight bookkeeping only after successful init so later
        // configs are not blocked by a stale pending key.
        sdkLoadPromise = null;
        sdkLoadKey = null;
        resolve(ready);
      } catch {
        sdkLoadPromise = null;
        sdkLoadKey = null;
        const wrapped = new MetaEmbeddedSignupError(
          "sdk_load_failed",
          "Failed to load the Facebook JavaScript SDK"
        );
        logMetaEmbeddedSignupDebug("loadFacebookSdk.initFbOnce.reject");
        reject(wrapped);
      }
    };

    const settleFail = (message: string) => {
      if (settled) return;
      settled = true;
      clearSdkLoadWatchers();
      sdkLoadPromise = null;
      sdkLoadKey = null;
      const wrapped = new MetaEmbeddedSignupError("sdk_load_failed", message);
      logMetaEmbeddedSignupDebug("loadFacebookSdk.settleFail");
      reject(wrapped);
    };

    sdkLoadTimeoutHandle = setTimeout(() => {
      settleFail(SDK_LOAD_TIMEOUT_MESSAGE);
    }, timeoutMs);

    // Preserve any pre-existing fbAsyncInit; invoke it once, safely.
    sdkPreviousFbAsyncInit = window.fbAsyncInit;
    let previousInvoked = false;
    const ourHandler = () => {
      if (!previousInvoked && typeof sdkPreviousFbAsyncInit === "function") {
        previousInvoked = true;
        try {
          sdkPreviousFbAsyncInit();
        } catch {
          // Previous handler must not block loader settlement.
        }
      }
      if (settled) return;
      if (!window.FB) {
        settleFail("Failed to load the Facebook JavaScript SDK");
        return;
      }
      settleOk(window.FB);
    };
    sdkOwnedFbAsyncInit = ourHandler;
    window.fbAsyncInit = ourHandler;

    // Covers: existing script already past fbAsyncInit, or delayed FB attach.
    sdkPollHandle = setInterval(() => {
      if (window.FB) settleOk(window.FB);
    }, SDK_POLL_INTERVAL_MS);

    const existing = document.getElementById(
      "facebook-jssdk"
    ) as HTMLScriptElement | null;

    if (existing) {
      const onExistingError = () => {
        settleFail("Failed to load the Facebook JavaScript SDK");
      };
      existing.addEventListener("error", onExistingError, { once: true });
      if (window.FB) {
        settleOk(window.FB);
      }
      return;
    }

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.async = true;
    script.src = SDK_URL;
    script.onerror = () => {
      settleFail("Failed to load the Facebook JavaScript SDK");
    };
    script.onload = () => {
      if (window.FB) settleOk(window.FB);
    };
    document.body.appendChild(script);
  });

  return sdkLoadPromise;
}

export type LaunchEmbeddedSignupOptions = {
  /** Server-issued OAuth CSRF state — passed to FB.login as the official `state` param. */
  state: string;
  config?: MetaEmbeddedSignupConfig;
  timeoutMs?: number;
  /** SDK readiness timeout before FB.login (tests / overrides). */
  sdkLoadTimeoutMs?: number;
  /** Test injection */
  fb?: FbSdk;
  /** Test injection for message listener target */
  messageTarget?: Window;
};

/**
 * Launch Meta Embedded Signup once. Removes listeners on settle.
 * Prevents stale events via attempt token.
 * Binds the server-issued OAuth state into FB.login (Meta-supported `state` parameter).
 *
 * Awaits a single coordinated result promise — never an unbounded FB.login wait.
 */
export async function launchMetaEmbeddedSignup(
  options: LaunchEmbeddedSignupOptions
): Promise<MetaEmbeddedSignupResult> {
  const oauthState = String(options.state || "").trim();
  if (!oauthState) {
    const missingStateErr = new MetaEmbeddedSignupError(
      "missing_state",
      "OAuth state is required for Embedded Signup"
    );
    logMetaEmbeddedSignupDebug("launchMetaEmbeddedSignup.missing_state");
    throw missingStateErr;
  }

  const config = options.config ?? resolveMetaEmbeddedSignupConfig();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const target = options.messageTarget ?? window;
  const fb =
    options.fb ??
    (await loadFacebookSdk(config.appId, config.graphVersion, {
      timeoutMs: options.sdkLoadTimeoutMs,
    }));

  const attemptId = Symbol("embedded-signup-attempt");
  let activeAttempt: symbol | null = attemptId;
  let settled = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const startedAtMs = Date.now();

  let code: string | null = null;
  let wabaId: string | null = null;
  let phoneNumberId: string | null = null;
  let loginCallbackReceived = false;
  let finishEventReceived = false;
  let messageCount = 0;
  let recognizedEmbeddedSignupMessageCount = 0;
  let resolveResult!: (value: MetaEmbeddedSignupResult) => void;
  let rejectResult!: (err: Error) => void;

  const resultPromise = new Promise<MetaEmbeddedSignupResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const cleanup = () => {
    activeAttempt = null;
    target.removeEventListener("message", onMessage as EventListener);
    if (timeoutHandle != null) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  };

  const counterpartState = () => ({
    hasAuthorizationCode: Boolean(code),
    hasFinishEvent: Boolean(finishEventReceived && wabaId && phoneNumberId),
  });

  const settleOk = () => {
    if (settled || activeAttempt !== attemptId) return;
    if (!code || !wabaId || !phoneNumberId) {
      // TEMPORARY TRACE — still waiting for the other settlement half.
      logMetaEmbeddedSignupTrace({
        phase: "terminal.waiting_for_counterpart",
        ...counterpartState(),
      });
      return;
    }
    logMetaEmbeddedSignupTrace({
      phase: "terminal.finish",
      ...counterpartState(),
    });
    settled = true;
    cleanup();
    resolveResult({
      code,
      state: oauthState,
      wabaId,
      phoneNumberId,
    });
  };

  const settleErr = (err: MetaEmbeddedSignupError) => {
    if (settled || activeAttempt !== attemptId) return;
    settled = true;
    cleanup();
    // TEMPORARY DEBUG — fresh sanitized allowlisted object only.
    logMetaEmbeddedSignupDebug(
      "launchMetaEmbeddedSignup.settleErr",
      err.providerError
    );
    rejectResult(err);
  };

  const onMessage = (event: MessageEvent) => {
    if (activeAttempt !== attemptId || settled) return;

    messageCount += 1;
    const meta = readMessageTypeAndEvent(event.data);
    const parsed = parseEmbeddedSignupMessageData(event.data);
    const parsedOk = parsed != null;
    const originClass = classifySafeOriginClass(event.origin);
    const safeType = classifySafeMessageType(meta.type);
    const safeEvent = classifySafeEmbeddedSignupEvent(meta.event);

    // TEMPORARY TRACE — fixed classifications only; never runtime strings/values.
    logMetaEmbeddedSignupTrace({
      phase: "window.message.received",
      originClass,
      dataType: describeDataType(event.data),
      parsed: parsedOk,
      type: safeType,
      event: safeEvent,
      dataKeys: allowlistedDataKeysFromPayload(event.data),
    });

    const ignored = classifyIgnoredEmbeddedSignupMessage(
      event.origin,
      event.data
    );
    if (ignored) {
      logMetaEmbeddedSignupTrace({
        phase: "window.message.ignored",
        reason: ignored.reason,
        originClass: ignored.originClass,
        type: ignored.type,
        event: ignored.event,
      });
      // Keep fail-closed settlement for malformed/unsupported WA events.
      if (
        ignored.reason !== "malformed_event" &&
        ignored.reason !== "unsupported_event"
      ) {
        return;
      }
    }

    if (!isAllowedMetaMessageOrigin(event.origin)) {
      return;
    }

    if (parsed == null) {
      // Non-WA traffic from Meta origins is ignored.
      return;
    }

    recognizedEmbeddedSignupMessageCount += 1;

    if (parsed.status === "cancelled") {
      logMetaEmbeddedSignupTrace({
        phase: "terminal.cancel",
        ...counterpartState(),
      });
      settleErr(
        new MetaEmbeddedSignupError(
          "cancelled",
          "Embedded Signup was cancelled or failed"
        )
      );
      return;
    }

    if (parsed.status === "error") {
      logMetaEmbeddedSignupTrace({
        phase: "terminal.error",
        ...counterpartState(),
      });
      settleErr(
        new MetaEmbeddedSignupError(
          "login_error",
          "Embedded Signup reported an error from Meta",
          parsed.providerError
        )
      );
      return;
    }

    if (parsed.status === "missing_phone") {
      finishEventReceived = true;
      logMetaEmbeddedSignupTrace({
        phase: "terminal.finish_only_waba",
        hasAuthorizationCode: Boolean(code),
        hasFinishEvent: false,
      });
      settleErr(
        new MetaEmbeddedSignupError(
          "missing_phone_number_id",
          "Embedded Signup completed without a phone number ID (FINISH_ONLY_WABA)"
        )
      );
      return;
    }

    if (parsed.status === "malformed") {
      settleErr(
        new MetaEmbeddedSignupError(
          "malformed_payload",
          "Embedded Signup returned an invalid asset payload"
        )
      );
      return;
    }

    wabaId = parsed.wabaId;
    phoneNumberId = parsed.phoneNumberId;
    finishEventReceived = true;
    settleOk();
  };

  target.addEventListener("message", onMessage as EventListener);

  timeoutHandle = setTimeout(() => {
    if (settled || activeAttempt !== attemptId) return;
    // TEMPORARY TRACE — which settlement half was missing at timeout.
    logMetaEmbeddedSignupTrace({
      phase: "terminal.timeout",
      elapsedMs: Date.now() - startedAtMs,
      loginCallbackReceived,
      hasAuthorizationCode: Boolean(code),
      finishEventReceived: Boolean(finishEventReceived && wabaId && phoneNumberId),
      messageCount,
      recognizedEmbeddedSignupMessageCount,
    });
    settleErr(
      new MetaEmbeddedSignupError(
        "timeout",
        "Embedded Signup timed out waiting for Meta"
      )
    );
  }, timeoutMs);

  // Fire-and-forget: do not await a login-only Promise the timeout cannot unblock.
  try {
    fb.login(
      (response) => {
        if (activeAttempt !== attemptId || settled) return;
        loginCallbackReceived = true;
        const authCode = response.authResponse?.code
          ? String(response.authResponse.code).trim()
          : "";
        // TEMPORARY TRACE — booleans + fixed status enum only; never code/token/userID.
        const safeStatus = classifySafeFbLoginStatus(response.status);
        logMetaEmbeddedSignupTrace({
          phase: "fb.login.callback",
          callbackReceived: true,
          hasAuthResponse: Boolean(response.authResponse),
          hasAuthorizationCode: Boolean(authCode),
          ...(safeStatus ? { status: safeStatus } : {}),
        });
        if (!authCode) {
          const cancelled =
            !response.authResponse ||
            response.status === "unknown" ||
            response.status === "not_authorized";
          const providerError = extractEmbeddedSignupProviderError(response);
          settleErr(
            new MetaEmbeddedSignupError(
              cancelled ? "cancelled" : "missing_code",
              cancelled
                ? "Embedded Signup was cancelled"
                : "Meta did not return an authorization code",
              providerError
            )
          );
          return;
        }
        code = authCode;
        settleOk();
      },
      {
        config_id: config.configId,
        response_type: "code",
        override_default_response_type: true,
        // Official Facebook Login / OAuth CSRF parameter — binds server-issued state.
        state: oauthState,
        extras: {
          setup: {},
          // WhatsApp Business App Coexistence onboarding (not the deprecated "coexistence" value).
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      }
    );
  } catch (caught) {
    const providerError = extractEmbeddedSignupProviderError(caught);
    logMetaEmbeddedSignupDebug(
      "launchMetaEmbeddedSignup.fb.login.catch",
      providerError
    );
    settleErr(
      new MetaEmbeddedSignupError(
        "login_error",
        "Facebook Login failed to start Embedded Signup",
        providerError
      )
    );
  }

  return resultPromise;
}

/** Sanitize errors for UI — never include tokens/codes. */
export function sanitizeEmbeddedSignupError(err: unknown): string {
  if (err instanceof MetaEmbeddedSignupError) return err.message;
  if (err instanceof Error && err.message) {
    return err.message.replace(/EAA[A-Za-z0-9]+/g, "[redacted]");
  }
  return "Embedded Signup failed";
}
