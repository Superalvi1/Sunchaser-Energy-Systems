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
      let candidate;
      try {
        candidate = await this.assignees.getById(
          input.assigneeUserId,
          current.companyId
        );
      } catch (err) {
        if (err instanceof InboxServiceError) throw err;
        throw new InboxServiceError(
          "service_unavailable",
          "Assignee directory unavailable"
        );
      }
      if (!candidate) {
        throw new InboxServiceError("invalid_argument", "Assignee not found");
      }
      if (candidate.companyId !== current.companyId) {
        throw new InboxServiceError(
          "forbidden",
          "Assignee belongs to a different company"
        );
      }
      if (candidate.accountStatus !== "Approved") {
        throw new InboxServiceError(
          "invalid_argument",
          "Assignee must be an Approved staff member"
        );
      }
      if (!roleHasPermission(candidate.role, "crm_leads")) {
        throw new InboxServiceError(
          "invalid_argument",
          "Assignee must have crm_leads permission"
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
    if (cas.ok === false) {
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
