/**
 * Conversation status state machine (Revision 3 + Step 3A).
 * All mutations use CAS; status+audit are applied atomically.
 */
import type { RequestActor } from "../middleware/actor.ts";
import { DEFAULT_COMPANY_ID } from "./whatsappConstants.ts";
import type {
  WhatsAppConversationInbox,
  WhatsAppInboxConversationStatus,
} from "./whatsappInboxDatabaseTypes.ts";
import type { WhatsAppInboxConversationRepository } from "./whatsappInboxConversationRepository.ts";
import {
  canArchiveConversation,
  canViewInbox,
} from "./whatsappInboxPermissions.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";

export type StatusSystemTrigger =
  | "webhook_callback"
  | "read_path_reconciliation";

const ALLOWED_TRANSITIONS: Record<
  WhatsAppInboxConversationStatus,
  ReadonlySet<WhatsAppInboxConversationStatus>
> = {
  open: new Set(["pending", "resolved", "archived"]),
  pending: new Set(["open", "resolved", "archived"]),
  resolved: new Set(["open", "archived"]),
  archived: new Set(["open"]),
};

const SYSTEM_CAS_RETRIES = 5;

export class StatusService {
  constructor(
    private readonly conversations: WhatsAppInboxConversationRepository,
    private readonly companyId: string = DEFAULT_COMPANY_ID
  ) {}

  async userTransition(
    conversationId: string,
    input: {
      toStatus: WhatsAppInboxConversationStatus;
      actor: RequestActor;
      expectedLockVersion: number;
    }
  ): Promise<WhatsAppConversationInbox> {
    if (!canViewInbox(input.actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }
    if (!(input.toStatus in ALLOWED_TRANSITIONS)) {
      throw new InboxServiceError(
        "invalid_argument",
        `Invalid status: ${String(input.toStatus)}`
      );
    }

    const current = await this.conversations.getById(
      conversationId,
      this.companyId
    );
    if (!current) {
      throw new InboxServiceError("not_found", "Conversation not found");
    }

    const fromStatus = current.status;
    if (fromStatus === input.toStatus) {
      throw new InboxServiceError(
        "invalid_transition",
        `Conversation is already ${fromStatus}`
      );
    }
    if (!ALLOWED_TRANSITIONS[fromStatus].has(input.toStatus)) {
      throw new InboxServiceError(
        "invalid_transition",
        `Cannot transition ${fromStatus} → ${input.toStatus}`
      );
    }

    const needsAdmin =
      input.toStatus === "archived" ||
      (fromStatus === "archived" && input.toStatus === "open");
    if (needsAdmin && !canArchiveConversation(input.actor)) {
      throw new InboxServiceError(
        "forbidden",
        "Archive / reopen-archived requires an admin-tier role"
      );
    }

    const cas = await this.conversations.applyStatusChangeAtomic({
      conversationId,
      expectedLockVersion: input.expectedLockVersion,
      toStatus: input.toStatus,
      fromStatus,
      changedByUserId: input.actor.id,
      metadata: { trigger: "user_transition" },
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

  /**
   * System reopen — no actor permission check, but CAS on current lock_version.
   * Preserves assignment columns. Idempotent when already open.
   */
  async systemReopen(
    conversationId: string,
    input: { trigger: StatusSystemTrigger }
  ): Promise<WhatsAppConversationInbox> {
    return this.casOpenWithRetries(conversationId, {
      allowFrom: (status) => status !== "open",
      noopWhen: (row) => row.status === "open",
      metadata: { trigger: input.trigger },
    });
  }

  /**
   * pending → open on successful outbound reply. CAS; no-op for other statuses.
   */
  async autoOpenOnSuccessfulReply(
    conversationId: string
  ): Promise<WhatsAppConversationInbox> {
    return this.casOpenWithRetries(conversationId, {
      allowFrom: (status) => status === "pending",
      noopWhen: (row) => row.status !== "pending",
      metadata: { trigger: "auto_open_on_successful_reply" },
    });
  }

  private async casOpenWithRetries(
    conversationId: string,
    opts: {
      allowFrom: (status: WhatsAppInboxConversationStatus) => boolean;
      noopWhen: (row: WhatsAppConversationInbox) => boolean;
      metadata: Record<string, unknown>;
    }
  ): Promise<WhatsAppConversationInbox> {
    for (let attempt = 0; attempt < SYSTEM_CAS_RETRIES; attempt += 1) {
      const current = await this.conversations.getById(
        conversationId,
        this.companyId
      );
      if (!current) {
        throw new InboxServiceError("not_found", "Conversation not found");
      }
      if (opts.noopWhen(current)) {
        return current;
      }
      if (!opts.allowFrom(current.status)) {
        return current;
      }

      const cas = await this.conversations.applyStatusChangeAtomic({
        conversationId,
        expectedLockVersion: current.lockVersion,
        toStatus: "open",
        fromStatus: current.status,
        changedByUserId: null,
        metadata: opts.metadata,
        companyId: this.companyId,
      });
      if (cas.ok) return cas.row;

      if (cas.reason === "not_found") {
        throw new InboxServiceError("not_found", "Conversation not found");
      }
      // conflict — another writer won; retry with fresh lock_version
    }

    const latest = await this.conversations.getById(
      conversationId,
      this.companyId
    );
    if (latest && opts.noopWhen(latest)) return latest;
    throw new InboxServiceError(
      "conflict",
      "Concurrent status update could not be applied",
      { current: latest }
    );
  }
}
