/**
 * Optional WA CRM read-only connector.
 *
 * This deliberately does NOT register routes, read Meta credentials, send messages,
 * subscribe a WABA, modify CRM records or process inbound webhooks.
 * It must remain disabled until an isolated WA CRM instance has been tested.
 *
 * Upstream API: https://github.com/ArnasDon/wacrm/blob/main/docs/public-api.md
 */
export type WacrmReadOnlyConfig = {
  baseUrl: string;
  apiKey: string;
  enabled: true;
};

export type WacrmApiList<T = unknown> = {
  data: T[];
  meta?: { next_cursor?: string | null };
};

type MePayload = {
  account: { id: string; name: string };
  key: { id: string; scopes: string[] };
};

export type WacrmReadScope =
  | "contacts:read"
  | "conversations:read"
  | "messages:read";

export const WACRM_READ_SCOPES: readonly WacrmReadScope[] = [
  "contacts:read",
  "conversations:read",
  "messages:read",
];

export type WacrmReadOnlyErrorCode =
  | "invalid_config"
  | "disabled"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "upstream_unavailable"
  | "malformed_response"
  | "missing_scopes"
  | "invalid_input";

export class WacrmReadOnlyError extends Error {
  constructor(
    public readonly code: WacrmReadOnlyErrorCode,
    public readonly status: number | null = null
  ) {
    super(`WA CRM integration: ${code}`);
    this.name = "WacrmReadOnlyError";
  }
}

/** Never expose the key or a full upstream error body to browser/log callers. */
export function readWacrmReadOnlyConfig(
  env: Record<string, string | undefined> = process.env
): WacrmReadOnlyConfig | null {
  if (env.WACRM_INTEGRATION_ENABLED !== "true") return null;
  const baseUrl = env.WACRM_BASE_URL?.trim() ?? "";
  const apiKey = env.WACRM_READONLY_API_KEY?.trim() ?? "";
  validateOrigin(baseUrl);
  if (!apiKey || /\s/.test(apiKey)) {
    throw new WacrmReadOnlyError("invalid_config");
  }
  return { baseUrl, apiKey, enabled: true };
}

function validateOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WacrmReadOnlyError("invalid_config");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new WacrmReadOnlyError("invalid_config");
  }
  return url;
}

function pageLimit(limit: number): string {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new WacrmReadOnlyError("invalid_input");
  }
  return String(limit);
}

function checkedCursor(cursor?: string): string | undefined {
  if (cursor === undefined) return undefined;
  if (!cursor || cursor.length > 2048) {
    throw new WacrmReadOnlyError("invalid_input");
  }
  return cursor;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createWacrmReadOnlyClient(
  config: WacrmReadOnlyConfig | null,
  fetcher: typeof fetch = fetch
) {
  if (!config?.enabled) throw new WacrmReadOnlyError("disabled");
  const base = validateOrigin(config.baseUrl);
  if (!config.apiKey || /\s/.test(config.apiKey)) {
    throw new WacrmReadOnlyError("invalid_config");
  }

  async function get<T>(path: string, query?: URLSearchParams): Promise<T> {
    // All paths in this module are hardcoded; never accept arbitrary URLs.
    const target = new URL(path, base);
    if (query) target.search = query.toString();
    let response: Response;
    try {
      response = await fetcher(target, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config!.apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new WacrmReadOnlyError("upstream_unavailable");
    }
    if (!response.ok) {
      const code: WacrmReadOnlyErrorCode =
        response.status === 401
          ? "unauthorized"
          : response.status === 403
            ? "forbidden"
            : response.status === 429
              ? "rate_limited"
              : "upstream_unavailable";
      throw new WacrmReadOnlyError(code, response.status);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new WacrmReadOnlyError("malformed_response");
    }
    if (!record(payload) || !("data" in payload)) {
      throw new WacrmReadOnlyError("malformed_response");
    }
    return payload as T;
  }

  return Object.freeze({
    async verifyReadScopes(): Promise<{
      accountId: string;
      missingScopes: WacrmReadScope[];
    }> {
      const response = await get<{ data: MePayload }>("/api/v1/me");
      const me = response.data;
      if (
        !record(me) ||
        !record(me.account) ||
        typeof me.account.id !== "string" ||
        !record(me.key) ||
        !Array.isArray(me.key.scopes) ||
        !me.key.scopes.every((scope: unknown) => typeof scope === "string")
      ) {
        throw new WacrmReadOnlyError("malformed_response");
      }
      const missingScopes = WACRM_READ_SCOPES.filter(
        (scope) => !me.key.scopes.includes(scope)
      );
      return { accountId: me.account.id, missingScopes };
    },

    async listContacts(options: { limit?: number; search?: string; cursor?: string } = {}) {
      const query = new URLSearchParams({ limit: pageLimit(options.limit ?? 50) });
      if (options.search) query.set("search", options.search.slice(0, 150));
      const cursor = checkedCursor(options.cursor);
      if (cursor) query.set("cursor", cursor);
      const response = await get<WacrmApiList>("/api/v1/contacts", query);
      if (!Array.isArray(response.data)) throw new WacrmReadOnlyError("malformed_response");
      return response;
    },

    async listConversations(
      options: {
        limit?: number;
        status?: "open" | "pending" | "closed";
        contactId?: string;
        cursor?: string;
      } = {}
    ) {
      const query = new URLSearchParams({ limit: pageLimit(options.limit ?? 50) });
      if (options.status) query.set("status", options.status);
      if (options.contactId) query.set("contact_id", options.contactId);
      const cursor = checkedCursor(options.cursor);
      if (cursor) query.set("cursor", cursor);
      const response = await get<WacrmApiList>("/api/v1/conversations", query);
      if (!Array.isArray(response.data)) throw new WacrmReadOnlyError("malformed_response");
      return response;
    },

    async listConversationMessages(conversationId: string, limit = 50, cursor?: string) {
      // WA CRM conversation IDs are UUIDs. Reject path control characters.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) {
        throw new WacrmReadOnlyError("invalid_input");
      }
      const query = new URLSearchParams({ limit: pageLimit(limit) });
      const checked = checkedCursor(cursor);
      if (checked) query.set("cursor", checked);
      const response = await get<WacrmApiList>(
        `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
        query
      );
      if (!Array.isArray(response.data)) throw new WacrmReadOnlyError("malformed_response");
      return response;
    },
  });
}
