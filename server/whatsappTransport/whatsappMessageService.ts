/**
 * Message + outbound idempotency business rules (Revision 3 + Step 3A).
 * No Graph/Meta/Express — repositories + StatusService side-effects only.
 */
import type { RequestActor } from "../middleware/actor.ts";
import { DEFAULT_COMPANY_ID } from "./whatsappConstants.ts";
import type { StatusService } from "./whatsappConversationStatusService.ts";
import type { WhatsAppOutboundIdempotencyKey } from "./whatsappInboxDatabaseTypes.ts";
import type { WhatsAppInboxConversationRepository } from "./whatsappInboxConversationRepository.ts";
import {
  computeFreeFormEligibility,
  type FreeFormEligibility,
} from "./whatsappInboxFreeForm.ts";
import type { WhatsAppInboxIdempotencyRepository } from "./whatsappInboxIdempotencyRepository.ts";
import type {
  MessageListPage,
  WhatsAppInboxMessageRepository,
} from "./whatsappInboxMessageRepository.ts";
import { canViewInbox } from "./whatsappInboxPermissions.ts";
import type { InboxMessageRef, KeysetCursor } from "./whatsappInboxRepoSupport.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";

/** Staleness threshold for processing → outcome_unknown (Rev3 ~30s). */
export const IDEMPOTENCY_PROCESSING_STALE_MS = 30_000;

export type IdempotencyBeginResult =
  | { kind: "claimed"; row: WhatsAppOutboundIdempotencyKey }
  | { kind: "replay_completed"; row: WhatsAppOutboundIdempotencyKey }
  | { kind: "replay_failed"; row: WhatsAppOutboundIdempotencyKey }
  | { kind: "processing"; row: WhatsAppOutboundIdempotencyKey }
  | { kind: "outcome_unknown"; row: WhatsAppOutboundIdempotencyKey };

export class MessageService {
  constructor(
    private readonly conversations: WhatsAppInboxConversationRepository,
    private readonly messages: WhatsAppInboxMessageRepository,
    private readonly idempotency: WhatsAppInboxIdempotencyRepository,
    private readonly statusService: StatusService,
    private readonly companyId: string = DEFAULT_COMPANY_ID,
    private readonly now: () => number = Date.now
  ) {}

  async getById(
    messageId: string,
    actor: RequestActor
  ): Promise<InboxMessageRef> {
    this.assertViewer(actor);
    const row = await this.messages.getById(messageId, this.companyId);
    if (!row) {
      throw new InboxServiceError("not_found", "Message not found");
    }
    return row;
  }

  /**
   * AI-03: resolve authoritative inbound text for draft generation.
   * Browser-supplied messageText is never trusted — only stored rows under the
   * authorized conversation/tenant are used. When messageId is omitted, the
   * latest eligible inbound message is selected server-side.
   */
  async resolveAiDraftSourceMessage(
    conversationId: string,
    actor: RequestActor,
    messageId?: string
  ): Promise<{ messageId: string; messageText: string }> {
    this.assertViewer(actor);
    await this.requireConversation(conversationId);

    if (messageId) {
      const row = await this.messages.getById(messageId, this.companyId);
      if (!row || row.conversationId !== conversationId) {
        // Same response for missing vs cross-conversation — avoid ID oracle.
        throw new InboxServiceError("not_found", "Message not found");
      }
      if (row.direction !== "inbound") {
        throw new InboxServiceError(
          "invalid_argument",
          "AI draft requires an inbound customer message"
        );
      }
      const text = row.textBody?.trim();
      if (!text) {
        throw new InboxServiceError(
          "invalid_argument",
          "Message has no text available for AI draft"
        );
      }
      return { messageId: row.id, messageText: text };
    }

    const latest = await this.messages.getLatestInbound(
      conversationId,
      this.companyId
    );
    if (!latest) {
      throw new InboxServiceError(
        "not_found",
        "No inbound message available for AI draft"
      );
    }
    const text = latest.textBody?.trim();
    if (!text) {
      throw new InboxServiceError(
        "invalid_argument",
        "Latest inbound message has no text available for AI draft"
      );
    }
    return { messageId: latest.id, messageText: text };
  }

  async listByConversation(
    conversationId: string,
    actor: RequestActor,
    opts?: { before?: KeysetCursor | null; limit?: number }
  ): Promise<MessageListPage> {
    this.assertViewer(actor);
    await this.requireConversation(conversationId);
    return this.messages.listByConversation(conversationId, {
      companyId: this.companyId,
      before: opts?.before,
      limit: opts?.limit,
    });
  }

  async getFreeFormEligibility(
    conversationId: string,
    actor?: RequestActor
  ): Promise<FreeFormEligibility> {
    if (actor) this.assertViewer(actor);
    await this.requireConversation(conversationId);
    const latestInbound = await this.messages.getLatestInbound(
      conversationId,
      this.companyId
    );
    return computeFreeFormEligibility(latestInbound, this.now());
  }

  async assertFreeFormAllowed(conversationId: string): Promise<void> {
    const eligibility = await this.getFreeFormEligibility(conversationId);
    if (!eligibility.freeFormAllowed) {
      throw new InboxServiceError(
        "free_form_closed",
        "Free-form messaging window is closed",
        { windowExpiresAt: eligibility.windowExpiresAt }
      );
    }
  }

  /**
   * Atomic claim + repeat-request resolution for outbound idempotency.
   * Terminal replays are resolved before the free-form window check (P2).
   */
  async beginOutboundIdempotency(input: {
    conversationId: string;
    idempotencyKey: string;
    actor: RequestActor;
    enforceFreeForm?: boolean;
  }): Promise<IdempotencyBeginResult> {
    this.assertViewer(input.actor);
    if (!input.idempotencyKey?.trim()) {
      throw new InboxServiceError(
        "invalid_argument",
        "Idempotency-Key is required"
      );
    }
    await this.requireConversation(input.conversationId);
    const key = input.idempotencyKey.trim();

    const existing = await this.idempotency.getByKey(key, this.companyId);
    if (existing) {
      this.assertIdempotencyScope(existing, input.conversationId);
      const replay = await this.resolveExistingIdempotency(
        existing,
        input.conversationId
      );
      if (replay) return replay;
    }

    if (input.enforceFreeForm !== false) {
      await this.assertFreeFormAllowed(input.conversationId);
    }

    const claim = await this.idempotency.claim({
      idempotencyKey: key,
      conversationId: input.conversationId,
      companyId: this.companyId,
      createdAt: new Date(this.now()).toISOString(),
    });

    if (claim.kind === "claimed") {
      return { kind: "claimed", row: claim.row };
    }

    this.assertIdempotencyScope(claim.row, input.conversationId);
    const resolved = await this.resolveExistingIdempotency(
      claim.row,
      input.conversationId
    );
    if (resolved) return resolved;
    return { kind: "processing", row: claim.row };
  }

  async completeOutboundIdempotency(input: {
    conversationId: string;
    idempotencyKey: string;
    messageId: string;
  }): Promise<WhatsAppOutboundIdempotencyKey> {
    const existing = await this.idempotency.getByKey(
      input.idempotencyKey,
      this.companyId
    );
    if (!existing) {
      throw new InboxServiceError(
        "conflict",
        "Idempotency key is not in processing state"
      );
    }
    this.assertIdempotencyScope(existing, input.conversationId);

    const row = await this.idempotency.markCompleted({
      idempotencyKey: input.idempotencyKey,
      messageId: input.messageId,
      conversationId: input.conversationId,
      companyId: this.companyId,
    });
    if (!row) {
      throw new InboxServiceError(
        "conflict",
        "Idempotency key is not in processing state"
      );
    }
    this.assertIdempotencyScope(row, input.conversationId);

    await this.conversations.setHasFailedMessage(
      input.conversationId,
      false,
      this.companyId
    );
    await this.statusService.autoOpenOnSuccessfulReply(input.conversationId);
    return row;
  }

  async failOutboundIdempotency(input: {
    conversationId: string;
    idempotencyKey: string;
    error: string | null;
  }): Promise<WhatsAppOutboundIdempotencyKey> {
    const existing = await this.idempotency.getByKey(
      input.idempotencyKey,
      this.companyId
    );
    if (!existing) {
      throw new InboxServiceError(
        "conflict",
        "Idempotency key is not in processing state"
      );
    }
    this.assertIdempotencyScope(existing, input.conversationId);

    const row = await this.idempotency.markFailedKnown({
      idempotencyKey: input.idempotencyKey,
      error: input.error,
      conversationId: input.conversationId,
      companyId: this.companyId,
    });
    if (!row) {
      throw new InboxServiceError(
        "conflict",
        "Idempotency key is not in processing state"
      );
    }
    this.assertIdempotencyScope(row, input.conversationId);

    await this.conversations.setHasFailedMessage(
      input.conversationId,
      true,
      this.companyId
    );
    return row;
  }

  private async resolveExistingIdempotency(
    row: WhatsAppOutboundIdempotencyKey,
    conversationId: string
  ): Promise<IdempotencyBeginResult | null> {
    if (row.state === "completed") {
      return { kind: "replay_completed", row };
    }
    if (row.state === "failed_known") {
      return { kind: "replay_failed", row };
    }
    if (row.state === "outcome_unknown") {
      return { kind: "outcome_unknown", row };
    }

    // processing
    const ageMs = this.now() - Date.parse(row.createdAt);
    if (Number.isFinite(ageMs) && ageMs > IDEMPOTENCY_PROCESSING_STALE_MS) {
      const unknown = await this.idempotency.markOutcomeUnknown({
        idempotencyKey: row.idempotencyKey,
        conversationId,
        companyId: this.companyId,
      });
      const finalRow =
        unknown ??
        (await this.idempotency.getByKey(row.idempotencyKey, this.companyId));
      if (!finalRow) {
        throw new InboxServiceError(
          "not_found",
          "Idempotency key disappeared during stale reclassification"
        );
      }
      this.assertIdempotencyScope(finalRow, conversationId);
      if (finalRow.state === "outcome_unknown") {
        await this.conversations.setHasFailedMessage(
          conversationId,
          true,
          this.companyId
        );
      }
      return { kind: "outcome_unknown", row: finalRow };
    }

    return { kind: "processing", row };
  }

  private assertIdempotencyScope(
    row: WhatsAppOutboundIdempotencyKey,
    conversationId: string
  ): void {
    if (
      row.conversationId !== conversationId ||
      row.companyId !== this.companyId
    ) {
      throw new InboxServiceError(
        "conflict",
        "Idempotency key does not belong to this conversation/company"
      );
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

  private assertViewer(actor: RequestActor): void {
    if (!canViewInbox(actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }
  }
}
