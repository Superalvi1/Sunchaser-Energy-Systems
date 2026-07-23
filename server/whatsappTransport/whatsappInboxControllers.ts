/**
 * Inbox API controllers (PR2 Step 4A).
 * Thin adapters: validate DTO → call service → map envelope. No business logic.
 */
import type { Request, Response } from "express";
import type { RequestActor } from "../middleware/actor.ts";
import {
  encodeInboxCursor,
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
   * Connection status resolver (tests). Defaults to getWhatsAppConnectionStatus.
   */
  getConnectionStatus?: typeof getWhatsAppConnectionStatus;
};

/**
 * Empty-list short-circuit only when status lookup succeeds with DISCONNECTED.
 * Lookup failures must not masquerade as disconnected — fall through to the
 * normal repository/RPC path so connected-system errors (e.g. missing RPC)
 * still surface.
 */
async function isWhatsAppDisconnectedForList(
  getStatus: typeof getWhatsAppConnectionStatus
): Promise<boolean> {
  try {
    const status = await getStatus(DEFAULT_COMPANY_ID);
    return status.status === "DISCONNECTED";
  } catch {
    return false;
  }
}

export function createInboxControllers(
  services: WhatsAppInboxServices,
  deps: InboxControllerDeps = {}
) {
  const sendEnabled = deps.sendEnabled ?? deps.sendPort != null;
  const resolveConnectionStatus =
    deps.getConnectionStatus ?? getWhatsAppConnectionStatus;

  return {
    async listConversations(req: Request, res: Response) {
      try {
        const parsed = parseListConversationsQuery(
          req.query as Record<string, unknown>
        );
        if (isDtoErr(parsed)) {
          return validationFail(res, parsed);
        }
        if (await isWhatsAppDisconnectedForList(resolveConnectionStatus)) {
          return inboxOk(res, { conversations: [] }, 200, {
            nextCursor: null,
          });
        }
        const page = await services.conversations.listByActivity(
          actorOf(req),
          {
            status: parsed.value.status,
            assignedTo: parsed.value.assignedTo,
            channelId: parsed.value.channelId,
            hasFailedMessage: parsed.value.hasFailedMessage,
          },
          { cursor: parsed.value.cursor, limit: parsed.value.limit }
        );
        return inboxOk(res, { conversations: page.rows }, 200, {
          nextCursor: page.nextCursor
            ? encodeInboxCursor(page.nextCursor)
            : null,
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
        const detail = await services.conversations.getDetail(
          id.value,
          actorOf(req)
        );
        return inboxOk(res, detail);
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
        if (await isWhatsAppDisconnectedForList(resolveConnectionStatus)) {
          return inboxOk(res, { conversations: [] }, 200, {
            nextCursor: null,
          });
        }
        const page = await services.conversations.listDelta(
          actorOf(req),
          {
            status: parsed.value.status,
            assignedTo: parsed.value.assignedTo,
            channelId: parsed.value.channelId,
            hasFailedMessage: parsed.value.hasFailedMessage,
          },
          { since: parsed.value.since, limit: parsed.value.limit }
        );
        return inboxOk(res, { conversations: page.rows }, 200, {
          nextCursor: page.nextCursor
            ? encodeInboxCursor(page.nextCursor)
            : null,
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
        const companyId = DEFAULT_COMPANY_ID;
        const payload = await processEmbeddedSignupOnboarding({
          code,
          state,
          wabaId,
          phoneNumberId,
          companyId,
          actor: actorOf(req),
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
  };
}

export type InboxControllers = ReturnType<typeof createInboxControllers>;
