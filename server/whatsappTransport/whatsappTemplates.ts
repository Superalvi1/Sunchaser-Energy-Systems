/**
 * Approved WhatsApp message templates: normalization, send-eligibility policy,
 * per-send component building and inbox preview rendering.
 *
 * Pure functions — no I/O. Official Meta WhatsApp Cloud API only.
 *
 * Portions adapted from WA CRM (https://github.com/ArnasDon/wacrm) at commit
 * aee1b01f4b557870f1bbf9e7f566a2759e8f20f3, files
 * src/lib/whatsapp/template-send-builder.ts, template-validators.ts and
 * template-status-normalize.ts.
 * Copyright (c) 2026 Arnas Donauskas. MIT License — full text in
 * docs/licenses/wacrm-MIT-LICENSE.txt.
 *
 * Deliberate differences from upstream:
 * - Templates are read from Meta's Graph API shape, not an upstream DB row.
 * - A parameter-count mismatch is rejected; upstream silently drops extras.
 * - An unrecognised status is UNKNOWN and never sendable; upstream maps it to
 *   PENDING.
 * - Only a conservative subset of template features is sendable in this
 *   version; everything else is listed with an explicit reason.
 */

export type TemplateStatus =
  | "APPROVED"
  | "PENDING"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED"
  | "IN_APPEAL"
  | "PENDING_DELETION"
  | "DELETED"
  | "LIMIT_EXCEEDED"
  | "UNKNOWN";

const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  "APPROVED",
  "PENDING",
  "REJECTED",
  "PAUSED",
  "DISABLED",
  "IN_APPEAL",
  "PENDING_DELETION",
  "DELETED",
  "LIMIT_EXCEEDED",
]);

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION" | "UNKNOWN";

export type TemplateButtonKind =
  | "QUICK_REPLY"
  | "URL"
  | "PHONE_NUMBER"
  | "COPY_CODE"
  | "OTHER";

export type TemplateButton = {
  kind: TemplateButtonKind;
  text: string;
  /** URL buttons only; may contain a single {{1}} suffix placeholder. */
  url: string | null;
  /** Number of send-time URL variables (0 or 1). */
  urlVarCount: number;
};

export type WhatsAppTemplate = {
  id: string;
  name: string;
  language: string;
  status: TemplateStatus;
  category: TemplateCategory;
  parameterFormat: "POSITIONAL" | "NAMED";
  header:
    | { format: "TEXT"; text: string; varCount: number }
    | { format: "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION" | "OTHER" }
    | null;
  bodyText: string;
  bodyVarCount: number;
  footerText: string | null;
  buttons: TemplateButton[];
  /** True only when every policy check below passes. */
  sendable: boolean;
  /** Human-readable reason when not sendable. Never contains secrets. */
  unsupportedReason: string | null;
};

export type TemplateSendParams = {
  /** Values for body {{1}}..{{n}}, in order. */
  body?: string[];
  /** Value for a TEXT header {{1}}. */
  headerText?: string;
  /** URL-button suffix values keyed by the button's index in the template. */
  buttonUrlParams?: Record<number, string>;
};

export type TemplateSendComponent =
  | { type: "header"; parameters: Array<{ type: "text"; text: string }> }
  | { type: "body"; parameters: Array<{ type: "text"; text: string }> }
  | {
      type: "button";
      sub_type: "url";
      index: string;
      parameters: Array<{ type: "text"; text: string }>;
    };

/** Meta's documented per-parameter cap is well above this; stay conservative. */
export const TEMPLATE_PARAM_MAX_LENGTH = 1024;
/** Template names are lowercase letters, digits and underscores. */
export const TEMPLATE_NAME_PATTERN = /^[a-z0-9_]{1,512}$/;
/** BCP-47-ish codes Meta uses: en, en_US, pt_BR, zh_Hant, ... */
export const TEMPLATE_LANGUAGE_PATTERN = /^[a-z]{2,3}(_[A-Za-z]{2,4})?$/;

/** Positional placeholder indices, deduped and sorted. From upstream. */
export function extractVariableIndices(text: string): number[] {
  const set = new Set<number>();
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/** Meta requires contiguous 1-indexed variables ({{1}} {{3}} is invalid). */
function contiguousCount(text: string): number | null {
  const indices = extractVariableIndices(text);
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i + 1) return null;
  }
  return indices.length;
}

export function normalizeTemplateStatus(raw: unknown): TemplateStatus {
  const upper = String(raw ?? "").toUpperCase();
  if (upper === "PENDING_REVIEW") return "PENDING";
  return KNOWN_STATUSES.has(upper) ? (upper as TemplateStatus) : "UNKNOWN";
}

function normalizeCategory(raw: unknown): TemplateCategory {
  const upper = String(raw ?? "").toUpperCase();
  if (upper === "MARKETING" || upper === "UTILITY" || upper === "AUTHENTICATION") {
    return upper;
  }
  return "UNKNOWN";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Normalize one record from GET /{waba-id}/message_templates.
 * Returns null for records too malformed to identify.
 */
export function normalizeMetaTemplate(raw: unknown): WhatsAppTemplate | null {
  if (!isRecord(raw)) return null;
  const name = str(raw.name).trim();
  const language = str(raw.language).trim();
  if (!name || !language) return null;

  const status = normalizeTemplateStatus(raw.status);
  const category = normalizeCategory(raw.category);
  const parameterFormat =
    String(raw.parameter_format ?? "POSITIONAL").toUpperCase() === "NAMED"
      ? "NAMED"
      : "POSITIONAL";

  let header: WhatsAppTemplate["header"] = null;
  let bodyText = "";
  let footerText: string | null = null;
  const buttons: TemplateButton[] = [];
  const problems: string[] = [];

  const components = Array.isArray(raw.components) ? raw.components : [];
  for (const component of components) {
    if (!isRecord(component)) continue;
    const type = String(component.type ?? "").toUpperCase();
    if (type === "HEADER") {
      const format = String(component.format ?? "").toUpperCase();
      if (format === "TEXT") {
        const text = str(component.text);
        const count = contiguousCount(text);
        if (count === null) problems.push("header variables are not contiguous");
        header = { format: "TEXT", text, varCount: count ?? 0 };
      } else if (
        format === "IMAGE" ||
        format === "VIDEO" ||
        format === "DOCUMENT" ||
        format === "LOCATION"
      ) {
        header = { format };
      } else {
        header = { format: "OTHER" };
      }
    } else if (type === "BODY") {
      bodyText = str(component.text);
    } else if (type === "FOOTER") {
      footerText = str(component.text) || null;
    } else if (type === "BUTTONS") {
      const list = Array.isArray(component.buttons) ? component.buttons : [];
      for (const b of list) {
        if (!isRecord(b)) continue;
        const kind = String(b.type ?? "").toUpperCase();
        const text = str(b.text);
        if (kind === "URL") {
          const url = str(b.url);
          const count = contiguousCount(url);
          if (count === null || count > 1) {
            problems.push("URL button has an unsupported variable pattern");
          }
          buttons.push({ kind: "URL", text, url, urlVarCount: count ?? 0 });
        } else if (kind === "QUICK_REPLY" || kind === "PHONE_NUMBER" || kind === "COPY_CODE") {
          buttons.push({ kind, text, url: null, urlVarCount: 0 });
        } else {
          buttons.push({ kind: "OTHER", text, url: null, urlVarCount: 0 });
        }
      }
    }
  }

  const bodyCount = contiguousCount(bodyText);
  if (bodyCount === null) problems.push("body variables are not contiguous");

  const template: WhatsAppTemplate = {
    id: str(raw.id) || `${name}:${language}`,
    name,
    language,
    status,
    category,
    parameterFormat,
    header,
    bodyText,
    bodyVarCount: bodyCount ?? 0,
    footerText,
    buttons,
    sendable: false,
    unsupportedReason: null,
  };
  template.unsupportedReason = sendPolicyReason(template, problems);
  template.sendable = template.unsupportedReason === null;
  return template;
}

/**
 * Send-eligibility policy for this version. Returns null when sendable.
 * Anything not explicitly supported is refused rather than attempted.
 */
function sendPolicyReason(t: WhatsAppTemplate, problems: string[]): string | null {
  if (t.status !== "APPROVED") return `Template status is ${t.status}; only APPROVED templates can be sent`;
  if (!TEMPLATE_NAME_PATTERN.test(t.name)) return "Template name is not in Meta's expected format";
  if (!TEMPLATE_LANGUAGE_PATTERN.test(t.language)) return "Template language code is not recognised";
  if (t.category === "AUTHENTICATION") return "Authentication (one-time code) templates are not supported from the inbox";
  if (t.category === "UNKNOWN") return "Template category is not recognised";
  if (t.parameterFormat === "NAMED") return "Named-parameter templates are not supported yet";
  if (!t.bodyText.trim()) return "Template has no body text";
  if (t.header && t.header.format !== "TEXT") return "Media and location headers are not supported yet";
  if (t.header?.format === "TEXT" && t.header.varCount > 1) return "Header may contain at most one variable";
  if (t.buttons.some((b) => b.kind === "COPY_CODE")) return "Copy-code buttons are not supported yet";
  if (t.buttons.some((b) => b.kind === "OTHER")) return "Template uses a button type that is not supported yet";
  if (problems.length > 0) return `Template is malformed: ${problems[0]}`;
  return null;
}

export type TemplateParamValidation = { ok: true } | { ok: false; error: string };

/**
 * Meta rejects parameters containing newlines, tabs or more than four
 * consecutive spaces (error 132018). Check before calling Meta so staff see
 * which value is wrong.
 */
export function validateTemplateParamValue(value: unknown, label: string): TemplateParamValidation {
  if (typeof value !== "string") return { ok: false, error: `${label} must be text` };
  if (!value.trim()) return { ok: false, error: `${label} requires a value` };
  if (value.length > TEMPLATE_PARAM_MAX_LENGTH) {
    return { ok: false, error: `${label} is longer than ${TEMPLATE_PARAM_MAX_LENGTH} characters` };
  }
  if (/[\r\n\t]/.test(value)) return { ok: false, error: `${label} cannot contain line breaks or tabs` };
  if (/ {5,}/.test(value)) return { ok: false, error: `${label} cannot contain more than four consecutive spaces` };
  return { ok: true };
}

export type BuildComponentsResult =
  | { ok: true; components: TemplateSendComponent[] }
  | { ok: false; error: string };

/**
 * Build the per-send `components` array for POST /{phone-number-id}/messages.
 * Adapted from upstream buildSendComponents, restricted to the supported
 * subset and failing closed on any count mismatch.
 */
export function buildTemplateSendComponents(
  template: WhatsAppTemplate,
  params: TemplateSendParams = {}
): BuildComponentsResult {
  if (!template.sendable) {
    return { ok: false, error: template.unsupportedReason ?? "Template is not sendable" };
  }
  const components: TemplateSendComponent[] = [];

  if (template.header?.format === "TEXT" && template.header.varCount === 1) {
    const check = validateTemplateParamValue(params.headerText, "Header variable {{1}}");
    if (check.ok === false) return check;
    components.push({ type: "header", parameters: [{ type: "text", text: params.headerText! }] });
  } else if (params.headerText !== undefined) {
    return { ok: false, error: "This template's header takes no variable" };
  }

  const body = params.body ?? [];
  if (body.length !== template.bodyVarCount) {
    return {
      ok: false,
      error: `Template body needs ${template.bodyVarCount} value(s); ${body.length} supplied`,
    };
  }
  for (let i = 0; i < body.length; i++) {
    const check = validateTemplateParamValue(body[i], `Body variable {{${i + 1}}}`);
    if (check.ok === false) return check;
  }
  if (body.length > 0) {
    components.push({ type: "body", parameters: body.map((text) => ({ type: "text", text })) });
  }

  const urlParams = params.buttonUrlParams ?? {};
  for (const key of Object.keys(urlParams)) {
    const index = Number(key);
    const button = template.buttons[index];
    if (!Number.isInteger(index) || !button || button.kind !== "URL" || button.urlVarCount !== 1) {
      return { ok: false, error: `Button ${Number(key) + 1} takes no send-time value` };
    }
  }
  for (let index = 0; index < template.buttons.length; index++) {
    const button = template.buttons[index]!;
    if (button.kind !== "URL" || button.urlVarCount !== 1) continue;
    const value = urlParams[index];
    const check = validateTemplateParamValue(value, `Button ${index + 1} URL value`);
    if (check.ok === false) return check;
    components.push({
      type: "button",
      sub_type: "url",
      index: String(index),
      parameters: [{ type: "text", text: value! }],
    });
  }

  return { ok: true, components };
}

function fill(text: string, values: readonly string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (match, n) => {
    const value = values[Number(n) - 1];
    return value === undefined ? match : value;
  });
}

/**
 * Plain-text rendering of what the customer receives, stored as the inbox
 * message body so staff can see what was sent. Call only after
 * buildTemplateSendComponents succeeded.
 */
export function renderTemplatePreview(
  template: WhatsAppTemplate,
  params: TemplateSendParams = {}
): string {
  const parts: string[] = [];
  if (template.header?.format === "TEXT") {
    parts.push(fill(template.header.text, params.headerText ? [params.headerText] : []));
  }
  parts.push(fill(template.bodyText, params.body ?? []));
  if (template.footerText) parts.push(template.footerText);
  const labels = template.buttons.map((b) => b.text).filter(Boolean);
  if (labels.length > 0) parts.push(labels.map((l) => `[${l}]`).join(" "));
  return parts.filter((p) => p.trim()).join("\n\n");
}

/** Browser-safe summary. Carries no tokens, WABA ids or phone numbers. */
export type TemplateSummary = Pick<
  WhatsAppTemplate,
  | "name"
  | "language"
  | "status"
  | "category"
  | "header"
  | "bodyText"
  | "bodyVarCount"
  | "footerText"
  | "buttons"
  | "sendable"
  | "unsupportedReason"
>;

export function toTemplateSummary(t: WhatsAppTemplate): TemplateSummary {
  return {
    name: t.name,
    language: t.language,
    status: t.status,
    category: t.category,
    header: t.header,
    bodyText: t.bodyText,
    bodyVarCount: t.bodyVarCount,
    footerText: t.footerText,
    buttons: t.buttons,
    sendable: t.sendable,
    unsupportedReason: t.unsupportedReason,
  };
}
