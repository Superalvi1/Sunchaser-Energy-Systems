/**
 * CrmClient — the Moos worker's ONLY interface to the Sunchaser CRM.
 *
 * Action-only model: the worker never holds Meta credentials, never downloads
 * PDFs, never invents prices. Every privileged action (sends, drafts, handoffs)
 * executes server-side in the CRM, which re-validates ownership, the 24h
 * window, quote approval/expiry and idempotency on every call.
 *
 *   GET  /api/moos/health
 *   GET  /api/moos/approved-quotes   approved, unexpired library (metadata only)
 *   GET  /api/moos/catalog           panel/inverter/battery catalog (no prices)
 *   GET  /api/moos/ownership         AI ownership state for a conversation
 *   POST /api/moos/send-text         canonical text send
 *   POST /api/moos/send-approved-pdf native WhatsApp document send (CRM-side)
 *   POST /api/moos/custom-quote-draft server-side Smart Quote draft (staff approval required)
 *   POST /api/moos/handoff           move conversation to HUMAN_HANDLING + audit
 */
export class CrmClient {
  constructor(env = process.env) {
    this.env = env;
    const base = String(env.CRM_BASE_URL || "").replace(/\/$/, "");
    if (!base) throw new Error("CRM_BASE_URL is required");
    if (!env.MOOS_SERVICE_TOKEN) throw new Error("MOOS_SERVICE_TOKEN is required");
    this.base = base;
    this.token = env.MOOS_SERVICE_TOKEN;
  }

  async request(method, path, body) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(
        `CRM ${method} ${path} → ${res.status}: ${data?.error || "request failed"}`
      );
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  health() {
    return this.request("GET", "/api/moos/health");
  }

  /** Approved, unexpired library quotes (metadata only). Filters: { capacityKw, systemType }. */
  approvedQuotes(filters = {}) {
    const q = new URLSearchParams();
    if (filters.capacityKw) q.set("capacityKw", String(filters.capacityKw));
    if (filters.systemType) q.set("systemType", String(filters.systemType));
    const qs = q.toString();
    return this.request("GET", `/api/moos/approved-quotes${qs ? `?${qs}` : ""}`);
  }

  /** Equipment catalog for custom quotes (ids/brands/specs; prices stay server-side). */
  catalog() {
    return this.request("GET", "/api/moos/catalog");
  }

  /** Ownership state for a conversation: { conversationId, state, humanOwned }. */
  ownership(conversationId) {
    return this.request(
      "GET",
      `/api/moos/ownership?conversationId=${encodeURIComponent(conversationId)}`
    );
  }

  /** Canonical text send. Idempotent per idempotencyKey. */
  sendText({ conversationId, text, idempotencyKey }) {
    return this.request("POST", "/api/moos/send-text", {
      conversationId,
      text,
      idempotencyKey,
    });
  }

  /** Native PDF document send by approved quote id. Idempotent per idempotencyKey. */
  sendApprovedPdf({ conversationId, quoteId, idempotencyKey }) {
    return this.request("POST", "/api/moos/send-approved-pdf", {
      conversationId,
      quoteId,
      idempotencyKey,
    });
  }

  /** Server-side Smart Quote draft (never auto-sent; staff approval required). */
  customQuoteDraft({ conversationId, inboundMessageId, requirements }) {
    return this.request("POST", "/api/moos/custom-quote-draft", {
      conversationId,
      inboundMessageId,
      requirements,
    });
  }

  /** Move a conversation to HUMAN_HANDLING with an audit trail. */
  handoff(conversationId, reason, summary = "") {
    return this.request("POST", "/api/moos/handoff", {
      conversationId,
      reason,
      summary,
    });
  }
}
