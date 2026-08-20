/**
 * Inbox API controllers (PR2 Step 4A).
 * Thin adapters: validate DTO → call service → map envelope. No business logic.
 */
import type { Request, Response } from "express";
import type { RequestActor } from "../middleware/actor.ts";
import {
  encodeInboxCursor,
  parseAiDraftBody,
  parseAssignBody,
  parseConversationIdBody,
  parseConversationIdParam,
  parseCreateLeadBody,
  parseCrmLinkBody,
  parseDeltaQuery,
  parseListConversationsQuery,
  parseListMessagesQuery,
  parseReadWatermarkBody,
  parseSendMessageBody,
  parseStatusBody,
  parseUnassignBody,
  isDtoErr,
} from "./whatsappInboxDtos.ts";
import { inboxFail, inboxOk, sendInboxError } from "./whatsappInboxHttp.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";
import type { WhatsAppInboxServices } from "./whatsappInboxServices.ts";
import {
  disconnectWhatsApp,
  generateEmbeddedSignupState,
  getWhatsAppConnectionStatus,
  processEmbeddedSignupOnboarding,
  testWhatsAppConnection,
} from "./whatsappConnectionService.ts";
import { getWhatsAppOnboardingDiagnostics } from "./whatsappOnboardingDiagnostics.ts";
import { DEFAULT_COMPANY_ID } from "./whatsappConstants.ts";
import {
  createWhatsAppInboxListAvailabilityResolver,
  type WhatsAppInboxListAvailabilityResolver,
  type WhatsAppQrListStatus,
} from "./whatsappInboxListAvailability.ts";
import {
  createInboxAiDraftAdapter,
  isAiDraftEnabled,
  readAiDraftConfig,
  type AiDraftConfig,
  type AiDraftOutcome,
  type InboxAiDraftAdapter,
} from "./aiDraft/index.ts";
import { canGenerateAiDraft } from "./whatsappInboxPermissions.ts";
import type { WhatsAppConversationInbox } from "./whatsappInboxDatabaseTypes.ts";
import { readQueryAgentConfig } from "./aiQueryAgent/queryAgentConfig.ts";

/**
 * Attach server-backed unread fields via batch watermark lookup.
 * Prefer ConversationService.list* which already enriches; this remains for
 * single-conversation detail responses.
 */
async function enrichConversationsWithUnread(
  rows: WhatsAppConversationInbox[],
  actor: RequestActor,
  services: WhatsAppInboxServices
): Promise<WhatsAppConversationInbox[]> {
  if (rows.length === 0) return rows;
  try {
    const unreadMap = await services.readState.batchUnreadState(
      rows.map((r) => r.id),
      actor
    );
    return rows.map((row) => {
      const state = unreadMap.get(row.id);
      return {
        ...row,
        unreadCount: state?.unreadCount ?? 0,
        isUnread: state?.isUnread ?? false,
      };
    });
  } catch {
    return rows.map((row) => ({ ...row, unreadCount: 0, isUnread: false }));
  }
}

/** Customer-safe draft payload — strips internal audit metadata/IDs. */
function toClientAiDraftPayload(outcome: AiDraftOutcome): Record<string, unknown> {
  if (outcome.status === "denied") {
    return {
      status: outcome.status,
      companyId: outcome.companyId,
      conversationId: outcome.conversationId,
      reasonCode: outcome.reasonCode,
      message: outcome.message,
      requiresHumanReview: true,
      autoSendBlocked: true,
      escalate: true,
      escalationReasons: outcome.escalationReasons,
    };
  }
  return {
    status: outcome.status,
    companyId: outcome.companyId,
    conversationId: outcome.conversationId,
    answer: outcome.answer,
    intent: outcome.intent,
    confidence: outcome.confidence,
    warnings: outcome.warnings,
    requiresHumanReview: true,
    autoSendBlocked: true,
    escalate: outcome.escalate,
    escalationReasons: outcome.escalationReasons,
    safeSources: outcome.safeSources,
  };
}

type AiDraftSafeOutcomeCode =
  | "timeout"
  | "provider_unavailable"
  | "internal_failure";

/** Strict allow-list for AI-draft failure logs — never echo provider codes. */
const AI_DRAFT_SAFE_OUTCOME_CODES: ReadonlySet<AiDraftSafeOutcomeCode> = new Set([
  "timeout",
  "provider_unavailable",
  "internal_failure",
]);

function aiDraftOutcomeCode(err: unknown): AiDraftSafeOutcomeCode {
  // Only our own timeout marker is trusted (set by raceAiDraftTimeout).
  // Never accept arbitrary provider-controlled alphanumeric err.code values.
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (code === "timeout") return "timeout";
  }
  if (err instanceof Error && /timed?\s*out/i.test(err.message)) {
    return "timeout";
  }
  // Unknown / provider-controlled codes collapse to a fixed safe bucket.
  if (err instanceof Error) return "provider_unavailable";
  return "internal_failure";
}

function logAiDraftGenerationFailure(outcomeCode: AiDraftSafeOutcomeCode): void {
  const safeCode: AiDraftSafeOutcomeCode = AI_DRAFT_SAFE_OUTCOME_CODES.has(
    outcomeCode
  )
    ? outcomeCode
    : "provider_unavailable";
  // Fixed event + allow-listed outcomeCode only — no conversationId, messages, or err.
  console.error("[ai-draft] generation failed", { outcomeCode: safeCode });
}

/**
 * Enforce a hard deadline even when the adapter ignores AbortSignal.
 * Cooperative adapters still receive the abort for early cancellation.
 */
function raceAiDraftTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  abort: AbortController
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      abort.abort();
      reject(
        Object.assign(new Error("AI draft generation timed out"), {
          code: "timeout",
        })
      );
    }, timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export type InboxSendPort = (input: {
  conversationId: string;
  text: string;
  actor: RequestActor;
}) => Promise<
  | { ok: true; messageId: string }
  | { ok: false; error: string; permanent?: boolean }
>;

function actorOf(req: Request): RequestActor {
  return req.actor as RequestActor;
}

function validationFail(
  res: Response,
  err: { message: string; field?: string }
) {
  return inboxFail(res, 400, "validation_error", err.message, {
    field: err.field,
  });
}

export type InboxControllerDeps = {
  /**
   * Outbound transport. Required when sendEnabled is true.
   * Checked before any idempotency claim.
   */
  sendPort?: InboxSendPort;
  /**
   * When false, POST /messages/send rejects with 503 before claiming.
   * Defaults to true only when a sendPort is provided.
   */
  sendEnabled?: boolean;
  /**
   * Legacy Meta connection status resolver (tests / connection panel API).
   * Also used as the Meta half of list availability when resolveListAvailability
   * is not provided.
   */
  getConnectionStatus?: typeof getWhatsAppConnectionStatus;
  /**
   * Optional WhatsApp Web QR status getter for list availability (tests).
   * Defaults to explicit DISCONNECTED when omitted.
   */
  getQrConnectionStatus?: () =>
    | WhatsAppQrListStatus
    | Promise<WhatsAppQrListStatus>;
  /**
   * Combined Meta + QR list availability. Prefer injecting this in production.
   */
  resolveListAvailability?: WhatsAppInboxListAvailabilityResolver;
  /**
   * AI-03 draft adapter. Defaults to mock (no live provider).
   * Must never be wired to InboxSendPort.
   */
  aiDraftAdapter?: InboxAiDraftAdapter;
  /** AI-03 config override (tests). */
  aiDraftConfig?: AiDraftConfig;
};

/**
 * Empty-list short-circuit removed (repair/whatsapp-inbox-persistence-reconnect).
 * Stored Supabase conversations must remain readable while WhatsApp is
 * DISCONNECTED / RECONNECTING / ERROR. Connection health is separate.
 */
export function createInboxControllers(
  services: WhatsAppInboxServices,
  deps: InboxControllerDeps = {}
) {
  const sendEnabled = deps.sendEnabled ?? deps.sendPort != null;
  const resolveConnectionStatus =
    deps.getConnectionStatus ?? getWhatsAppConnectionStatus;
  // Health resolver retained for DI/production wiring — never gates list/delta.
  const _listAvailabilityHealth =
    deps.resolveListAvailability ??
    createWhatsAppInboxListAvailabilityResolver({
      getMetaConnectionStatus: resolveConnectionStatus,
      getQrConnectionStatus: deps.getQrConnectionStatus,
    });
  void _listAvailabilityHealth;
  const aiDraftConfig = deps.aiDraftConfig ?? readAiDraftConfig();
  const aiDraftAdapter =
    deps.aiDraftAdapter ??
    createInboxAiDraftAdapter({ config: aiDraftConfig });

  return {
    async listConversations(req: Request, res: Response) {
      try {
        const parsed = parseListConversationsQuery(
          req.query as Record<string, unknown>
        );
        if (isDtoErr(parsed)) {
          return validationFail(res, parsed);
        }
        const actor = actorOf(req);
        const page = await services.conversations.listByActivity(
          actor,
          {
            status: parsed.value.status,
            assignedTo: parsed.value.assignedTo,
            channelId: parsed.value.channelId,
            hasFailedMessage: parsed.value.hasFailedMessage,
            quickFilter: parsed.value.quickFilter,
          },
          { cursor: parsed.value.cursor, limit: parsed.value.limit }
        );
        return inboxOk(res, { conversations: page.rows }, 200, {
          nextCursor: page.nextCursor
            ? encodeInboxCursor(page.nextCursor)
            : null,
          totalUnreadCount: page.totalUnreadCount,
        });
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    async getConversation(req: Request, res: Response) {
      try {
        const id = parseConversationIdParam(req.params.conversationId);
        if (isDtoErr(id)) {
          return validationFail(res, id);
        }
        const actor = actorOf(req);
        const detail = await services.conversations.getDetail(id.value, actor);
        const [conversation] = await enrichConversationsWithUnread(
          [detail.conversation],
          actor,
          services
        );
        return inboxOk(res, {
          ...detail,
          conversation: conversation ?? detail.conversation,
        });
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    async listMessages(req: Request, res: Response) {
      try {
        const id = parseConversationIdParam(req.params.conversationId);
        if (isDtoErr(id)) {
          return validationFail(res, id);
        }
        const parsed = parseListMessagesQuery(
          req.query as Record<string, unknown>
        );
        if (isDtoErr(parsed)) {
          return validationFail(res, parsed);
        }
        const page = await services.messages.listByConversation(
          id.value,
          actorOf(req),
          { before: parsed.value.before, limit: parsed.value.limit }
        );
        return inboxOk(res, { messages: page.rows }, 200, {
          nextCursor: page.nextCursor
            ? encodeInboxCursor(page.nextCursor)
            : null,
        });
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    async listDelta(req: Request, res: Response) {
      try {
        const parsed = parseDeltaQuery(req.query as Record<string, unknown>);
        if (isDtoErr(parsed)) {
          return validationFail(res, parsed);
        }
        const actor = actorOf(req);
        const page = await services.conversations.listDelta(
          actor,
          {
            status: parsed.value.status,
            assignedTo: parsed.value.assignedTo,
            channelId: parsed.value.channelId,
            hasFailedMessage: parsed.value.hasFailedMessage,
            quickFilter: parsed.value.quickFilter,
          },
          { since: parsed.value.since, limit: parsed.value.limit }
        );
        return inboxOk(res, { conversations: page.rows }, 200, {
          nextCursor: page.nextCursor
            ? encodeInboxCursor(page.nextCursor)
            : null,
          totalUnreadCount: page.totalUnreadCount,
        });
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    async sendMessage(req: Request, res: Response) {
      try {
        const parsed = parseSendMessageBody(req.body);
        if (isDtoErr(parsed)) {
          return validationFail(res, parsed);
        }

        // Feature-disabled / unconfigured: reject before any idempotency claim.
        if (!sendEnabled || !deps.sendPort) {
          return inboxFail(
            res,
            503,
            "send_unavailable",
            "Outbound send is not configured"
          );
        }

        const actor = actorOf(req);
        const begin = await services.messages.beginOutboundIdempotency({
          conversationId: parsed.value.conversationId,
          idempotencyKey: parsed.value.idempotencyKey,
          actor,
        });

        if (begin.kind === "replay_completed") {
          return inboxOk(res, {
            state: begin.row.state,
            messageId: begin.row.messageId,
            replay: true,
          });
        }
        if (begin.kind === "replay_failed") {
          return inboxOk(res, {
            state: begin.row.state,
            error: begin.row.error,
            replay: true,
          });
        }
        if (begin.kind === "processing") {
          return inboxFail(
            res,
            409,
            "idempotency_processing",
            "Request with this Idempotency-Key is still processing",
            { state: begin.row.state }
          );
        }
        if (begin.kind === "outcome_unknown") {
          return inboxFail(
            res,
            409,
            "idempotency_outcome_unknown",
            "Previous outcome for this Idempotency-Key is unknown",
            { state: begin.row.state }
          );
        }

        // claimed — every successful claim must reach a terminal state.
        const scope = {
          conversationId: parsed.value.conversationId,
          idempotencyKey: parsed.value.idempotencyKey,
        };
        let finalized = false;
        const finalizeFailedKnown = async (error: string) => {
          if (finalized) return;
          await services.messages.failOutboundIdempotency({
            ...scope,
            error,
          });
          finalized = true;
        };

        try {
          const sent = await deps.sendPort({
            conversationId: parsed.value.conversationId,
            text: parsed.value.text,
            actor,
          });
          if (sent.ok === false) {
            await finalizeFailedKnown(sent.error);
            return inboxFail(
              res,
              sent.permanent === false ? 502 : 400,
              "send_failed",
              sent.error
            );
          }

          const completed = await services.messages.completeOutboundIdempotency({
            ...scope,
            messageId: sent.messageId,
          });
          finalized = true;
          return inboxOk(
            res,
            {
              state: completed.state,
              messageId: completed.messageId,
              replay: false,
            },
            201
          );
        } catch (err) {
          try {
            await finalizeFailedKnown(
              err instanceof Error ? err.message : "send_pipeline_error"
            );
          } catch {
            // Best-effort finalize; original error is reported below.
          }
          return sendInboxError(res, err);
        }
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    async markRead(req: Request, res: Response) {
      try {
        const parsed = parseReadWatermarkBody(req.body);
        if (isDtoErr(parsed)) {
          return validationFail(res, parsed);
        }
        const result = await services.readState.resolveAndAdvance(
          parsed.value.conversationId,
          {
            actor: actorOf(req),
            lastSeenMessageId: parsed.value.lastSeenMessageId,
            lastSeenMessageCreatedAt: parsed.value.lastSeenMessageCreatedAt,
          }
        );
        return inboxOk(res, result);
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    async assign(req: Request, res: Response) {
      try {
        const parsed = parseAssignBody(req.body);
        if (isDtoErr(parsed)) {
          return validationFail(res, parsed);
        }
        const row = await services.assignments.setAssignment(
          parsed.value.conversationId,
          {
            assigneeUserId: parsed.value.assigneeUserId,
            actor: actorOf(req),
            expectedLockVersion: parsed.value.expectedLockVersion,
          }
        );
        return inboxOk(res, { conversation: row });
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    async unassign(req: Request, res: Response) {
      try {
        const parsed = parseUnassignBody(req.body);
        if (isDtoErr(parsed)) {
          return validationFail(res, parsed);
        }
        const row = await services.assignments.setAssignment(
          parsed.value.conversationId,
          {
            assigneeUserId: null,
            actor: actorOf(req),
            expectedLockVersion: parsed.value.expectedLockVersion,
          }
        );
        return inboxOk(res, { conversation: row });
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    async updateStatus(req: Request, res: Response) {
      try {
        const parsed = parseStatusBody(req.body);
        if (isDtoErr(parsed)) {
          return validationFail(res, parsed);
        }
        const row = await services.statuses.userTransition(
          parsed.value.conversationId,
          {
            toStatus: parsed.value.status,
            actor: actorOf(req),
            expectedLockVersion: parsed.value.expectedLockVersion,
          }
        );
        return inboxOk(res, { conversation: row });
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    async linkCrm(req: Request, res: Response) {
      try {
        const parsed = parseCrmLinkBody(req.body);
        if (isDtoErr(parsed)) {
          return validationFail(res, parsed);
        }
        const link = await services.crmLinks.link(parsed.value.conversationId, {
          actor: actorOf(req),
          linkedEntityType: parsed.value.linkedEntityType,
          linkedEntityId: parsed.value.linkedEntityId,
          replaceExisting: parsed.value.replaceExisting,
        });
        return inboxOk(res, { link });
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    async createLead(req: Request, res: Response) {
      try {
        const parsed = parseCreateLeadBody(req.body);
        if (isDtoErr(parsed)) {
          return validationFail(res, parsed);
        }
        const result = await services.crmLinks.createLeadFromConversation(
          parsed.value.conversationId,
          {
            actor: actorOf(req),
            forceCreate: parsed.value.forceCreate,
          }
        );
        return inboxOk(res, result, result.kind === "created" ? 201 : 200);
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    async unlinkCrm(req: Request, res: Response) {
      try {
        const parsed = parseConversationIdBody(req.body);
        if (isDtoErr(parsed)) {
          return validationFail(res, parsed);
        }
        const deleted = await services.crmLinks.unlink(
          parsed.value.conversationId,
          actorOf(req)
        );
        return inboxOk(res, { deleted });
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    async getConnectionStatus(req: Request, res: Response) {
      try {
        const payload = await getWhatsAppConnectionStatus();
        return inboxOk(res, payload);
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    /**
     * Step 0 of Embedded Signup: generate a CSRF state nonce.
     * Frontend must include this in the Facebook Login SDK options.state.
     */
    async generateEmbeddedSignupState(req: Request, res: Response) {
      try {
        const actor = actorOf(req);
        if (actor.role !== "Super Admin" && actor.role !== "Admin") {
          return inboxFail(res, 403, "forbidden", "Only Admin users can initiate WhatsApp onboarding.");
        }
        const companyId = DEFAULT_COMPANY_ID;
        const nonce = await generateEmbeddedSignupState(companyId, actor.id);
        return inboxOk(res, { state: nonce });
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    async processEmbeddedSignup(req: Request, res: Response) {
      try {
        const body = (req.body as Record<string, unknown>) || {};
        const code = String(body.code || "");
        const state = String(body.state || "");
        const wabaId = body.wabaId ? String(body.wabaId) : "";
        const phoneNumberId = body.phoneNumberId ? String(body.phoneNumberId) : "";
        const claimedBusinessId = body.businessId
          ? String(body.businessId)
          : body.claimedBusinessId
            ? String(body.claimedBusinessId)
            : "";
        const companyId = DEFAULT_COMPANY_ID;
        const payload = await processEmbeddedSignupOnboarding({
          code,
          state,
          wabaId,
          phoneNumberId,
          companyId,
          actor: actorOf(req),
          claimedBusinessId: claimedBusinessId || null,
        });
        return inboxOk(res, payload);
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    async disconnectWhatsApp(req: Request, res: Response) {
      try {
        const payload = await disconnectWhatsApp(actorOf(req));
        return inboxOk(res, payload);
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    async getOnboardingDiagnostics(req: Request, res: Response) {
      try {
        const actor = actorOf(req);
        if (actor.role !== "Super Admin" && actor.role !== "Admin") {
          return inboxFail(
            res,
            403,
            "forbidden",
            "Only Admin users can view WhatsApp onboarding diagnostics."
          );
        }
        const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https");
        const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
        const requestBaseUrl = host ? `${proto}://${host}` : undefined;
        const payload = await getWhatsAppOnboardingDiagnostics({
          requestBaseUrl,
        });
        return inboxOk(res, payload);
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    async testWhatsAppConnection(req: Request, res: Response) {
      try {
        const actor = actorOf(req);
        if (actor.role !== "Super Admin" && actor.role !== "Admin") {
          return inboxFail(
            res,
            403,
            "forbidden",
            "Only Admin users can test WhatsApp connection."
          );
        }
        const payload = await testWhatsAppConnection();
        return inboxOk(res, payload);
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    /**
     * Booleans-only AI draft config for UI status (never secrets/values).
     */
    async getAiDraftConfigStatus(req: Request, res: Response) {
      try {
        const actor = actorOf(req);
        if (!canGenerateAiDraft(actor)) {
          return inboxFail(res, 403, "forbidden", "AI draft access denied");
        }
        const queryCfg = readQueryAgentConfig();
        const geminiKeyConfigured = Boolean(
          String(process.env.GEMINI_API_KEY || "").trim()
        );
        return inboxOk(res, {
          draftFeatureEnabled: isAiDraftEnabled(aiDraftConfig),
          liveProviderEnabled: queryCfg.liveProviderEnabled === true,
          autoReplyEnabled: aiDraftConfig.autoReplyEnabled === true,
          geminiKeyConfigured,
        });
      } catch (err) {
        return sendInboxError(res, err);
      }
    },

    /**
     * AI-03: generate a human-reviewed draft. Never calls sendPort.
     * Automatic replies remain impossible in this phase.
     */
    async generateAiDraft(req: Request, res: Response) {
      try {
        const actor = actorOf(req);
        if (!canGenerateAiDraft(actor)) {
          return inboxFail(res, 403, "forbidden", "AI draft access denied");
        }

        if (!isAiDraftEnabled(aiDraftConfig)) {
          return inboxFail(
            res,
            503,
            "feature_disabled",
            "AI draft generation is disabled",
            {
              requiresHumanReview: true,
              autoSendBlocked: true,
            }
          );
        }

        const conversationId = parseConversationIdParam(
          req.params.conversationId
        );
        if (isDtoErr(conversationId)) {
          return validationFail(res, conversationId);
        }
        const parsed = parseAiDraftBody(req.body);
        if (isDtoErr(parsed)) {
          return validationFail(res, parsed);
        }

        // Load conversation for tenant isolation (and 404 if missing).
        // Does not trigger generation on conversation open — only this POST does.
        const detail = await services.conversations.getDetail(
          conversationId.value,
          actor
        );
        const conversation = detail.conversation;

        // Server-verified context: load stored inbound text under this conversation.
        // Browser messageText is intentionally ignored.
        const source = await services.messages.resolveAiDraftSourceMessage(
          conversation.id,
          actor,
          parsed.value.messageId
        );

        const controller = new AbortController();
        const timeoutMs = aiDraftConfig.timeoutMs;

        // Invariant: this handler must never call deps.sendPort / outbound.
        const outcome = await raceAiDraftTimeout(
          aiDraftAdapter.generateDraft({
            companyId: conversation.companyId || DEFAULT_COMPANY_ID,
            conversationId: conversation.id,
            conversationCompanyId: conversation.companyId || DEFAULT_COMPANY_ID,
            actorUserId: actor.id,
            messageText: source.messageText,
            messageId: source.messageId,
            locale: parsed.value.locale,
            abortSignal: controller.signal,
          }),
          timeoutMs,
          controller
        );

        if (outcome.status === "denied") {
          const status =
            outcome.reasonCode === "feature_disabled"
              ? 503
              : outcome.reasonCode === "tenant_mismatch"
                ? 403
                : outcome.reasonCode === "timeout" ||
                    outcome.reasonCode === "provider_unavailable" ||
                    outcome.reasonCode === "config_unavailable"
                  ? 503
                  : outcome.reasonCode === "rate_limited"
                    ? 429
                    : 422;
          const safe = toClientAiDraftPayload(outcome);
          return inboxFail(res, status, outcome.reasonCode, outcome.message, {
            status: safe.status,
            requiresHumanReview: true,
            autoSendBlocked: true,
            escalate: safe.escalate,
            escalationReasons: safe.escalationReasons,
          });
        }

        return inboxOk(res, toClientAiDraftPayload(outcome));
      } catch (err) {
        // Re-surface structured inbox errors (e.g. not_found for bad messageId).
        if (err instanceof InboxServiceError) {
          return sendInboxError(res, err);
        }

        // Provider/adapter failures: generic client message; allow-listed log only.
        const outcomeCode = aiDraftOutcomeCode(err);
        logAiDraftGenerationFailure(outcomeCode);
        if (outcomeCode === "timeout") {
          return inboxFail(
            res,
            503,
            "timeout",
            "AI draft generation timed out",
            {
              requiresHumanReview: true,
              autoSendBlocked: true,
            }
          );
        }
        return inboxFail(
          res,
          503,
          "provider_unavailable",
          "AI draft generation failed",
          {
            requiresHumanReview: true,
            autoSendBlocked: true,
          }
        );
      }
    },
  };
}

export type InboxControllers = ReturnType<typeof createInboxControllers>;
