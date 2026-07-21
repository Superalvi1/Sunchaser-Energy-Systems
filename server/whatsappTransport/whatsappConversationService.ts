/**
 * Conversation list/detail service (Revision 3).
 * Includes read-path self-heal reopen (P1-5).
 */
import type { RequestActor } from "../middleware/actor.ts";
import { DEFAULT_COMPANY_ID } from "./whatsappConstants.ts";
import type { StatusService } from "./whatsappConversationStatusService.ts";
import type {
  WhatsAppConversationCrmLink,
  WhatsAppConversationInbox,
} from "./whatsappInboxDatabaseTypes.ts";
import type {
  ConversationListFilters,
  ConversationListPage,
  WhatsAppInboxConversationRepository,
} from "./whatsappInboxConversationRepository.ts";
import type { WhatsAppInboxCrmLinkRepository } from "./whatsappInboxCrmLinkRepository.ts";
import {
  computeFreeFormEligibility,
  type FreeFormEligibility,
} from "./whatsappInboxFreeForm.ts";
import type { WhatsAppInboxMessageRepository } from "./whatsappInboxMessageRepository.ts";
import { canViewInbox } from "./whatsappInboxPermissions.ts";
import type { WhatsAppInboxStatusRepository } from "./whatsappInboxStatusRepository.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";
import type { KeysetCursor } from "./whatsappInboxRepoSupport.ts";

export type ConversationDetail = {
  conversation: WhatsAppConversationInbox;
  crmLink: WhatsAppConversationCrmLink | null;
  freeForm: FreeFormEligibility;
  selfHealed: boolean;
};

export class ConversationService {
  constructor(
    private readonly conversations: WhatsAppInboxConversationRepository,
    private readonly messages: WhatsAppInboxMessageRepository,
    private readonly statuses: WhatsAppInboxStatusRepository,
    private readonly crmLinks: WhatsAppInboxCrmLinkRepository,
    private readonly statusService: StatusService,
    private readonly companyId: string = DEFAULT_COMPANY_ID,
    private readonly now: () => number = Date.now
  ) {}

  async listByActivity(
    actor: RequestActor,
    filters: Omit<ConversationListFilters, "companyId"> = {},
    opts?: { cursor?: KeysetCursor | null; limit?: number }
  ): Promise<ConversationListPage> {
    this.assertViewer(actor);
    return this.conversations.listByActivity(
      { ...filters, companyId: this.companyId },
      opts
    );
  }

  async listDelta(
    actor: RequestActor,
    filters: Omit<ConversationListFilters, "companyId"> = {},
    opts: { since: KeysetCursor; limit?: number }
  ): Promise<ConversationListPage> {
    this.assertViewer(actor);
    return this.conversations.listDelta(
      { ...filters, companyId: this.companyId },
      opts
    );
  }

  async getDetail(
    conversationId: string,
    actor: RequestActor
  ): Promise<ConversationDetail> {
    this.assertViewer(actor);

    let conversation = await this.conversations.getById(
      conversationId,
      this.companyId
    );
    if (!conversation) {
      throw new InboxServiceError("not_found", "Conversation not found");
    }

    let selfHealed = false;
    if (conversation.status !== "open") {
      const latestInbound = await this.messages.getLatestInbound(
        conversationId,
        this.companyId
      );
      const latestStatus = await this.statuses.getLatest(
        conversationId,
        this.companyId
      );
      if (
        latestInbound &&
        (!latestStatus ||
          latestInbound.createdAt > latestStatus.createdAt)
      ) {
        conversation = await this.statusService.systemReopen(conversationId, {
          trigger: "read_path_reconciliation",
        });
        selfHealed = true;
      }
    }

    const latestInbound = await this.messages.getLatestInbound(
      conversationId,
      this.companyId
    );
    const freeForm = computeFreeFormEligibility(latestInbound, this.now());
    const crmLink = await this.crmLinks.getByConversationId(
      conversationId,
      this.companyId
    );

    return { conversation, crmLink, freeForm, selfHealed };
  }

  private assertViewer(actor: RequestActor): void {
    if (!canViewInbox(actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }
  }
}
