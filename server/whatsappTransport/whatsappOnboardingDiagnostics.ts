/**
 * WhatsApp production onboarding diagnostics (RC-1.2.4 Meta readiness).
 * Admin-only. Never logs tokens, secrets, or encryption keys.
 */

import {
  hasSignatureConfig,
  hasWebhookVerifyConfig,
  readWhatsAppConfig,
} from "./whatsappConfig.ts";
import {
  getWhatsAppConnectionStatus,
  testWhatsAppConnection,
  type WhatsAppConnectionStatusPayload,
  type WhatsAppConnectionTestResult,
} from "./whatsappConnectionService.ts";
import { WHATSAPP_WEBHOOK_PATH } from "./whatsappConstants.ts";
import { resolveWhatsAppTokenEncryptionKey, WhatsAppTokenCryptoError } from "./whatsappTokenCrypto.ts";

export type ChecklistItemId =
  | "meta_app_configured"
  | "meta_config_id"
  | "webhook_url"
  | "verify_token_configured"
  | "app_secret_configured"
  | "callback_reachable"
  | "encryption_key_present"
  | "connected_waba"
  | "connected_phone"
  | "webhook_verified";

export type ChecklistItem = {
  id: ChecklistItemId;
  label: string;
  ok: boolean;
  detail: string | null;
};

export type WhatsAppOnboardingDiagnostics = {
  checklist: ChecklistItem[];
  connection: WhatsAppConnectionStatusPayload;
  webhookCallbackUrl: string;
  /** Present for Meta Developer Console copy — Admin-only endpoint. */
  webhookVerifyToken: string | null;
  webhookVerifyTokenConfigured: boolean;
  publicBaseUrlConfigured: boolean;
  graphApi: {
    version: string;
    connectivityOk: boolean;
    detail: string | null;
  };
  environment: {
    metaAppIdConfigured: boolean;
    metaConfigIdConfigured: boolean;
    appSecretConfigured: boolean;
    encryptionKeyConfigured: boolean;
    conversationsEnabled: boolean;
  };
};

function envPresent(...keys: string[]): boolean {
  return keys.some((k) => String(process.env[k] || "").trim().length > 0);
}

function resolvePublicBaseUrl(requestBaseUrl?: string): string | null {
  const candidates = [
    process.env.PUBLIC_BASE_URL,
    process.env.APP_PUBLIC_URL,
    process.env.RENDER_EXTERNAL_URL,
    requestBaseUrl,
  ];
  for (const raw of candidates) {
    const v = String(raw || "").trim().replace(/\/$/, "");
    if (v) return v;
  }
  return null;
}

export function buildWebhookCallbackUrl(requestBaseUrl?: string): {
  url: string;
  publicBaseUrlConfigured: boolean;
} {
  const base = resolvePublicBaseUrl(requestBaseUrl);
  if (!base) {
    return {
      url: `(set PUBLIC_BASE_URL)${WHATSAPP_WEBHOOK_PATH}`,
      publicBaseUrlConfigured: false,
    };
  }
  return {
    url: `${base}${WHATSAPP_WEBHOOK_PATH}`,
    publicBaseUrlConfigured: true,
  };
}

async function probeCallbackReachable(
  webhookUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; detail: string }> {
  if (webhookUrl.startsWith("(set ")) {
    return {
      ok: false,
      detail: "PUBLIC_BASE_URL (or APP_PUBLIC_URL) is required to probe the callback",
    };
  }
  try {
    const u = new URL(webhookUrl);
    u.searchParams.set("hub.mode", "subscribe");
    u.searchParams.set("hub.verify_token", "__diagnostics_probe__");
    u.searchParams.set("hub.challenge", "diagnostics");
    const res = await fetchImpl(u.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(4_000),
    });
    // Route mounted: wrong token → 403; misconfigured secret → 503; success → 200
    if (res.status === 403 || res.status === 503 || res.status === 200) {
      return { ok: true, detail: `Callback responded HTTP ${res.status}` };
    }
    if (res.status === 404) {
      return { ok: false, detail: "Callback returned 404 — webhook route not found" };
    }
    return { ok: false, detail: `Unexpected callback HTTP ${res.status}` };
  } catch {
    return {
      ok: false,
      detail: "Callback probe failed (network or host unreachable)",
    };
  }
}

async function probeGraphConnectivity(
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; version: string; detail: string | null }> {
  const config = readWhatsAppConfig();
  const version = config.graphApiVersion || "v21.0";
  try {
    const res = await fetchImpl(
      `https://graph.facebook.com/${version}/`,
      { method: "GET", signal: AbortSignal.timeout(5_000) }
    );
    // Graph root often returns 400 without token — still proves connectivity.
    if (res.status >= 200 && res.status < 500) {
      return { ok: true, version, detail: `Graph API reachable (HTTP ${res.status})` };
    }
    return {
      ok: false,
      version,
      detail: `Graph API unexpected HTTP ${res.status}`,
    };
  } catch {
    return { ok: false, version, detail: "Graph API network error" };
  }
}

function encryptionKeyConfigured(): boolean {
  try {
    resolveWhatsAppTokenEncryptionKey();
    return true;
  } catch (err) {
    if (err instanceof WhatsAppTokenCryptoError) return false;
    return false;
  }
}

export type DiagnosticsDeps = {
  fetchImpl?: typeof fetch;
  requestBaseUrl?: string;
  companyId?: string;
};

export async function getWhatsAppOnboardingDiagnostics(
  deps: DiagnosticsDeps = {}
): Promise<WhatsAppOnboardingDiagnostics> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const config = readWhatsAppConfig();
  const connection = await getWhatsAppConnectionStatus(deps.companyId);
  const { url: webhookCallbackUrl, publicBaseUrlConfigured } =
    buildWebhookCallbackUrl(deps.requestBaseUrl);

  const metaAppIdConfigured = envPresent(
    "WHATSAPP_APP_ID",
    "VITE_META_APP_ID"
  );
  const metaConfigIdConfigured = envPresent(
    "WHATSAPP_META_CONFIG_ID",
    "VITE_META_CONFIG_ID"
  );
  const verifyTokenConfigured = hasWebhookVerifyConfig(config);
  const appSecretConfigured = hasSignatureConfig(config);
  const encOk = encryptionKeyConfigured();

  const callbackProbe = await probeCallbackReachable(webhookCallbackUrl, fetchImpl);
  const graph = await probeGraphConnectivity(fetchImpl);

  const hasWaba = Boolean(connection.wabaIdMasked);
  const hasPhone = Boolean(
    connection.phoneNumberIdMasked || connection.phoneNumberMasked
  );
  const webhookVerified = Boolean(connection.lastWebhookAt);

  const checklist: ChecklistItem[] = [
    {
      id: "meta_app_configured",
      label: "Meta App configured",
      ok: metaAppIdConfigured,
      detail: metaAppIdConfigured
        ? "WHATSAPP_APP_ID / VITE_META_APP_ID present"
        : "Set WHATSAPP_APP_ID and VITE_META_APP_ID",
    },
    {
      id: "meta_config_id",
      label: "Meta Config ID",
      ok: metaConfigIdConfigured,
      detail: metaConfigIdConfigured
        ? "Embedded Signup config ID present"
        : "Set VITE_META_CONFIG_ID (and optionally WHATSAPP_META_CONFIG_ID)",
    },
    {
      id: "webhook_url",
      label: "Webhook URL",
      ok: publicBaseUrlConfigured,
      detail: webhookCallbackUrl,
    },
    {
      id: "verify_token_configured",
      label: "Verify Token configured",
      ok: verifyTokenConfigured,
      detail: verifyTokenConfigured
        ? "WHATSAPP_WEBHOOK_VERIFY_TOKEN is set"
        : "Set WHATSAPP_WEBHOOK_VERIFY_TOKEN",
    },
    {
      id: "app_secret_configured",
      label: "App Secret configured",
      ok: appSecretConfigured,
      detail: appSecretConfigured
        ? "WHATSAPP_APP_SECRET is set"
        : "Set WHATSAPP_APP_SECRET",
    },
    {
      id: "callback_reachable",
      label: "Callback reachable",
      ok: callbackProbe.ok,
      detail: callbackProbe.detail,
    },
    {
      id: "encryption_key_present",
      label: "Encryption key present",
      ok: encOk,
      detail: encOk
        ? "WHATSAPP_TOKEN_ENCRYPTION_KEY is valid (32 bytes)"
        : "Set WHATSAPP_TOKEN_ENCRYPTION_KEY (32-byte hex or base64)",
    },
    {
      id: "connected_waba",
      label: "Connected WABA",
      ok: hasWaba && (connection.status === "CONNECTED" || connection.status === "WEBHOOK_PENDING"),
      detail: hasWaba
        ? `WABA ${connection.wabaIdMasked}`
        : "No WhatsApp Business Account connected",
    },
    {
      id: "connected_phone",
      label: "Connected phone number",
      ok: hasPhone && (connection.status === "CONNECTED" || connection.status === "WEBHOOK_PENDING"),
      detail: hasPhone
        ? [
            connection.phoneNumberMasked,
            connection.phoneNumberIdMasked
              ? `id ${connection.phoneNumberIdMasked}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : "No phone number connected",
    },
    {
      id: "webhook_verified",
      label: "Webhook verified",
      ok: webhookVerified,
      detail: webhookVerified
        ? `Last webhook at ${connection.lastWebhookAt}`
        : "No inbound webhook received yet",
    },
  ];

  return {
    checklist,
    connection,
    webhookCallbackUrl,
    webhookVerifyToken: verifyTokenConfigured ? config.webhookVerifyToken : null,
    webhookVerifyTokenConfigured: verifyTokenConfigured,
    publicBaseUrlConfigured,
    graphApi: {
      version: graph.version,
      connectivityOk: graph.ok,
      detail: graph.detail,
    },
    environment: {
      metaAppIdConfigured,
      metaConfigIdConfigured,
      appSecretConfigured,
      encryptionKeyConfigured: encOk,
      conversationsEnabled: config.enabled,
    },
  };
}

export type { WhatsAppConnectionTestResult };

export async function runWhatsAppConnectionTest(
  companyId?: string,
  fetchImpl?: typeof fetch
): Promise<WhatsAppConnectionTestResult> {
  return testWhatsAppConnection(companyId, { fetchImpl });
}
