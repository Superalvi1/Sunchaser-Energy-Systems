/**
 * Injected ports for inbox services (no CRM / user-directory coupling).
 */
import type { RequestActor } from "../middleware/actor.ts";
import type { WhatsAppCrmLinkEntityType } from "./whatsappInboxDatabaseTypes.ts";

export type InboxAssigneeCandidate = {
  id: string;
  role: string;
  accountStatus: string;
  /** Company the user belongs to (single-tenant default when unset on user row). */
  companyId: string;
};

export type InboxAssigneeDirectory = {
  /**
   * Resolve assignee by user id scoped to the conversation company.
   * Returns null when the user does not exist, or when companyId is outside
   * the supported single-tenant DEFAULT_COMPANY_ID (users have no company_id).
   * Throws InboxServiceError(service_unavailable) on infrastructure failure.
   * Caller also enforces company match via candidate.companyId (defence in depth).
   */
  getById(
    userId: string,
    companyId: string
  ): Promise<InboxAssigneeCandidate | null>;
};

export type InboxCrmDuplicateSuggestion = {
  linkedEntityType: WhatsAppCrmLinkEntityType;
  linkedEntityId: string;
};

export type InboxCrmDuplicateLookup = (input: {
  conversationId: string;
  companyId: string;
  actor: RequestActor;
}) => Promise<InboxCrmDuplicateSuggestion | null>;

export type InboxCreateLeadCallback = (input: {
  conversationId: string;
  companyId: string;
  actor: RequestActor;
}) => Promise<{ leadId: string }>;
