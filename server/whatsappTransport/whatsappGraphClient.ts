import { WHATSAPP_GRAPH_TIMEOUT_MS } from "./whatsappConstants.ts";
import {
  isValidGraphApiVersion,
  isValidPhoneNumberId,
  type WhatsAppConfig,
} from "./whatsappConfig.ts";
import type { MetaSendTextErrorBody, MetaSendTextSuccess } from "./whatsappProviderTypes.ts";
import type { TemplateSendComponent } from "./whatsappTemplates.ts";

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

export type GraphSendTemplateInput = Omit<GraphSendTextInput, "text"> & {
  templateName: string;
  languageCode: string;
  components: TemplateSendComponent[];
};

export async function sendWhatsAppTextMessage(
  input: GraphSendTextInput
): Promise<GraphSendResult> {
  return postWhatsAppMessage(input, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.toWaId,
    type: "text",
    text: { preview_url: false, body: input.text },
  });
}

/** Send an APPROVED template. Components come from buildTemplateSendComponents. */
export async function sendWhatsAppTemplateMessage(
  input: GraphSendTemplateInput
): Promise<GraphSendResult> {
  return postWhatsAppMessage(input, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.toWaId,
    type: "template",
    template: {
      name: input.templateName,
      language: { code: input.languageCode },
      ...(input.components.length > 0 ? { components: input.components } : {}),
    },
  });
}

async function postWhatsAppMessage(
  input: Omit<GraphSendTextInput, "text" | "toWaId">,
  payload: Record<string, unknown>
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
      body: JSON.stringify(payload),
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

/** Meta WhatsApp Business Account ids are digits-only. */
export const WABA_ID_PATTERN = /^\d{5,40}$/;
const TEMPLATE_FIELDS =
  "id,name,language,status,category,parameter_format,components";
export const TEMPLATE_LIST_MAX_PAGES = 10;

export type GraphListTemplatesResult =
  | { ok: true; records: unknown[]; truncated: boolean }
  | {
      ok: false;
      kind: "provider_error" | "timeout" | "network" | "invalid_response" | "invalid_config";
      httpStatus: number | null;
      sanitizedError: string;
    };

/**
 * GET /{waba-id}/message_templates, following Meta's cursor pagination.
 * `paging.next` is only followed when it points back at graph.facebook.com
 * over HTTPS, so a malformed response cannot redirect the bearer token.
 */
export async function fetchWhatsAppMessageTemplates(input: {
  wabaId: string;
  accessToken: string;
  graphApiVersion: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  maxPages?: number;
}): Promise<GraphListTemplatesResult> {
  if (!isValidGraphApiVersion(input.graphApiVersion) || !WABA_ID_PATTERN.test(input.wabaId)) {
    return {
      ok: false,
      kind: "invalid_config",
      httpStatus: null,
      sanitizedError: "Invalid Graph API version or WhatsApp Business Account id",
    };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? WHATSAPP_GRAPH_TIMEOUT_MS;
  const maxPages = Math.max(1, Math.min(input.maxPages ?? TEMPLATE_LIST_MAX_PAGES, TEMPLATE_LIST_MAX_PAGES));

  const first = new URL(
    `https://graph.facebook.com/${input.graphApiVersion}/${input.wabaId}/message_templates`
  );
  first.searchParams.set("fields", TEMPLATE_FIELDS);
  first.searchParams.set("limit", "100");

  const records: unknown[] = [];
  let next: URL | null = first;
  let pages = 0;

  while (next && pages < maxPages) {
    pages += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(next, {
        method: "GET",
        headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" },
        signal: controller.signal,
        redirect: "error",
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      if (response.status < 200 || response.status >= 300) {
        return {
          ok: false,
          kind: "provider_error",
          httpStatus: response.status,
          sanitizedError: sanitizeProviderError(parsed ?? text),
        };
      }
      const body = parsed as { data?: unknown; paging?: { next?: unknown } } | null;
      if (!body || !Array.isArray(body.data)) {
        return {
          ok: false,
          kind: "invalid_response",
          httpStatus: response.status,
          sanitizedError: "Provider returned an unexpected template list",
        };
      }
      records.push(...body.data);
      next = safeGraphNextUrl(body.paging?.next);
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      const message = err instanceof Error ? err.message : "network error";
      if (name === "AbortError" || /aborted|timeout/i.test(message)) {
        return { ok: false, kind: "timeout", httpStatus: null, sanitizedError: "Provider request timed out" };
      }
      return { ok: false, kind: "network", httpStatus: null, sanitizedError: sanitizeProviderError(message) };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: true, records, truncated: next !== null };
}

function safeGraphNextUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "graph.facebook.com") return null;
    if (url.username || url.password) return null;
    // Meta echoes access_token into paging links; the header carries it instead.
    url.searchParams.delete("access_token");
    return url;
  } catch {
    return null;
  }
}
