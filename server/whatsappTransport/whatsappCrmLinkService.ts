/**
 * CRM link + create-lead orchestration (Revision 3 + Step 3A).
 * Create-lead claims exclusivity before the external CRM callback.
 */
import type { RequestActor } from "../middleware/actor.ts";
import { DEFAULT_COMPANY_ID } from "./whatsappConstants.ts";
import type {
  WhatsAppConversationCrmLink,
  WhatsAppCrmLinkEntityType,
} from "./whatsappInboxDatabaseTypes.ts";
import type { WhatsAppInboxConversationRepository } from "./whatsappInboxConversationRepository.ts";
import type { WhatsAppInboxCrmLinkRepository } from "./whatsappInboxCrmLinkRepository.ts";
import {
  canCreateLeadFromConversation,
  canLinkCrm,
} from "./whatsappInboxPermissions.ts";
import {
  CREATE_LEAD_PENDING_ENTITY_ID,
  isPendingCreateLeadLink,
} from "./whatsappInboxRepoSupport.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";
import type {
  InboxCreateLeadCallback,
  InboxCrmDuplicateLookup,
} from "./whatsappInboxServicePorts.ts";

export type CreateLeadResult =
  | { kind: "created"; link: WhatsAppConversationCrmLink; leadId: string }
  | {
      kind: "duplicate_suggestion";
      suggestion: {
        linkedEntityType: WhatsAppCrmLinkEntityType;
        linkedEntityId: string;
      };
    };

function normalizeLeadId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === CREATE_LEAD_PENDING_ENTITY_ID) return null;
  return trimmed;
}

export class CRMLinkService {
  constructor(
    private readonly conversations: WhatsAppInboxConversationRepository,
    private readonly crmLinks: WhatsAppInboxCrmLinkRepository,
    private readonly deps: {
      createLead?: InboxCreateLeadCallback;
      findDuplicate?: InboxCrmDuplicateLookup;
    } = {},
    private readonly companyId: string = DEFAULT_COMPANY_ID
  ) {}

  async getLink(
    conversationId: string,
    actor: RequestActor
  ): Promise<WhatsAppConversationCrmLink | null> {
    if (!canLinkCrm(actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }
    await this.requireConversation(conversationId);
    const link = await this.crmLinks.getByConversationId(
      conversationId,
      this.companyId
    );
    // Pending create-lead claims are not exposed as established links.
    if (isPendingCreateLeadLink(link)) return null;
    return link;
  }

  async link(
    conversationId: string,
    input: {
      actor: RequestActor;
      linkedEntityType: WhatsAppCrmLinkEntityType;
      linkedEntityId: string;
      replaceExisting?: boolean;
    }
  ): Promise<WhatsAppConversationCrmLink> {
    if (!canLinkCrm(input.actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }
    const entityId = normalizeLeadId(input.linkedEntityId);
    if (!entityId) {
      throw new InboxServiceError(
        "invalid_argument",
        "linkedEntityId is required"
      );
    }
    await this.requireConversation(conversationId);

    const existing = await this.crmLinks.getByConversationId(
      conversationId,
      this.companyId
    );
    if (existing && !isPendingCreateLeadLink(existing) && !input.replaceExisting) {
      throw new InboxServiceError(
        "already_linked",
        "Conversation already has a CRM link",
        { existing }
      );
    }

    const link = await this.crmLinks.upsert({
      conversationId,
      linkedEntityType: input.linkedEntityType,
      linkedEntityId: entityId,
      linkedByUserId: input.actor.id,
      companyId: this.companyId,
    });
    await this.conversations.touchUpdatedAt(conversationId, this.companyId);
    return link;
  }

  async unlink(
    conversationId: string,
    actor: RequestActor
  ): Promise<boolean> {
    if (!canLinkCrm(actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }
    await this.requireConversation(conversationId);
    const deleted = await this.crmLinks.deleteByConversationId(
      conversationId,
      this.companyId
    );
    if (deleted) {
      await this.conversations.touchUpdatedAt(conversationId, this.companyId);
    }
    return deleted;
  }

  /**
   * Create a lead via injected CRM callback, then link.
   * Claims exclusivity with a pending row before calling the external callback
   * so concurrent requests cannot create two leads for one conversation.
   */
  async createLeadFromConversation(
    conversationId: string,
    input: {
      actor: RequestActor;
      forceCreate?: boolean;
    }
  ): Promise<CreateLeadResult> {
    if (!canCreateLeadFromConversation(input.actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }
    await this.requireConversation(conversationId);

    const existing = await this.crmLinks.getByConversationId(
      conversationId,
      this.companyId
    );
    if (existing && !isPendingCreateLeadLink(existing)) {
      throw new InboxServiceError(
        "already_linked",
        "Conversation already has a CRM link",
        { existing }
      );
    }
    if (isPendingCreateLeadLink(existing)) {
      throw new InboxServiceError(
        "conflict",
        "Lead creation already in progress for this conversation"
      );
    }

    if (!input.forceCreate && this.deps.findDuplicate) {
      const suggestion = await this.deps.findDuplicate({
        conversationId,
        companyId: this.companyId,
        actor: input.actor,
      });
      if (suggestion) {
        return { kind: "duplicate_suggestion", suggestion };
      }
    }

    if (!this.deps.createLead) {
      throw new InboxServiceError(
        "invalid_argument",
        "Create-lead callback is not configured"
      );
    }

    const claim = await this.crmLinks.insertIfAbsent({
      conversationId,
      linkedEntityType: "lead",
      linkedEntityId: CREATE_LEAD_PENDING_ENTITY_ID,
      linkedByUserId: input.actor.id,
      companyId: this.companyId,
    });
    if (claim.kind === "existing") {
      if (isPendingCreateLeadLink(claim.row)) {
        throw new InboxServiceError(
          "conflict",
          "Lead creation already in progress for this conversation"
        );
      }
      throw new InboxServiceError(
        "already_linked",
        "Conversation already has a CRM link",
        { existing: claim.row }
      );
    }

    try {
      const created = await this.deps.createLead({
        conversationId,
        companyId: this.companyId,
        actor: input.actor,
      });
      const leadId = normalizeLeadId(created?.leadId);
      if (!leadId) {
        throw new InboxServiceError(
          "invalid_argument",
          "Create-lead callback returned an invalid leadId"
        );
      }

      const link = await this.crmLinks.upsert({
        conversationId,
        linkedEntityType: "lead",
        linkedEntityId: leadId,
        linkedByUserId: input.actor.id,
        companyId: this.companyId,
      });
      await this.conversations.touchUpdatedAt(conversationId, this.companyId);
      return { kind: "created", link, leadId };
    } catch (err) {
      // Release the exclusivity claim so a later retry can proceed.
      await this.crmLinks.deleteByConversationId(
        conversationId,
        this.companyId
      );
      throw err;
    }
  }

  private async requireConversation(conversationId: string): Promise<void> {
    const row = await this.conversations.getById(
      conversationId,
      this.companyId
    );
    if (!row) {
      throw new InboxServiceError("not_found", "Conversation not found");
    }
  }
}
