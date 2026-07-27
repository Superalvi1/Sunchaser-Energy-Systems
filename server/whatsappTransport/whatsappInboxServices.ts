/**
 * PR 2 inbox service composition (Revision 3 + Step 3A).
 * Business-logic layer only — no routes / Supabase clients.
 */
import { DEFAULT_COMPANY_ID } from "./whatsappConstants.ts";
import { AssignmentService } from "./whatsappAssignmentService.ts";
import { ConversationService } from "./whatsappConversationService.ts";
import { StatusService } from "./whatsappConversationStatusService.ts";
import { CRMLinkService } from "./whatsappCrmLinkService.ts";
import type { WhatsAppInboxRepositories } from "./whatsappInboxRepository.ts";
import type {
  InboxAssigneeDirectory,
  InboxCreateLeadCallback,
  InboxCrmDuplicateLookup,
} from "./whatsappInboxServicePorts.ts";
import { MessageService } from "./whatsappMessageService.ts";
import { ReadStateService } from "./whatsappReadStateService.ts";

export type WhatsAppInboxServices = {
  conversations: ConversationService;
  messages: MessageService;
  readState: ReadStateService;
  assignments: AssignmentService;
  statuses: StatusService;
  crmLinks: CRMLinkService;
};

export type CreateWhatsAppInboxServicesOptions = {
  companyId?: string;
  now?: () => number;
  assignees?: InboxAssigneeDirectory;
  createLead?: InboxCreateLeadCallback;
  findDuplicate?: InboxCrmDuplicateLookup;
};

const emptyAssigneeDirectory: InboxAssigneeDirectory = {
  async getById() {
    return null;
  },
};

export function createWhatsAppInboxServices(
  repos: WhatsAppInboxRepositories,
  options: CreateWhatsAppInboxServicesOptions = {}
): WhatsAppInboxServices {
  const companyId = options.companyId ?? DEFAULT_COMPANY_ID;
  const now = options.now ?? Date.now;

  const statuses = new StatusService(repos.conversations, companyId);
  const readState = new ReadStateService(
    repos.conversations,
    repos.readWatermarks,
    companyId
  );

  return {
    statuses,
    conversations: new ConversationService(
      repos.conversations,
      repos.messages,
      repos.statuses,
      repos.crmLinks,
      statuses,
      readState,
      companyId,
      now
    ),
    messages: new MessageService(
      repos.conversations,
      repos.messages,
      repos.idempotency,
      statuses,
      companyId,
      now
    ),
    readState,
    assignments: new AssignmentService(
      repos.conversations,
      options.assignees ?? emptyAssigneeDirectory,
      companyId
    ),
    crmLinks: new CRMLinkService(
      repos.conversations,
      repos.crmLinks,
      {
        createLead: options.createLead,
        findDuplicate: options.findDuplicate,
      },
      companyId
    ),
  };
}

export { AssignmentService } from "./whatsappAssignmentService.ts";
export { ConversationService } from "./whatsappConversationService.ts";
export { StatusService } from "./whatsappConversationStatusService.ts";
export { CRMLinkService } from "./whatsappCrmLinkService.ts";
export { MessageService } from "./whatsappMessageService.ts";
export { ReadStateService } from "./whatsappReadStateService.ts";
export { InboxServiceError } from "./whatsappInboxServiceErrors.ts";
export {
  canViewInbox,
  canArchiveConversation,
  canReassignConversation,
} from "./whatsappInboxPermissions.ts";
