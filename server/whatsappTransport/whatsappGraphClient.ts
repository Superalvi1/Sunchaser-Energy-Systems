import { WHATSAPP_GRAPH_TIMEOUT_MS } from "./whatsappConstants.ts";
import {
  isValidGraphApiVersion,
  isValidPhoneNumberId,
  type WhatsAppConfig,
} from "./whatsappConfig.ts";
import type { MetaSendTextErrorBody, MetaSendTextSuccess } from "./whatsappProviderTypes.ts";

export type GraphSendTextInput = {
  toWaId: string;
  text: string;
  phoneNumberId: string;
  accessToken: string;
  graphApiVersion: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type GraphSendResult =
  | {
      ok: true;
      providerMessageId: string;
      httpStatus: number;
    }
  | {
      ok: false;
      kind: "provider_error" | "timeout" | "network" | "invalid_response" | "invalid_config";
      httpStatus: number | null;
      sanitizedError: string;
    };

export function sanitizeProviderError(raw: unknown): string {
  if (raw == null) return "Provider error";
  if (typeof raw === "string") {
    return raw
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
      .slice(0, 300);
  }
  if (typeof raw === "object") {
    const body = raw as MetaSendTextErrorBody;
    const message =
      body.error?.message ||
      body.error?.type ||
      (raw as { message?: string }).message ||
      "Provider error";
    const code = body.error?.code;
    const prefix = code != null ? `[${code}] ` : "";
    return sanitizeProviderError(`${prefix}${message}`);
  }
  return "Provider error";
}

/** Build Graph messages URL only from validated components. */
export function buildWhatsAppMessagesUrl(
  graphApiVersion: string,
  phoneNumberId: string
): string | null {
  if (!isValidGraphApiVersion(graphApiVersion)) return null;
  if (!isValidPhoneNumberId(phoneNumberId)) return null;
  return `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`;
}

export async function sendWhatsAppTextMessage(
  input: GraphSendTextInput
): Promise<GraphSendResult> {
  const url = buildWhatsAppMessagesUrl(input.graphApiVersion, input.phoneNumberId);
  if (!url) {
    return {
      ok: false,
      kind: "invalid_config",
      httpStatus: null,
      sanitizedError: "Invalid Graph API version or phone number id",
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? WHATSAPP_GRAPH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.toWaId,
        type: "text",
        text: { preview_url: false, body: input.text },
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (response.status >= 200 && response.status < 300) {
      const success = parsed as MetaSendTextSuccess | null;
      const providerMessageId = success?.messages?.[0]?.id;
      if (!providerMessageId) {
        return {
          ok: false,
          kind: "invalid_response",
          httpStatus: response.status,
          sanitizedError: "Provider accepted request but returned no message id",
        };
      }
      return {
        ok: true,
        providerMessageId: String(providerMessageId),
        httpStatus: response.status,
      };
    }

    return {
      ok: false,
      kind: "provider_error",
      httpStatus: response.status,
      sanitizedError: sanitizeProviderError(parsed ?? text),
    };
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : "";
    const message = err instanceof Error ? err.message : "network error";
    if (name === "AbortError" || /aborted|timeout/i.test(message)) {
      return {
        ok: false,
        kind: "timeout",
        httpStatus: null,
        sanitizedError: "Provider request timed out",
      };
    }
    return {
      ok: false,
      kind: "network",
      httpStatus: null,
      sanitizedError: sanitizeProviderError(message),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function graphConfigFromWhatsApp(config: WhatsAppConfig): {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
} {
  return {
    accessToken: config.accessToken,
    phoneNumberId: config.phoneNumberId,
    graphApiVersion: config.graphApiVersion,
  };
}
