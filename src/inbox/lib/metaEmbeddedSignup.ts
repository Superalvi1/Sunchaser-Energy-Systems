/**
 * Official Meta Embedded Signup (Facebook JS SDK) — no fabricated IDs/codes.
 *
 * Captures WABA / Phone Number IDs only from documented WA_EMBEDDED_SIGNUP
 * postMessage events, and the authorization code from FB.login (code mode).
 */

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";

const ALLOWED_MESSAGE_ORIGINS = new Set([
  "https://www.facebook.com",
  "https://facebook.com",
  "https://web.facebook.com",
  "https://www.facebook.com/",
  "https://business.facebook.com",
]);

function readViteEnv(): Record<string, string | undefined> {
  const meta = import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  };
  return meta.env ?? {};
}

export type MetaEmbeddedSignupConfig = {
  appId: string;
  configId: string;
  graphVersion: string;
};

export type MetaEmbeddedSignupResult = {
  code: string;
  wabaId: string;
  phoneNumberId: string;
};

export type MetaEmbeddedSignupErrorCode =
  | "missing_config"
  | "missing_state"
  | "sdk_load_failed"
  | "cancelled"
  | "timeout"
  | "invalid_origin"
  | "malformed_payload"
  | "missing_code"
  | "missing_assets"
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

export function parseEmbeddedSignupMessageData(
  raw: unknown
): { wabaId: string; phoneNumberId: string; event: string } | null {
  let payload: unknown = raw;
  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  if (obj.type !== "WA_EMBEDDED_SIGNUP") return null;
  const event = typeof obj.event === "string" ? obj.event : "";
  const data =
    obj.data && typeof obj.data === "object"
      ? (obj.data as Record<string, unknown>)
      : null;
  if (!data) return null;
  const wabaId = data.waba_id != null ? String(data.waba_id).trim() : "";
  const phoneNumberId =
    data.phone_number_id != null ? String(data.phone_number_id).trim() : "";
  if (!wabaId || !phoneNumberId) return null;
  return { wabaId, phoneNumberId, event };
}

let sdkLoadPromise: Promise<FbSdk> | null = null;

export function resetMetaSdkLoaderForTests(): void {
  sdkLoadPromise = null;
}

function loadFacebookSdk(appId: string, graphVersion: string): Promise<FbSdk> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new MetaEmbeddedSignupError("sdk_load_failed", "Facebook SDK requires a browser")
    );
  }
  if (window.FB) {
    window.FB.init({ appId, cookie: true, xfbml: false, version: graphVersion });
    return Promise.resolve(window.FB);
  }
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise<FbSdk>((resolve, reject) => {
    const fail = () => {
      sdkLoadPromise = null;
      reject(
        new MetaEmbeddedSignupError(
          "sdk_load_failed",
          "Failed to load the Facebook JavaScript SDK"
        )
      );
    };

    window.fbAsyncInit = () => {
      try {
        if (!window.FB) {
          fail();
          return;
        }
        window.FB.init({
          appId,
          cookie: true,
          xfbml: false,
          version: graphVersion,
        });
        resolve(window.FB);
      } catch {
        fail();
      }
    };

    const existing = document.getElementById("facebook-jssdk");
    if (existing) return;

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.async = true;
    script.src = SDK_URL;
    script.onerror = () => fail();
    document.body.appendChild(script);
  });

  return sdkLoadPromise;
}

export type LaunchEmbeddedSignupOptions = {
  /** Server-issued OAuth CSRF state — passed to FB.login as the official `state` param. */
  state: string;
  config?: MetaEmbeddedSignupConfig;
  timeoutMs?: number;
  /** Test injection */
  fb?: FbSdk;
  /** Test injection for message listener target */
  messageTarget?: Window;
};

/**
 * Launch Meta Embedded Signup once. Removes listeners on settle.
 * Prevents stale events via attempt token.
 * Binds the server-issued OAuth state into FB.login (Meta-supported `state` parameter).
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
  const fb = options.fb ?? (await loadFacebookSdk(config.appId, config.graphVersion));

  const attemptId = Symbol("embedded-signup-attempt");
  let activeAttempt: symbol | null = attemptId;
  let settled = false;

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
    if (timeoutHandle != null) clearTimeout(timeoutHandle);
  };

  const finishOk = () => {
    if (settled || activeAttempt !== attemptId) return;
    if (!code || !wabaId || !phoneNumberId) return;
    settled = true;
    cleanup();
    resolveResult({ code, wabaId, phoneNumberId });
  };

  const finishErr = (err: MetaEmbeddedSignupError) => {
    if (settled || activeAttempt !== attemptId) return;
    settled = true;
    cleanup();
    rejectResult(err);
  };

  const onMessage = (event: MessageEvent) => {
    if (activeAttempt !== attemptId || settled) return;
    if (!isAllowedMetaMessageOrigin(event.origin)) {
      // Ignore unrelated origins; only fail closed on Meta-looking malformed payloads.
      return;
    }
    const parsed = parseEmbeddedSignupMessageData(event.data);
    if (!parsed) {
      // Valid Meta origin but unexpected shape — ignore non-WA events; fail if clearly WA-typed malformed.
      if (
        typeof event.data === "string" &&
        event.data.includes("WA_EMBEDDED_SIGNUP")
      ) {
        finishErr(
          new MetaEmbeddedSignupError(
            "malformed_payload",
            "Embedded Signup returned an invalid asset payload"
          )
        );
      } else if (
        event.data &&
        typeof event.data === "object" &&
        (event.data as { type?: string }).type === "WA_EMBEDDED_SIGNUP"
      ) {
        finishErr(
          new MetaEmbeddedSignupError(
            "malformed_payload",
            "Embedded Signup returned an invalid asset payload"
          )
        );
      }
      return;
    }
    if (/CANCEL|ERROR/i.test(parsed.event)) {
      finishErr(
        new MetaEmbeddedSignupError(
          "cancelled",
          "Embedded Signup was cancelled or failed"
        )
      );
      return;
    }
    wabaId = parsed.wabaId;
    phoneNumberId = parsed.phoneNumberId;
    finishOk();
  };

  target.addEventListener("message", onMessage as EventListener);

  const timeoutHandle = setTimeout(() => {
    finishErr(
      new MetaEmbeddedSignupError(
        "timeout",
        "Embedded Signup timed out waiting for Meta"
      )
    );
  }, timeoutMs);

  await new Promise<void>((resolveLogin) => {
    fb.login(
      (response) => {
        if (activeAttempt !== attemptId || settled) {
          resolveLogin();
          return;
        }
        const authCode = response.authResponse?.code
          ? String(response.authResponse.code).trim()
          : "";
        if (!authCode) {
          const cancelled =
            !response.authResponse ||
            response.status === "unknown" ||
            response.status === "not_authorized";
          finishErr(
            new MetaEmbeddedSignupError(
              cancelled ? "cancelled" : "missing_code",
              cancelled
                ? "Embedded Signup was cancelled"
                : "Meta did not return an authorization code"
            )
          );
          resolveLogin();
          return;
        }
        code = authCode;
        finishOk();
        resolveLogin();
      },
      {
        config_id: config.configId,
        response_type: "code",
        override_default_response_type: true,
        // Official Facebook Login / OAuth CSRF parameter — binds server-issued state.
        state: oauthState,
        extras: {
          setup: {},
          sessionInfoVersion: "3",
        },
      }
    );
  });

  try {
    return await resultPromise;
  } finally {
    // If promise already settled, cleanup is done; otherwise ensure listeners gone.
    if (!settled) cleanup();
  }
}

/** Sanitize errors for UI — never include tokens/codes. */
export function sanitizeEmbeddedSignupError(err: unknown): string {
  if (err instanceof MetaEmbeddedSignupError) return err.message;
  if (err instanceof Error && err.message) {
    return err.message.replace(/EAA[A-Za-z0-9]+/g, "[redacted]");
  }
  return "Embedded Signup failed";
}
