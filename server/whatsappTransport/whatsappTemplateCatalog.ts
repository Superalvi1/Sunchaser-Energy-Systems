/**
 * Approved-template catalog for the inbox.
 *
 * Reads templates from Meta (GET /{waba-id}/message_templates) with the same
 * connection-first credential policy as outbound sends: the Meta Embedded
 * Signup connection is authoritative; the deprecated environment credentials
 * are used only when no connection record exists at all. A defective or
 * unreachable connection fails closed.
 *
 * Templates are cached in memory per WABA for a short TTL. Nothing here is
 * persisted, and no token or WABA id is ever returned to callers.
 */
import type { WhatsAppConfig } from "./whatsappConfig.ts";
import { isValidGraphApiVersion } from "./whatsappConfig.ts";
import {
  fetchWhatsAppMessageTemplates,
  WABA_ID_PATTERN,
} from "./whatsappGraphClient.ts";
import {
  hasLegacyEnvCredentials,
  isLegacyEnvFallbackEnabled,
  selectOutboundConnection,
  type OutboundConnectionLookup,
} from "./whatsappOutboundCredentials.ts";
import {
  normalizeMetaTemplate,
  type WhatsAppTemplate,
} from "./whatsappTemplates.ts";

export const TEMPLATE_CACHE_TTL_MS = 5 * 60 * 1000;

export type TemplateCatalogFailure =
  | "not_configured"
  | "connection_unavailable"
  | "provider_error";

export type TemplateCatalogResult =
  | { ok: true; templates: WhatsAppTemplate[]; fetchedAt: string; truncated: boolean }
  | { ok: false; reason: TemplateCatalogFailure; message: string };

export type TemplateCatalogDeps = {
  config: WhatsAppConfig;
  connectionLookup: OutboundConnectionLookup;
  companyId: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type CacheEntry = {
  expiresAt: number;
  templates: WhatsAppTemplate[];
  fetchedAt: string;
  truncated: boolean;
};

type TemplateSource = { wabaId: string; accessToken: string };

/** Resolve which WABA to read and with which token. Never throws. */
async function resolveTemplateSource(
  deps: TemplateCatalogDeps
): Promise<{ ok: true; source: TemplateSource } | { ok: false; reason: TemplateCatalogFailure; message: string }> {
  let record;
  try {
    record = await deps.connectionLookup.get(deps.companyId);
  } catch {
    return {
      ok: false,
      reason: "connection_unavailable",
      message: "WhatsApp connection lookup failed",
    };
  }

  if (record) {
    const selected = selectOutboundConnection([record]);
    if (selected.ok === false) {
      return {
        ok: false,
        reason: "connection_unavailable",
        message: "The WhatsApp connection is not active; reconnect it to load templates",
      };
    }
    const wabaId = selected.record.wabaId?.trim() ?? "";
    if (!WABA_ID_PATTERN.test(wabaId)) {
      return {
        ok: false,
        reason: "connection_unavailable",
        message: "The WhatsApp connection has no verified business account id",
      };
    }
    return { ok: true, source: { wabaId, accessToken: selected.record.accessToken!.trim() } };
  }

  const env = deps.env ?? process.env;
  const legacyWabaId = String(env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? "").trim();
  if (
    isLegacyEnvFallbackEnabled(env) &&
    hasLegacyEnvCredentials(deps.config) &&
    WABA_ID_PATTERN.test(legacyWabaId)
  ) {
    return {
      ok: true,
      source: { wabaId: legacyWabaId, accessToken: deps.config.accessToken.trim() },
    };
  }
  return {
    ok: false,
    reason: "not_configured",
    message: "Connect WhatsApp Business to load message templates",
  };
}

export class WhatsAppTemplateCatalog {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly deps: TemplateCatalogDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  async list(options: { refresh?: boolean } = {}): Promise<TemplateCatalogResult> {
    if (!isValidGraphApiVersion(this.deps.config.graphApiVersion)) {
      return { ok: false, reason: "not_configured", message: "WhatsApp Graph API version is not configured" };
    }
    const resolved = await resolveTemplateSource(this.deps);
    if (resolved.ok === false) return resolved;
    const { wabaId, accessToken } = resolved.source;

    const cached = this.cache.get(wabaId);
    if (!options.refresh && cached && cached.expiresAt > this.now()) {
      return { ok: true, templates: cached.templates, fetchedAt: cached.fetchedAt, truncated: cached.truncated };
    }

    const result = await fetchWhatsAppMessageTemplates({
      wabaId,
      accessToken,
      graphApiVersion: this.deps.config.graphApiVersion,
      fetchImpl: this.deps.fetchImpl,
    });
    if (result.ok === false) {
      return {
        ok: false,
        reason: "provider_error",
        message: `Could not load templates from Meta: ${result.sanitizedError}`,
      };
    }

    const templates = result.records
      .map(normalizeMetaTemplate)
      .filter((t): t is WhatsAppTemplate => t !== null)
      .sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));
    const entry: CacheEntry = {
      expiresAt: this.now() + TEMPLATE_CACHE_TTL_MS,
      templates,
      fetchedAt: new Date(this.now()).toISOString(),
      truncated: result.truncated,
    };
    this.cache.set(wabaId, entry);
    return { ok: true, templates, fetchedAt: entry.fetchedAt, truncated: entry.truncated };
  }

  /**
   * Find a template for sending. Uses the cache; a template that Meta has
   * since paused or disabled is refused by Meta itself, and that failure is
   * recorded through the normal send-failure path.
   */
  async find(
    name: string,
    language: string
  ): Promise<{ ok: true; template: WhatsAppTemplate } | { ok: false; reason: TemplateCatalogFailure | "not_found"; message: string }> {
    const listed = await this.list();
    if (listed.ok === false) return listed;
    const template = listed.templates.find((t) => t.name === name && t.language === language);
    if (!template) {
      return { ok: false, reason: "not_found", message: "Template not found for this WhatsApp account" };
    }
    return { ok: true, template };
  }

  clear(): void {
    this.cache.clear();
  }
}
