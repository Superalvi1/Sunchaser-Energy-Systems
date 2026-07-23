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

export class MetaEmbeddedSignupError extends Error {
  readonly code: MetaEmbeddedSignupErrorCode;

  constructor(code: MetaEmbeddedSignupErrorCode, message: string) {
    super(message);
    this.name = "MetaEmbeddedSignupError";
    this.code = code;
  }
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
  | { status: "error"; event: string }
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
    return { status: "error", event: event || "ERROR" };
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
    return Promise.reject(
      new MetaEmbeddedSignupError(
        "sdk_load_failed",
        "Facebook SDK requires a browser"
      )
    );
  }

  const key = sdkConfigKey(appId, graphVersion);

  if (window.FB) {
    return Promise.resolve(initFbOnce(window.FB, appId, graphVersion));
  }

  if (sdkLoadPromise) {
    if (sdkLoadKey === key) return sdkLoadPromise;
    return Promise.reject(
      new MetaEmbeddedSignupError(
        "sdk_config_conflict",
        "Meta SDK is already loading with a different app configuration. Please refresh and try again."
      )
    );
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
        reject(
          new MetaEmbeddedSignupError(
            "sdk_load_failed",
            "Failed to load the Facebook JavaScript SDK"
          )
        );
      }
    };

    const settleFail = (message: string) => {
      if (settled) return;
      settled = true;
      clearSdkLoadWatchers();
      sdkLoadPromise = null;
      sdkLoadKey = null;
      reject(new MetaEmbeddedSignupError("sdk_load_failed", message));
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
    throw new MetaEmbeddedSignupError(
      "missing_state",
      "OAuth state is required for Embedded Signup"
    );
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

  let code: string | null = null;
  let wabaId: string | null = null;
  let phoneNumberId: string | null = null;
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

  const settleOk = () => {
    if (settled || activeAttempt !== attemptId) return;
    if (!code || !wabaId || !phoneNumberId) return;
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
    rejectResult(err);
  };

  const onMessage = (event: MessageEvent) => {
    if (activeAttempt !== attemptId || settled) return;
    if (!isAllowedMetaMessageOrigin(event.origin)) {
      return;
    }

    const parsed = parseEmbeddedSignupMessageData(event.data);
    if (parsed == null) {
      // Non-WA traffic from Meta origins is ignored.
      return;
    }

    if (parsed.status === "cancelled") {
      settleErr(
        new MetaEmbeddedSignupError(
          "cancelled",
          "Embedded Signup was cancelled or failed"
        )
      );
      return;
    }

    if (parsed.status === "error") {
      settleErr(
        new MetaEmbeddedSignupError(
          "login_error",
          "Embedded Signup reported an error from Meta"
        )
      );
      return;
    }

    if (parsed.status === "missing_phone") {
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
    settleOk();
  };

  target.addEventListener("message", onMessage as EventListener);

  timeoutHandle = setTimeout(() => {
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
        const authCode = response.authResponse?.code
          ? String(response.authResponse.code).trim()
          : "";
        if (!authCode) {
          const cancelled =
            !response.authResponse ||
            response.status === "unknown" ||
            response.status === "not_authorized";
          settleErr(
            new MetaEmbeddedSignupError(
              cancelled ? "cancelled" : "missing_code",
              cancelled
                ? "Embedded Signup was cancelled"
                : "Meta did not return an authorization code"
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
  } catch {
    settleErr(
      new MetaEmbeddedSignupError(
        "login_error",
        "Facebook Login failed to start Embedded Signup"
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
