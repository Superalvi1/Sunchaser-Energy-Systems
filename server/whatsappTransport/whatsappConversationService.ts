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
  WhatsAppInboxConversationStatus,
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
import {
  activityAt,
  isBeforeKeyset,
  type KeysetCursor,
} from "./whatsappInboxRepoSupport.ts";
import type { ReadStateService } from "./whatsappReadStateService.ts";

export type InboxQuickFilter =
  | "all"
  | "unread"
  | "read"
  | "open"
  | "resolved"
  | "archived";

export type ConversationServiceListFilters = Omit<
  ConversationListFilters,
  "companyId"
> & {
  /** Server-side quick filter (Unread/Read/Open/Resolved/Archived). */
  quickFilter?: InboxQuickFilter;
  /** Explicit unread/read filter (takes precedence over quickFilter unread/read). */
  unreadState?: "unread" | "read";
};

export type ConversationListResult = ConversationListPage & {
  totalUnreadCount: number;
};

export type ConversationDetail = {
  conversation: WhatsAppConversationInbox;
  crmLink: WhatsAppConversationCrmLink | null;
  freeForm: FreeFormEligibility;
  selfHealed: boolean;
};

function resolveRepoFilters(
  filters: ConversationServiceListFilters
): ConversationListFilters & { unreadState?: "unread" | "read" } {
  const quick = filters.quickFilter ?? "all";
  let status = filters.status;
  let statuses = filters.statuses;
  let unreadState = filters.unreadState;

  if (!unreadState && !status && !statuses) {
    switch (quick) {
      case "open":
        statuses = ["open", "pending"];
        break;
      case "resolved":
        status = "resolved";
        break;
      case "archived":
        status = "archived";
        break;
      case "unread":
        unreadState = "unread";
        break;
      case "read":
        unreadState = "read";
        break;
      case "all":
      default:
        break;
    }
  } else if (!unreadState) {
    switch (quick) {
      case "unread":
        unreadState = "unread";
        break;
      case "read":
        unreadState = "read";
        break;
      default:
        break;
    }
  }

  return {
    status,
    statuses,
    assignedTo: filters.assignedTo,
    channelId: filters.channelId,
    hasFailedMessage: filters.hasFailedMessage,
    unreadState,
  };
}

export class ConversationService {
  constructor(
    private readonly conversations: WhatsAppInboxConversationRepository,
    private readonly messages: WhatsAppInboxMessageRepository,
    private readonly statuses: WhatsAppInboxStatusRepository,
    private readonly crmLinks: WhatsAppInboxCrmLinkRepository,
    private readonly statusService: StatusService,
    private readonly readState: ReadStateService,
    private readonly companyId: string = DEFAULT_COMPANY_ID,
    private readonly now: () => number = Date.now
  ) {}

  async listByActivity(
    actor: RequestActor,
    filters: ConversationServiceListFilters = {},
    opts?: { cursor?: KeysetCursor | null; limit?: number }
  ): Promise<ConversationListResult> {
    this.assertViewer(actor);
    const resolved = resolveRepoFilters(filters);
    const page = resolved.unreadState
      ? await this.listWithUnreadFilter(actor, resolved, opts)
      : await this.conversations.listByActivity(
          {
            companyId: this.companyId,
            status: resolved.status,
            statuses: resolved.statuses,
            assignedTo: resolved.assignedTo,
            channelId: resolved.channelId,
            hasFailedMessage: resolved.hasFailedMessage,
          },
          opts
        );

    const enriched = await this.enrichRows(page.rows, actor);
    const totalUnreadCount =
      await this.readState.countUnreadConversations(actor);
    return {
      rows: enriched,
      nextCursor: page.nextCursor,
      totalUnreadCount,
    };
  }

  async listDelta(
    actor: RequestActor,
    filters: ConversationServiceListFilters = {},
    opts: { since: KeysetCursor; limit?: number }
  ): Promise<ConversationListResult> {
    this.assertViewer(actor);
    const resolved = resolveRepoFilters(filters);

    let page: ConversationListPage;
    if (resolved.unreadState) {
      const delta = await this.conversations.listDelta(
        {
          companyId: this.companyId,
          status: resolved.status,
          statuses: resolved.statuses,
          assignedTo: resolved.assignedTo,
          channelId: resolved.channelId,
          hasFailedMessage: resolved.hasFailedMessage,
        },
        opts
      );
      const unreadMap = await this.readState.batchUnreadState(
        delta.rows.map((r) => r.id),
        actor
      );
      const wantUnread = resolved.unreadState === "unread";
      page = {
        rows: delta.rows.filter(
          (row) => (unreadMap.get(row.id)?.isUnread ?? false) === wantUnread
        ),
        nextCursor: delta.nextCursor,
      };
    } else {
      page = await this.conversations.listDelta(
        {
          companyId: this.companyId,
          status: resolved.status,
          statuses: resolved.statuses,
          assignedTo: resolved.assignedTo,
          channelId: resolved.channelId,
          hasFailedMessage: resolved.hasFailedMessage,
        },
        opts
      );
    }

    const enriched = await this.enrichRows(page.rows, actor);
    const totalUnreadCount =
      await this.readState.countUnreadConversations(actor);
    return {
      rows: enriched,
      nextCursor: page.nextCursor,
      totalUnreadCount,
    };
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
        (!latestStatus || latestInbound.createdAt > latestStatus.createdAt)
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

  /**
   * Unread/Read keyset page using the short-lived unread index.
   * Warm path: conversation activity scan + map lookups only (no message history).
   * Cold path: index build batches watermark/message work once, then serves pages.
   */
  private async listWithUnreadFilter(
    actor: RequestActor,
    filters: ConversationListFilters & { unreadState?: "unread" | "read" },
    opts?: { cursor?: KeysetCursor | null; limit?: number }
  ): Promise<ConversationListPage> {
    const limit = Math.max(1, Math.min(100, opts?.limit ?? 40));
    const cursor = opts?.cursor ?? null;
    const wantUnread = filters.unreadState === "unread";
    const index = await this.readState.getOrBuildUnreadIndex(actor);

    const matches: WhatsAppConversationInbox[] = [];
    let scanCursor: KeysetCursor | null = null;

    for (;;) {
      const page = await this.conversations.listByActivity(
        {
          companyId: this.companyId,
          status: filters.status,
          statuses: filters.statuses,
          assignedTo: filters.assignedTo,
          channelId: filters.channelId,
          hasFailedMessage: filters.hasFailedMessage,
        },
        { cursor: scanCursor, limit: 100 }
      );

      const missingIds = page.rows
        .map((r) => r.id)
        .filter((id) => !index.byId.has(id));
      if (missingIds.length > 0) {
        const fetched = await this.readState.batchUnreadState(missingIds, actor);
        for (const [id, state] of fetched) {
          index.byId.set(id, state);
          if (state.isUnread) index.totalUnreadCount += 1;
        }
      }

      for (const row of page.rows) {
        const state = index.byId.get(row.id) ?? {
          isUnread: false,
          unreadCount: 0,
        };
        if (state.isUnread !== wantUnread) continue;
        if (cursor && !isBeforeKeyset(activityAt(row), row.id, cursor)) {
          continue;
        }
        matches.push(row);
        if (matches.length > limit) break;
      }

      if (matches.length > limit) break;
      if (!page.nextCursor) break;
      scanCursor = page.nextCursor;
    }

    const pageRows = matches.slice(0, limit);
    const last = pageRows[pageRows.length - 1];
    return {
      rows: pageRows,
      nextCursor:
        matches.length > limit && last
          ? { at: activityAt(last), id: last.id }
          : null,
    };
  }

  private async enrichRows(
    rows: WhatsAppConversationInbox[],
    actor: RequestActor
  ): Promise<WhatsAppConversationInbox[]> {
    if (rows.length === 0) return rows;
    const unreadMap = await this.readState.batchUnreadState(
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
  }

  private assertViewer(actor: RequestActor): void {
    if (!canViewInbox(actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }
  }
}

export type { WhatsAppInboxConversationStatus };
