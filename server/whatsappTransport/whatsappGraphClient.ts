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

export function sanitizeProviderError(raw: unknown, redactSecrets: string[] = []): string {
  const redact = (s: string): string => {
    let out = s;
    for (const secret of redactSecrets) {
      if (secret && secret.length >= 8) out = out.split(secret).join("[redacted]");
    }
    return out;
  };
  if (raw == null) return "Provider error";
  if (typeof raw === "string") {
    return redact(
      raw
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    ).slice(0, 300);
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
    return sanitizeProviderError(`${prefix}${message}`, redactSecrets);
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
      sanitizedError: sanitizeProviderError(parsed ?? text, [input.accessToken]),
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
      sanitizedError: sanitizeProviderError(message, [input.accessToken]),
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

/** Build Graph media-upload URL only from validated components. */
export function buildWhatsAppMediaUrl(
  graphApiVersion: string,
  phoneNumberId: string
): string | null {
  if (!isValidGraphApiVersion(graphApiVersion)) return null;
  if (!isValidPhoneNumberId(phoneNumberId)) return null;
  return `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/media`;
}

export type GraphUploadMediaInput = {
  phoneNumberId: string;
  accessToken: string;
  graphApiVersion: string;
  /** Raw PDF bytes — validated for %PDF- magic and size before upload. */
  pdfBytes: Uint8Array;
  filename: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type GraphUploadMediaResult =
  | { ok: true; mediaId: string; httpStatus: number }
  | {
      ok: false;
      kind: "provider_error" | "timeout" | "network" | "invalid_response" | "invalid_config";
      httpStatus: number | null;
      sanitizedError: string;
    };

/** Meta PDF constraints: 100 MB max. The CRM library caps at 10 MB; re-check here. */
export const WHATSAPP_MAX_PDF_BYTES = 10 * 1024 * 1024;

export function validatePdfBytes(pdfBytes: Uint8Array): string | null {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.length < 8) return "Empty file";
  if (pdfBytes.length > WHATSAPP_MAX_PDF_BYTES) return "PDF exceeds 10 MB";
  if (Buffer.from(pdfBytes.subarray(0, 5)).toString("utf8") !== "%PDF-")
    return "Not a PDF file";
  return null;
}

/**
 * Upload a PDF to the WhatsApp Cloud API media endpoint.
 * Returns the media id for use in a type:document message.
 * Never retries internally — the caller owns idempotency.
 */
export async function uploadWhatsAppMedia(
  input: GraphUploadMediaInput
): Promise<GraphUploadMediaResult> {
  const url = buildWhatsAppMediaUrl(input.graphApiVersion, input.phoneNumberId);
  if (!url) {
    return {
      ok: false,
      kind: "invalid_config",
      httpStatus: null,
      sanitizedError: "Invalid Graph API version or phone number id",
    };
  }
  const pdfError = validatePdfBytes(input.pdfBytes);
  if (pdfError) {
    return {
      ok: false,
      kind: "invalid_config",
      httpStatus: null,
      sanitizedError: pdfError,
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? WHATSAPP_GRAPH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append(
      "file",
      new Blob([input.pdfBytes as BlobPart], { type: "application/pdf" }),
      input.filename
    );
    form.append("type", "application/pdf");

    const response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}` },
      body: form,
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
      const mediaId = (parsed as { id?: unknown } | null)?.id;
      if (typeof mediaId !== "string" || !mediaId) {
        return {
          ok: false,
          kind: "invalid_response",
          httpStatus: response.status,
          sanitizedError: "Media upload returned no id",
        };
      }
      return { ok: true, mediaId, httpStatus: response.status };
    }

    return {
      ok: false,
      kind: "provider_error",
      httpStatus: response.status,
      sanitizedError: sanitizeProviderError(parsed ?? text, [input.accessToken]),
    };
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : "";
    const message = err instanceof Error ? err.message : "network error";
    if (name === "AbortError" || /aborted|timeout/i.test(message)) {
      return {
        ok: false,
        kind: "timeout",
        httpStatus: null,
        sanitizedError: "Media upload timed out",
      };
    }
    return {
      ok: false,
      kind: "network",
      httpStatus: null,
      sanitizedError: sanitizeProviderError(message, [input.accessToken]),
    };
  } finally {
    clearTimeout(timer);
  }
}

export type GraphSendDocumentInput = {
  toWaId: string;
  /** Media id from uploadWhatsAppMedia. */
  mediaId: string;
  filename: string;
  /** Optional caption (Meta limit 1024 chars). */
  caption?: string;
  phoneNumberId: string;
  accessToken: string;
  graphApiVersion: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * Send a native WhatsApp document message referencing an uploaded media id.
 * Same result contract as sendWhatsAppTextMessage.
 */
export async function sendWhatsAppDocumentMessage(
  input: GraphSendDocumentInput
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
  if (!input.mediaId || !/^\d+$/.test(input.mediaId)) {
    return {
      ok: false,
      kind: "invalid_config",
      httpStatus: null,
      sanitizedError: "Invalid media id",
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
        type: "document",
        document: {
          id: input.mediaId,
          filename: input.filename,
          caption: (input.caption || "").slice(0, 1024),
        },
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
      sanitizedError: sanitizeProviderError(parsed ?? text, [input.accessToken]),
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
      sanitizedError: sanitizeProviderError(message, [input.accessToken]),
    };
  } finally {
    clearTimeout(timer);
  }
}
