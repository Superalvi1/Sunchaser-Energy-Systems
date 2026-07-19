/**
 * Injected ports for inbox services (no CRM / user-directory coupling).
 */
import type { RequestActor } from "../middleware/actor.ts";
import type { WhatsAppCrmLinkEntityType } from "./whatsappInboxDatabaseTypes.ts";

export type InboxAssigneeCandidate = {
  id: string;
  role: string;
  accountStatus: string;
};

export type InboxAssigneeDirectory = {
  getById(userId: string): Promise<InboxAssigneeCandidate | null>;
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
