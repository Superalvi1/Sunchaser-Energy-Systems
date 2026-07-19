/**
 * Inbound-only read watermark service (Revision 3 / P1-3).
 */
import type { RequestActor } from "../middleware/actor.ts";
import { DEFAULT_COMPANY_ID } from "./whatsappConstants.ts";
import type { WhatsAppReadWatermark } from "./whatsappInboxDatabaseTypes.ts";
import type { WhatsAppInboxConversationRepository } from "./whatsappInboxConversationRepository.ts";
import { canViewInbox } from "./whatsappInboxPermissions.ts";
import type { WhatsAppInboxReadWatermarkRepository } from "./whatsappInboxReadWatermarkRepository.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";

function isStrictlyNewerInbound(
  candidate: { createdAt: string; id: string },
  watermark: WhatsAppReadWatermark | null
): boolean {
  if (
    !watermark?.lastReadInboundMessageCreatedAt ||
    !watermark.lastReadInboundMessageId
  ) {
    return true;
  }
  if (candidate.createdAt > watermark.lastReadInboundMessageCreatedAt) {
    return true;
  }
  if (candidate.createdAt < watermark.lastReadInboundMessageCreatedAt) {
    return false;
  }
  return candidate.id > watermark.lastReadInboundMessageId;
}

export class ReadStateService {
  constructor(
    private readonly conversations: WhatsAppInboxConversationRepository,
    private readonly watermarks: WhatsAppInboxReadWatermarkRepository,
    private readonly companyId: string = DEFAULT_COMPANY_ID
  ) {}

  async resolveAndAdvance(
    conversationId: string,
    input: {
      actor: RequestActor;
      lastSeenMessageId: string;
      lastSeenMessageCreatedAt: string;
    }
  ): Promise<{
    watermark: WhatsAppReadWatermark;
    advanced: boolean;
  }> {
    if (!canViewInbox(input.actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }
    if (!input.lastSeenMessageId || !input.lastSeenMessageCreatedAt) {
      throw new InboxServiceError(
        "invalid_argument",
        "lastSeenMessageId and lastSeenMessageCreatedAt are required"
      );
    }

    const conversation = await this.conversations.getById(
      conversationId,
      this.companyId
    );
    if (!conversation) {
      throw new InboxServiceError("not_found", "Conversation not found");
    }

    const resolvedInbound = await this.watermarks.findLatestInboundAtOrBefore(
      conversationId,
      {
        at: input.lastSeenMessageCreatedAt,
        id: input.lastSeenMessageId,
      },
      this.companyId
    );

    const existing = await this.watermarks.get(
      conversationId,
      input.actor.id,
      this.companyId
    );

    if (!resolvedInbound) {
      // No inbound at-or-before the seen position — leave watermark unchanged.
      const watermark =
        existing ??
        (await this.watermarks.upsert({
          conversationId,
          userId: input.actor.id,
          lastReadInboundMessageId: null,
          lastReadInboundMessageCreatedAt: null,
          companyId: this.companyId,
        }));
      return { watermark, advanced: false };
    }

    if (!isStrictlyNewerInbound(resolvedInbound, existing)) {
      return { watermark: existing!, advanced: false };
    }

    const watermark = await this.watermarks.upsert({
      conversationId,
      userId: input.actor.id,
      lastReadInboundMessageId: resolvedInbound.id,
      lastReadInboundMessageCreatedAt: resolvedInbound.createdAt,
      companyId: this.companyId,
    });
    return { watermark, advanced: true };
  }

  async getUnreadCount(
    conversationId: string,
    actor: RequestActor
  ): Promise<number> {
    if (!canViewInbox(actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }
    const conversation = await this.conversations.getById(
      conversationId,
      this.companyId
    );
    if (!conversation) {
      throw new InboxServiceError("not_found", "Conversation not found");
    }
    return this.watermarks.countUnreadInbound(
      conversationId,
      actor.id,
      this.companyId
    );
  }

  async hasUnread(
    conversationId: string,
    actor: RequestActor
  ): Promise<boolean> {
    if (!canViewInbox(actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }
    return this.watermarks.hasUnreadInbound(
      conversationId,
      actor.id,
      this.companyId
    );
  }
}
