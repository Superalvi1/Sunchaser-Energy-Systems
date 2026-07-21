/**
 * Assignment service (Revision 3 + Step 3A).
 * OCC assignment + assignment-event insert are atomic.
 */
import { roleHasPermission } from "../../src/lib/roles.ts";
import type { RequestActor } from "../middleware/actor.ts";
import { DEFAULT_COMPANY_ID } from "./whatsappConstants.ts";
import type { WhatsAppConversationInbox } from "./whatsappInboxDatabaseTypes.ts";
import type { WhatsAppInboxConversationRepository } from "./whatsappInboxConversationRepository.ts";
import {
  canMutateAssignment,
  canReassignConversation,
} from "./whatsappInboxPermissions.ts";
import { nowIso } from "./whatsappInboxRepoSupport.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";
import type { InboxAssigneeDirectory } from "./whatsappInboxServicePorts.ts";

export class AssignmentService {
  constructor(
    private readonly conversations: WhatsAppInboxConversationRepository,
    private readonly assignees: InboxAssigneeDirectory,
    private readonly companyId: string = DEFAULT_COMPANY_ID
  ) {}

  async setAssignment(
    conversationId: string,
    input: {
      assigneeUserId: string | null;
      actor: RequestActor;
      expectedLockVersion: number;
    }
  ): Promise<WhatsAppConversationInbox> {
    if (!canMutateAssignment(input.actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }

    const current = await this.conversations.getById(
      conversationId,
      this.companyId
    );
    if (!current) {
      throw new InboxServiceError("not_found", "Conversation not found");
    }

    if (!canReassignConversation(input.actor, current.assignedUserId)) {
      throw new InboxServiceError(
        "forbidden",
        "Only the current assignee or an admin-tier role may reassign"
      );
    }

    if (input.assigneeUserId != null) {
      const candidate = await this.assignees.getById(input.assigneeUserId);
      if (
        !candidate ||
        candidate.accountStatus !== "Approved" ||
        !roleHasPermission(candidate.role, "crm_leads")
      ) {
        throw new InboxServiceError(
          "invalid_argument",
          "Assignee must be an Approved staff member with crm_leads"
        );
      }
    }

    if (current.assignedUserId === input.assigneeUserId) {
      if (current.lockVersion !== input.expectedLockVersion) {
        throw new InboxServiceError("conflict", "Stale lock_version", {
          current,
        });
      }
      return current;
    }

    const assignedAt = input.assigneeUserId == null ? null : nowIso();
    const cas = await this.conversations.applyAssignmentChangeAtomic({
      conversationId,
      expectedLockVersion: input.expectedLockVersion,
      assignedUserId: input.assigneeUserId,
      assignedAt,
      assignedBy: input.actor.id,
      companyId: this.companyId,
    });
    if (!cas.ok) {
      if (cas.reason === "not_found") {
        throw new InboxServiceError("not_found", "Conversation not found");
      }
      throw new InboxServiceError("conflict", "Stale lock_version", {
        current: cas.current,
      });
    }
    return cas.row;
  }
}
