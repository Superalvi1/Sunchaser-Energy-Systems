/**
 * Moos WhatsApp agent — CRM-side action API (`/api/moos/*`).
 *
 * The worker is action-only: it holds no Meta credentials and never touches
 * PDF bytes. Every send executes here, inside the main CRM, re-validating
 * ownership, the 24h window, quote approval/expiry and idempotency on each call.
 *
 * Security model per endpoint:
 *  - GET  /health            — no auth (liveness only, exposes nothing sensitive)
 *  - ALL others             — Bearer MOOS_SERVICE_TOKEN (timing-safe compare),
 *                             503 when the token is not configured.
 *  - POST /send-text,
 *    POST /send-approved-pdf,
 *    POST /custom-quote-draft,
 *    POST /handoff           — additionally require MOOS_ENABLED=true
 *                             (503 + error "moos_disabled" otherwise; the
 *                             worker treats that as shadow-mode and stays silent).
 *  - Sends                  — ownership gate (AI_SHADOW/AI_ACTIVE, open, no staff
 *                             owner), Meta 24h free-form window, atomic
 *                             idempotency claim (`moos:<key>`), outcome mapping:
 *                             201 → completed, 202/504/accepted → outcome_unknown
 *                             (never retried), anything else → failed-known.
 *  - Replay protection       — deterministic idempotency keys from the worker
 *                             (wamid + kind + suffix); the CRM relay dedups
 *                             inbound by wamid; custom-quote-draft claims
 *                             `moos:draft:<messageId>` and returns the existing
 *                             draft on replay.
 *  - Customer isolation      — only generic approved-library packages can be
 *                             sent, and only to the conversation that requested
 *                             them (conversation-scoped ownership + window
 *                             checks). Custom drafts are never sendable via
 *                             these endpoints; they require staff approval.
 *
 * The router is dependency-injected (see MoosRouterDeps) so integration tests
 * can run the full HTTP orchestration against in-memory repositories with
 * stubbed Meta/credential/storage seams. Production defaults wire the real
 * CRM services.
 */
import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import {
  loadAgentSettings,
  type QuotationSystemType,
  type SalesAgentSettings,
} from "../whatsappAgent/agentSettings.ts";
import {
  currentApprovedQuotations,
  publicAgentCatalog,
  type QuoteRequirements,
} from "../whatsappAgent/quoteTools.ts";
import {
  createDefaultWhatsAppRepository,
  safeAudit,
  type WhatsAppRepository,
} from "../whatsappTransport/whatsappRepository.ts";
import {
  createDefaultWhatsAppInboxRepositories,
  type WhatsAppInboxRepositories,
} from "../whatsappTransport/whatsappInboxRepository.ts";
import { computeFreeFormEligibility } from "../whatsappTransport/whatsappInboxFreeForm.ts";
import { getRailwayObject } from "../storage/railwayObjectStorage.ts";
import {
  sendWhatsAppDocumentMessage,
  uploadWhatsAppMedia,
  validatePdfBytes,
} from "../whatsappTransport/whatsappGraphClient.ts";
import {
  sendOutboundPlainText,
  type OutboundSendResult,
} from "../whatsappTransport/whatsappOutboundService.ts";
import {
  isValidGraphApiVersion,
  readWhatsAppConfig,
} from "../whatsappTransport/whatsappConfig.ts";
import { resolveOutboundCredentials } from "../whatsappTransport/whatsappOutboundCredentials.ts";
import { getWhatsAppConnectionRepository } from "../whatsappTransport/whatsappConnectionService.ts";
import { hydrateActorFromUsername, type RequestActor } from "../middleware/actor.ts";
import { canSendOutboundWhatsApp } from "../whatsappTransport/whatsappPermissions.ts";
import { normalizePakistanMobile } from "../../src/lib/smartQuoteLead.ts";
import { isLegacyAiEnabledFresh } from "./moosRelay.ts";
import { moosTestRecipientAllowed } from "./moosTestScope.ts";

const COMPANY_ID = "sunchaser";

/** Ownership states in which the Moos worker may act. Everything else fails closed. */
const MOOS_ELIGIBLE_STATES = ["AI_SHADOW", "AI_ACTIVE"];
const MOOS_OPEN_STATUSES = ["open", "pending"];

export type MoosCreateQuoteResult = {
  quoteNumber: string;
  totalPkr: number;
  url: string;
};

export type MoosCreateQuote = (
  requirements: QuoteRequirements,
  phone: string,
  messageId: string
) => Promise<MoosCreateQuoteResult>;

/** Input for the document-delivery seam (real Meta upload + send by default). */
export type MoosDeliverDocumentInput = {
  conversationId: string;
  contactPhoneE164: string;
  channelPhoneNumberId: string;
  pdfBytes: Buffer;
  filename: string;
  caption: string;
  quoteId: string;
};

export type MoosDeliverDocumentResult =
  | { ok: true; providerMessageId: string }
  | {
      ok: false;
      kind: "timeout" | "network" | "provider" | "config";
      error: string;
    };

export type MoosRouterDeps = {
  /**
   * Server-side quote creation (calculateAgentQuote → lead → PDF → archive).
   * Injected from server.ts so this module stays decoupled from lead internals.
   */
  createQuote: MoosCreateQuote;
  /** Inbox repositories (ownership, idempotency, audit). Defaults to Supabase-backed. */
  inboxRepos?: () => WhatsAppInboxRepositories;
  /** Conversation/message repository. Defaults to Supabase-backed. */
  conversationRepo?: () => WhatsAppRepository;
  /** Agent settings loader (approved-quotation library). Defaults to Railway object storage. */
  loadSettings?: () => Promise<{ settings: SalesAgentSettings }>;
  /** PDF byte fetcher. Defaults to Railway `customer-documents` bucket. */
  fetchQuotePdf?: (storagePath: string) => Promise<Buffer | null>;
  /** fetch implementation for Meta Graph calls. Defaults to global fetch. */
  metaFetch?: typeof fetch;
  /** Staff identity Moos sends as. Defaults to MOOS_ACTOR_USERNAME hydration. */
  resolveActor?: () => Promise<RequestActor | null>;
  /** Plain-text send. Defaults to the canonical outbound path. */
  sendOutboundText?: (
    conversationId: string,
    text: string,
    opts: {
      repo: WhatsAppRepository;
      actor: RequestActor;
      clientIdempotencyKey: string;
    }
  ) => Promise<OutboundSendResult>;
  /** Native document delivery (credentials → media upload → document send). */
  deliverDocument?: (
    input: MoosDeliverDocumentInput
  ) => Promise<MoosDeliverDocumentResult>;
  /**
   * Fresh, fail-closed legacy-agent check used at the send boundary.
   * Defaults to isLegacyAiEnabledFresh (no cache) — a queued event must not
   * send after the legacy AI becomes enabled.
   */
  checkLegacyAi?: () => Promise<boolean>;
};

function serviceToken(): string {
  return String(process.env.MOOS_SERVICE_TOKEN || "");
}

export function moosEnabled(): boolean {
  return /^(true|1|yes)$/i.test(String(process.env.MOOS_ENABLED || ""));
}

function authorized(req: Request, res: Response): boolean {
  const expected = serviceToken();
  if (!expected) {
    res.status(503).json({ error: "Moos service not configured" });
    return false;
  }
  const header = String(req.header("authorization") || "");
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  const a = Buffer.from(match[1], "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

/**
 * Mutating endpoints additionally require the MOOS_ENABLED kill switch.
 * The machine-readable `moos_disabled` code lets the worker distinguish
 * shadow mode (stay silent) from real failures (hand off to a human).
 */
function requireEnabled(res: Response): boolean {
  if (!moosEnabled()) {
    res
      .status(503)
      .json({ error: "moos_disabled", message: "Moos agent is disabled (MOOS_ENABLED=false)" });
    return false;
  }
  return true;
}

function jsonBody(req: Request): Record<string, unknown> {
  return (req.body && typeof req.body === "object" ? req.body : {}) as Record<
    string,
    unknown
  >;
}

function validIdempotencyKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return /^[A-Za-z0-9:_-]{8,128}$/.test(key) ? key : null;
}

/**
 * Best-effort system-type inference for legacy library records that predate
 * the first-class variant fields (matches the admin title convention).
 */
function inferSystemType(
  title: string,
  description: string
): QuotationSystemType | null {
  const hay = `${title || ""} ${description || ""}`.toLowerCase();
  if (hay.includes("hybrid")) return "hybrid";
  if (hay.includes("off-grid") || hay.includes("off grid") || hay.includes("offgrid"))
    return "off_grid";
  if (
    hay.includes("on-grid") ||
    hay.includes("on grid") ||
    hay.includes("ongrid")
  )
    return "on_grid";
  return null;
}

function matchesSystemTypeFilter(
  systemType: QuotationSystemType | null,
  filter: string | undefined
): boolean {
  if (!filter) return true;
  const want = filter.toLowerCase().replace(/[_\s-]/g, "");
  const have = (systemType || "").replace(/_/g, "");
  return want === have;
}

type OwnershipCheck = {
  eligible: boolean;
  state: string;
  conversationId: string;
};

function pdfCaption(title: string, capacityKw: number, expiresAt: string): string {
  const valid = String(expiresAt || "").slice(0, 10);
  return (
    `Sunchaser ${capacityKw}kW quotation — ${title}. ` +
    `Valid until ${valid}. Prices subject to site survey.`
  ).slice(0, 1024);
}

/**
 * Default document delivery: connection-first credential resolution
 * (stored WhatsApp connection wins; env is only a legacy fallback),
 * Meta media upload, then the native type:document send.
 */
async function defaultDeliverDocument(
  input: MoosDeliverDocumentInput,
  metaFetch: typeof fetch
): Promise<MoosDeliverDocumentResult> {
  const repo = createDefaultWhatsAppRepository();
  const config = readWhatsAppConfig();
  if (!isValidGraphApiVersion(config.graphApiVersion)) {
    return { ok: false, kind: "config", error: "invalid_graph_api_version" };
  }
  const credentials = await resolveOutboundCredentials({
    config,
    connectionLookup: getWhatsAppConnectionRepository(),
    companyId: COMPANY_ID,
    expectedPhoneNumberId: input.channelPhoneNumberId,
    env: process.env,
  });
  if (credentials.ok === false) {
    await safeAudit(repo, {
      eventType: "moos_outbound_failed",
      entityType: "conversation",
      entityId: input.conversationId,
      metadata: { reason: credentials.reason, quoteId: input.quoteId },
    });
    return { ok: false, kind: "config", error: `credentials: ${credentials.reason}` };
  }
  if (input.channelPhoneNumberId !== credentials.phoneNumberId) {
    return { ok: false, kind: "config", error: "channel_sender_mismatch" };
  }
  const upload = await uploadWhatsAppMedia({
    phoneNumberId: credentials.phoneNumberId,
    accessToken: credentials.accessToken,
    graphApiVersion: config.graphApiVersion,
    pdfBytes: input.pdfBytes,
    filename: input.filename,
    fetchImpl: metaFetch,
  });
  if (upload.ok === false) {
    // provider_error / invalid_response / invalid_config are terminal provider
    // failures (failed-known); only timeout/network are outcome-unknown.
    const kind = upload.kind === "timeout" || upload.kind === "network" ? upload.kind : "provider";
    return { ok: false, kind, error: upload.sanitizedError };
  }
  const send = await sendWhatsAppDocumentMessage({
    toWaId: input.contactPhoneE164,
    mediaId: upload.mediaId,
    filename: input.filename,
    caption: input.caption,
    phoneNumberId: credentials.phoneNumberId,
    accessToken: credentials.accessToken,
    graphApiVersion: config.graphApiVersion,
    fetchImpl: metaFetch,
  });
  if (send.ok === false) {
    const kind = send.kind === "timeout" || send.kind === "network" ? send.kind : "provider";
    return { ok: false, kind, error: send.sanitizedError };
  }
  return { ok: true, providerMessageId: send.providerMessageId };
}

/**
 * Staff identity Moos sends as. Designated via MOOS_ACTOR_USERNAME so every
 * Moos send is attributed to a real, approved staff account in CRM audits.
 * Fail closed when unset, unresolvable, or not send-authorized.
 */
let cachedActor: { actor: RequestActor; at: number } | null = null;
async function defaultResolveActor(): Promise<RequestActor | null> {
  if (cachedActor && Date.now() - cachedActor.at < 60000) return cachedActor.actor;
  const username = String(process.env.MOOS_ACTOR_USERNAME || "").trim();
  if (!username) return null;
  try {
    const hydrated = await hydrateActorFromUsername(username, undefined, "jwt");
    if (!hydrated.ok || !canSendOutboundWhatsApp(hydrated.actor)) return null;
    cachedActor = { actor: hydrated.actor, at: Date.now() };
    return hydrated.actor;
  } catch {
    return null;
  }
}

export function createMoosRouter(deps: MoosRouterDeps) {
  const router = Router();
  const inboxRepos = deps.inboxRepos ?? createDefaultWhatsAppInboxRepositories;
  const conversationRepo = deps.conversationRepo ?? createDefaultWhatsAppRepository;
  const loadSettings = deps.loadSettings ?? loadAgentSettings;
  const fetchQuotePdf =
    deps.fetchQuotePdf ??
    ((p: string) => getRailwayObject("customer-documents", p).then((o) => o?.body ?? null));
  const metaFetch = deps.metaFetch ?? fetch;
  const resolveActor = deps.resolveActor ?? defaultResolveActor;
  const sendOutboundText =
    deps.sendOutboundText ??
    ((
      conversationId: string,
      text: string,
      opts: { repo: WhatsAppRepository; actor: RequestActor; clientIdempotencyKey: string }
    ) =>
      sendOutboundPlainText(conversationId, text, {
        repo: opts.repo,
        config: readWhatsAppConfig(),
        actor: opts.actor,
        companyId: COMPANY_ID,
        clientIdempotencyKey: opts.clientIdempotencyKey,
      }));
  const deliverDocument =
    deps.deliverDocument ??
    ((input: MoosDeliverDocumentInput) => defaultDeliverDocument(input, metaFetch));
  const checkLegacyAi = deps.checkLegacyAi ?? (() => isLegacyAiEnabledFresh());

  /**
   * Send-boundary mutual exclusion: a fresh, fail-closed legacy-agent read
   * immediately before Meta dispatch. A queued Moos event must never send
   * after the legacy AI becomes enabled — the relay-time check alone cannot
   * guarantee this.
   */
  async function assertLegacyAiOff(): Promise<{ blocked: boolean }> {
    if (await checkLegacyAi()) return { blocked: true };
    return { blocked: false };
  }

  /** Ownership gate for Moos: eligible state, open conversation, no staff owner. */
  async function checkOwnership(conversationId: string): Promise<OwnershipCheck> {
    const repos = inboxRepos();
    const convo = await repos.conversations.getById(conversationId, COMPANY_ID);
    if (!convo) return { eligible: false, state: "UNKNOWN", conversationId };
    const state = String(convo.aiOwnershipState || "AI_SHADOW");
    const eligible =
      MOOS_ELIGIBLE_STATES.includes(state) &&
      !convo.assignedUserId &&
      MOOS_OPEN_STATUSES.includes(String(convo.status || "open"));
    return { eligible, state, conversationId };
  }

  /** Meta 24h free-form window gate, anchored on the latest inbound message. */
  async function freeFormOpen(conversationId: string): Promise<boolean> {
    const repos = inboxRepos();
    const latest = await repos.messages.getLatestInbound(conversationId, COMPANY_ID);
    return computeFreeFormEligibility(latest, Date.now()).freeFormAllowed;
  }

  router.get("/health", (_req, res) => {
    res.json({ ok: true, service: "moos-crm-api", moosEnabled: moosEnabled() });
  });

  /**
   * Approved, unexpired quotation library (metadata only).
   * The worker matches on this; it never downloads PDFs — /send-approved-pdf
   * fetches bytes server-side and sends the native document.
   */
  router.get("/approved-quotes", async (req: Request, res: Response) => {
    if (!authorized(req, res)) return;
    try {
      const capacityKwRaw = String(req.query.capacityKw || "");
      const capacityKw = capacityKwRaw ? Number(capacityKwRaw) : undefined;
      if (capacityKwRaw && !Number.isFinite(capacityKw)) {
        res.status(400).json({ error: "Invalid capacityKw" });
        return;
      }
      const systemTypeFilter = req.query.systemType
        ? String(req.query.systemType)
        : undefined;
      const { settings } = await loadSettings();
      const valid = currentApprovedQuotations(settings.quotations || []);
      const quotes = valid
        .filter(
          (q) =>
            (capacityKw === undefined || q.capacityKw === capacityKw) &&
            matchesSystemTypeFilter(
              q.systemType || inferSystemType(q.title || "", q.description || ""),
              systemTypeFilter
            )
        )
        .map((q) => ({
          id: q.id,
          title: q.title,
          description: q.description,
          capacityKw: q.capacityKw,
          systemType: q.systemType || inferSystemType(q.title || "", q.description || ""),
          phase: q.phase || null,
          batteryIncluded: q.batteryIncluded ?? null,
          expiresAt: q.expiresAt,
        }));
      res.json({ quotes });
    } catch (err) {
      console.error(
        "[moos] approved-quotes failed:",
        err instanceof Error ? err.message : String(err)
      );
      res.status(500).json({ error: "Could not load approved quotations" });
    }
  });

  /** Public equipment catalog (no prices exposed here; the pricing engine stays server-side). */
  router.get("/catalog", (req: Request, res: Response) => {
    if (!authorized(req, res)) return;
    res.json({
      panels: publicAgentCatalog.panels.map((p) => ({
        id: p.id,
        brand: p.brand,
        watts: p.watts,
      })),
      inverters: publicAgentCatalog.inverters.map((i) => ({
        id: i.id,
        brand: i.brand,
        model: i.model,
        capacityKw: i.capacityKw,
        phase: i.phase,
        voltageClass: i.voltageClass || null,
        bundleBatteryId: i.bundle?.batteryId || null,
        bundleBatteryQuantity: i.bundle?.batteryQuantity || null,
      })),
      batteries: publicAgentCatalog.batteries.map((b) => ({
        id: b.id,
        brand: b.brand,
        model: b.model,
        capacityKwh: b.capacityKwh,
        voltageClass: b.voltageClass || null,
        bundleOnly: Boolean(b.bundleOnly),
      })),
    });
  });

  /** Ownership state for a conversation. Unknown conversation fails closed (eligible: false). */
  router.get("/ownership", async (req: Request, res: Response) => {
    if (!authorized(req, res)) return;
    const conversationId = String(req.query.conversationId || "");
    if (!conversationId) {
      res.status(400).json({ error: "conversationId is required" });
      return;
    }
    try {
      const { eligible, state } = await checkOwnership(conversationId);
      res.json({ conversationId, state, humanOwned: !eligible });
    } catch (err) {
      console.error(
        "[moos] ownership failed:",
        err instanceof Error ? err.message : String(err)
      );
      // Fail closed: on error, treat as human-owned so the worker does not send.
      res.json({ conversationId, state: "ERROR", humanOwned: true });
    }
  });

  /** Send a plain-text reply through the canonical outbound path. */
  router.post("/send-text", async (req: Request, res: Response) => {
    if (!authorized(req, res)) return;
    if (!requireEnabled(res)) return;
    const body = jsonBody(req);
    const conversationId = String(body.conversationId || "");
    const text = String(body.text || "");
    const idempotencyKey = validIdempotencyKey(body.idempotencyKey);
    if (!conversationId || !text.trim() || !idempotencyKey) {
      res
        .status(400)
        .json({ error: "conversationId, text and idempotencyKey are required" });
      return;
    }
    const claimKey = `moos:${idempotencyKey}`;
    try {
      const ownership = await checkOwnership(conversationId);
      if (!ownership.eligible) {
        res
          .status(409)
          .json({ error: "Conversation is human-owned or closed", state: ownership.state });
        return;
      }
      // One approved recipient only in staging; derive number from CRM, never the worker.
      const testBundle = await conversationRepo().getConversationBundle(conversationId, COMPANY_ID);
      if (testBundle && !moosTestRecipientAllowed(testBundle.contact.phoneE164)) {
        res.status(403).json({ error: "Recipient is outside the approved Moos test scope" });
        return;
      }
      if (!testBundle) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      if (!(await freeFormOpen(conversationId))) {
        res.status(422).json({ error: "Outside the 24h customer-service window" });
        return;
      }
      const actor = await resolveActor();
      if (!actor) {
        res
          .status(503)
          .json({ error: "Moos send identity is not configured (MOOS_ACTOR_USERNAME)" });
        return;
      }
      const repos = inboxRepos();
      const claim = await repos.idempotency.claim({
        idempotencyKey: claimKey,
        conversationId,
        companyId: COMPANY_ID,
      });
      if (claim.kind !== "claimed") {
        res.status(409).json({ error: "Duplicate send suppressed" });
        return;
      }
      // Send-boundary mutual exclusion: re-read the legacy-agent switch fresh
      // (fail closed) immediately before Meta dispatch. A queued event must
      // not send after the legacy AI becomes enabled.
      const repo = conversationRepo();
      if ((await assertLegacyAiOff()).blocked) {
        await repos.idempotency.markFailedKnown({
          idempotencyKey: claimKey,
          conversationId,
          companyId: COMPANY_ID,
          error: "legacy_ai_active",
        });
        await safeAudit(repo, {
          eventType: "MOOS_SEND_SUPPRESSED_LEGACY_AI",
          entityType: "conversation",
          entityId: conversationId,
          metadata: { idempotencyKey: claimKey },
        });
        res
          .status(409)
          .json({ error: "Legacy WhatsApp AI agent is active; Moos yields the conversation" });
        return;
      }
      const checkedBundle = await conversationRepo().getConversationBundle(conversationId, COMPANY_ID);
      if (!checkedBundle || !moosTestRecipientAllowed(checkedBundle.contact.phoneE164)) {
        await repos.idempotency.markFailedKnown({
          idempotencyKey: claimKey, conversationId, companyId: COMPANY_ID, error: "recipient_out_of_test_scope",
        });
        res.status(403).json({ error: "Recipient is outside the approved Moos test scope" });
        return;
      }
      const result: OutboundSendResult = await sendOutboundText(conversationId, text, {
        repo,
        actor,
        clientIdempotencyKey: claimKey,
      });
      if (result.httpStatus === 201 && result.providerMessageId) {
        await repos.idempotency.markCompleted({
          idempotencyKey: claimKey,
          conversationId,
          companyId: COMPANY_ID,
          messageId: result.messageId,
        });
        res.json({ ok: true, providerMessageId: result.providerMessageId });
        return;
      }
      if (result.httpStatus !== 201) {
        if (
          result.httpStatus === 202 ||
          result.httpStatus === 504 ||
          result.providerOutcome === "accepted"
        ) {
          await repos.idempotency.markOutcomeUnknown({
            idempotencyKey: claimKey,
            conversationId,
            companyId: COMPANY_ID,
          });
          res
            .status(202)
            .json({ error: "Provider outcome unknown; not retried", status: result.status });
          return;
        }
        await repos.idempotency.markFailedKnown({
          idempotencyKey: claimKey,
          conversationId,
          companyId: COMPANY_ID,
          error: result.error || "send failed",
        });
        res.status(result.httpStatus).json({ error: result.error || "Send failed" });
        return;
      }
      // httpStatus 201 without a provider message id: accepted but
      // untrackable — outcome unknown, never retried.
      await repos.idempotency.markOutcomeUnknown({
        idempotencyKey: claimKey,
        conversationId,
        companyId: COMPANY_ID,
      });
      res
        .status(202)
        .json({ error: "Provider outcome unknown; not retried", status: result.status });
    } catch (err) {
      console.error(
        "[moos] send-text failed:",
        err instanceof Error ? err.message : String(err)
      );
      res.status(500).json({ error: "Send failed" });
    }
  });

  /**
   * Send an approved library PDF as a NATIVE WhatsApp document.
   * The CRM fetches the PDF bytes from object storage, uploads to Meta, and
   * sends type:document — the worker never sees bytes or credentials.
   */
  router.post("/send-approved-pdf", async (req: Request, res: Response) => {
    if (!authorized(req, res)) return;
    if (!requireEnabled(res)) return;
    const body = jsonBody(req);
    const conversationId = String(body.conversationId || "");
    const quoteId = String(body.quoteId || "");
    const idempotencyKey = validIdempotencyKey(body.idempotencyKey);
    if (!conversationId || !quoteId || !idempotencyKey) {
      res
        .status(400)
        .json({ error: "conversationId, quoteId and idempotencyKey are required" });
      return;
    }
    const claimKey = `moos:doc:${idempotencyKey}`;
    const repos = inboxRepos();
    const failKnown = async (error: string) => {
      try {
        await repos.idempotency.markFailedKnown({
          idempotencyKey: claimKey,
          conversationId,
          companyId: COMPANY_ID,
          error,
        });
      } catch {
        /* best effort */
      }
    };
    try {
      // 1. Re-validate the quote server-side: approved + unexpired, right now.
      const { settings } = await loadSettings();
      const quote = currentApprovedQuotations(settings.quotations || []).find(
        (q) => q.id === quoteId
      );
      if (!quote) {
        res.status(410).json({ error: "Quotation is not approved or has expired" });
        return;
      }
      // 2. Ownership + 24h window.
      const ownership = await checkOwnership(conversationId);
      if (!ownership.eligible) {
        res
          .status(409)
          .json({ error: "Conversation is human-owned or closed", state: ownership.state });
        return;
      }
      if (!(await freeFormOpen(conversationId))) {
        res.status(422).json({ error: "Outside the 24h customer-service window" });
        return;
      }
      // 3. Idempotency claim (atomic; duplicate suppresses).
      const claim = await repos.idempotency.claim({
        idempotencyKey: claimKey,
        conversationId,
        companyId: COMPANY_ID,
      });
      if (claim.kind !== "claimed") {
        res.status(409).json({ error: "Duplicate send suppressed" });
        return;
      }
      // 4. Fetch + validate PDF bytes from object storage.
      const pdfBytes = await fetchQuotePdf(quote.storagePath);
      if (!pdfBytes) {
        await failKnown("quote_pdf_missing");
        res.status(502).json({ error: "Quotation file is unavailable" });
        return;
      }
      const pdfError = validatePdfBytes(pdfBytes);
      if (pdfError) {
        await failKnown("quote_pdf_invalid");
        res.status(502).json({ error: `Quotation file invalid: ${pdfError}` });
        return;
      }
      // 5. Resolve the conversation's channel + contact (customer isolation:
      //    the document goes only to this conversation's contact).
      const repo = conversationRepo();
      const bundle = await repo.getConversationBundle(conversationId, COMPANY_ID);
      if (!bundle) {
        await failKnown("conversation_not_found");
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      if (!moosTestRecipientAllowed(bundle.contact.phoneE164)) {
        await failKnown("recipient_out_of_test_scope");
        res.status(403).json({ error: "Recipient is outside the approved Moos test scope" });
        return;
      }
      // 5b. Re-validate AFTER the (slow) PDF fetch: ownership or the legacy
      //     agent switch may have changed while bytes were being fetched.
      //     Either change blocks the send — no stale dispatch.
      const ownershipAfterFetch = await checkOwnership(conversationId);
      if (!ownershipAfterFetch.eligible) {
        await failKnown("ownership_changed_during_fetch");
        res.status(409).json({
          error: "Conversation ownership changed during send; dispatch cancelled",
          state: ownershipAfterFetch.state,
        });
        return;
      }
      if ((await assertLegacyAiOff()).blocked) {
        await failKnown("legacy_ai_active");
        await safeAudit(repo, {
          eventType: "MOOS_SEND_SUPPRESSED_LEGACY_AI",
          entityType: "conversation",
          entityId: conversationId,
          metadata: { idempotencyKey: claimKey, quoteId },
        });
        res.status(409).json({
          error: "Legacy WhatsApp AI agent became active during send; Moos yields the conversation",
        });
        return;
      }
      // 6. Upload media, then send the native document.
      const filename = `Sunchaser-${quote.capacityKw}kW-Quotation.pdf`;
      const caption = pdfCaption(quote.title, quote.capacityKw, quote.expiresAt);
      const delivery = await deliverDocument({
        conversationId,
        contactPhoneE164: bundle.contact.phoneE164,
        channelPhoneNumberId: bundle.channel.phoneNumberId,
        pdfBytes,
        filename,
        caption,
        quoteId,
      });
      if (delivery.ok === false) {
        if (delivery.kind === "timeout" || delivery.kind === "network") {
          await repos.idempotency.markOutcomeUnknown({
            idempotencyKey: claimKey,
            conversationId,
            companyId: COMPANY_ID,
          });
          res.status(202).json({
            error: "Provider outcome unknown; not retried",
            status: "outcome_unknown",
          });
          return;
        }
        await failKnown(delivery.error);
        const status = delivery.kind === "config" ? 503 : 502;
        res
          .status(status)
          .json({
            error:
              delivery.error === "channel_sender_mismatch"
                ? "Configured sender does not match conversation channel"
                : "WhatsApp could not deliver the document",
          });
        return;
      }
      // 7. Record in the CRM inbox (best-effort; the send already succeeded).
      try {
        if (!repo.insertHistoricalOutboundMessage) {
          throw new Error("insertHistoricalOutboundMessage not implemented");
        }
        await repo.insertHistoricalOutboundMessage({
          conversationId,
          waMessageId: delivery.providerMessageId,
          textBody: caption,
          occurredAt: new Date().toISOString(),
          status: "sent",
          messageType: "document",
          filename,
          caption,
          rawMetadata: { source: "moos-wa-agent", quoteId },
        });
        await repo.updateConversationLastMessageAt(
          conversationId,
          new Date().toISOString()
        );
      } catch (logErr) {
        await safeAudit(repo, {
          eventType: "moos_outbound_log_incomplete",
          entityType: "conversation",
          entityId: conversationId,
          metadata: {
            quoteId,
            providerMessageId: delivery.providerMessageId,
            error: String(logErr instanceof Error ? logErr.message : logErr).slice(0, 200),
          },
        });
      }
      await repos.idempotency.markCompleted({
        idempotencyKey: claimKey,
        conversationId,
        companyId: COMPANY_ID,
        messageId: delivery.providerMessageId,
      });
      res.json({ ok: true, providerMessageId: delivery.providerMessageId, quoteId });
    } catch (err) {
      console.error(
        "[moos] send-approved-pdf failed:",
        err instanceof Error ? err.message : String(err)
      );
      res.status(500).json({ error: "Document send failed" });
    }
  });

  /**
   * Build a custom Smart Quote draft via the server-side pricing engine
   * (calculateAgentQuote → lead → PDF → archive). The draft is NEVER auto-sent:
   * the worker replies with a holding message and hands off for staff review.
   *
   * Binding (P0): the draft is bound to a VERIFIED CRM conversation —
   * `conversationId` is required, the recipient phone is derived from the
   * CRM's conversation bundle (the worker can never name an arbitrary
   * recipient), and `inboundMessageId` must be a persisted inbound message of
   * that conversation. Ownership must permit Moos action. The idempotency
   * claim is bound to the verified conversation + wamid, so a replayed
   * request returns the already-created draft instead of generating a second.
   */
  router.post("/custom-quote-draft", async (req: Request, res: Response) => {
    if (!authorized(req, res)) return;
    if (!requireEnabled(res)) return;
    const body = jsonBody(req);
    const conversationId = String(body.conversationId || "");
    const inboundMessageId = String(body.inboundMessageId || "");
    const requirements = body.requirements as QuoteRequirements | undefined;
    if (!conversationId || !inboundMessageId) {
      res
        .status(400)
        .json({ error: "conversationId and inboundMessageId are required" });
      return;
    }
    if (!requirements || typeof requirements !== "object") {
      res.status(400).json({ error: "requirements are required" });
      return;
    }
    try {
      const repo = conversationRepo();
      // 1. Verified conversation — the contact (recipient) comes from the CRM
      //    bundle, never from the worker's request body.
      const bundle = await repo.getConversationBundle(conversationId, COMPANY_ID);
      if (!bundle) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      if (!moosTestRecipientAllowed(bundle.contact.phoneE164)) {
        res.status(403).json({ error: "Recipient is outside the approved Moos test scope" });
        return;
      }
      // 2. Ownership gate: drafts only for Moos-eligible conversations.
      const ownership = await checkOwnership(conversationId);
      if (!ownership.eligible) {
        res.status(409).json({
          error: "Conversation is human-owned or closed",
          state: ownership.state,
        });
        return;
      }
      // 3. The inbound wamid must be a persisted inbound message belonging to
      //    THIS conversation. Rejects unknown wamids and cross-conversation
      //    wamids (contact B smuggled via conversation A fails here).
      const inbound = await repo.getMessageByWaMessageId(inboundMessageId);
      if (
        !inbound ||
        inbound.companyId !== COMPANY_ID ||
        inbound.conversationId !== conversationId ||
        inbound.direction !== "inbound"
      ) {
        await safeAudit(repo, {
          eventType: "moos_draft_rejected",
          entityType: "conversation",
          entityId: conversationId,
          metadata: {
            reason: "unverified_inbound_message",
            inboundMessageId: inboundMessageId.slice(0, 80),
          },
        });
        res.status(422).json({
          error: "Inbound message could not be verified for this conversation",
        });
        return;
      }
      const phone = normalizePakistanMobile(bundle.contact.phoneE164);
      if (!phone) {
        res
          .status(422)
          .json({ error: "Conversation contact has no valid phone number" });
        return;
      }
      // 4. Idempotency bound to the verified conversation + wamid.
      const draftKey =
        `moos:draft:${conversationId}:` +
        inboundMessageId.replace(/[^A-Za-z0-9:_-]/g, "_").slice(0, 80);
      const repos = inboxRepos();
      const claim = await repos.idempotency.claim({
        idempotencyKey: draftKey,
        conversationId,
        companyId: COMPANY_ID,
      });
      if (claim.kind !== "claimed") {
        const existing = await repos.idempotency.getByKey(draftKey, COMPANY_ID);
        const draftId = existing?.messageId || null;
        if (draftId) {
          res.json({
            draftId,
            quoteNumber: draftId,
            status: "draft_pending_staff_approval",
            duplicate: true,
          });
          return;
        }
        res.status(409).json({ error: "Draft already in progress for this request" });
        return;
      }
      const created = await deps.createQuote(requirements, phone, inboundMessageId);
      await repos.idempotency.markCompleted({
        idempotencyKey: draftKey,
        conversationId,
        companyId: COMPANY_ID,
        messageId: created.quoteNumber,
      });
      await repo.insertAuditEvent({
        eventType: "moos_custom_quote_draft",
        entityType: "quotation",
        entityId: created.quoteNumber,
        metadata: {
          conversationId,
          inboundMessageId,
          phone,
          totalPkr: created.totalPkr,
          source: "moos-wa-agent",
          status: "draft_pending_staff_approval",
        },
      });
      res.json({
        draftId: created.quoteNumber,
        quoteNumber: created.quoteNumber,
        totalPkr: created.totalPkr,
        url: created.url,
        status: "draft_pending_staff_approval",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[moos] custom-quote-draft failed:", message.slice(0, 200));
      // Validation failures (calculateAgentQuote throws plain-language errors)
      // are 422s the worker turns into a human handoff — not 500s.
      res
        .status(422)
        .json({ error: message.slice(0, 500), status: "needs_human_review" });
    }
  });

  /**
   * Move a conversation to HUMAN_HANDLING.
   *
   * The ownership transition is compare-and-set on the conversation's
   * lockVersion with bounded reload-and-retry: a CAS conflict (another actor
   * moved the conversation concurrently) returns 409 instead of reporting a
   * failed transition as success. The handoff audit is emitted only after a
   * successful transition; an already-HUMAN_HANDLING conversation is an
   * idempotent success with updated:false.
   */
  router.post("/handoff", async (req: Request, res: Response) => {
    if (!authorized(req, res)) return;
    if (!requireEnabled(res)) return;
    const body = jsonBody(req);
    const conversationId = String(body.conversationId || "");
    const reason = String(body.reason || "moos_handoff").slice(0, 120);
    const summary = String(body.summary || "").slice(0, 2000);
    if (!conversationId) {
      res.status(400).json({ error: "conversationId is required" });
      return;
    }
    try {
      const repos = inboxRepos();
      const repo = conversationRepo();
      let current = await repos.conversations.getById(conversationId, COMPANY_ID);
      if (!current) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      const scopeBundle = await repo.getConversationBundle(conversationId, COMPANY_ID);
      if (!scopeBundle || !moosTestRecipientAllowed(scopeBundle.contact.phoneE164)) {
        res.status(403).json({ error: "Recipient is outside the approved Moos test scope" });
        return;
      }
      if (current.aiOwnershipState === "HUMAN_HANDLING") {
        res.json({ ok: true, state: "HUMAN_HANDLING", updated: false, already: true });
        return;
      }
      let transitioned = false;
      let previousState: string = String(current.aiOwnershipState || "");
      for (let attempt = 0; attempt < 3 && !transitioned; attempt++) {
        previousState = String(current.aiOwnershipState || "");
        const cas = await repos.conversations.compareAndSet(
          current.id,
          current.lockVersion,
          { companyId: COMPANY_ID, aiOwnershipState: "HUMAN_HANDLING" }
        );
        if (cas.ok === true) {
          transitioned = true;
          break;
        }
        if (cas.reason === "not_found" || !cas.current) {
          res.status(404).json({ error: "Conversation not found" });
          return;
        }
        // Version conflict: another actor moved the conversation. Reload and
        // retry with the fresh lockVersion (bounded).
        current = cas.current;
        if (current.aiOwnershipState === "HUMAN_HANDLING") {
          res.json({ ok: true, state: "HUMAN_HANDLING", updated: false, already: true });
          return;
        }
      }
      if (!transitioned) {
        res.status(409).json({
          error: "Conversation changed during handoff; please retry",
          state: String(current.aiOwnershipState || ""),
        });
        return;
      }
      await repo.insertAuditEvent({
        eventType: "moos_handoff",
        entityType: "conversation",
        entityId: conversationId,
        metadata: {
          reason,
          summary: summary || undefined,
          previousState,
        },
      });
      res.json({ ok: true, state: "HUMAN_HANDLING", updated: true });
    } catch (err) {
      console.error(
        "[moos] handoff failed:",
        err instanceof Error ? err.message : String(err)
      );
      res.status(500).json({ error: "Handoff failed" });
    }
  });

  return router;
}
