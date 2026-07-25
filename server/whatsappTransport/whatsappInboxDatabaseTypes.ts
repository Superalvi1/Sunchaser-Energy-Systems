/**
 * WhatsApp Shared Inbox — PR 2 database type foundation (Revision 3).
 *
 * Snake_case row shapes match scripts/whatsapp-inbox-schema.sql.
 * Domain (camelCase) shapes are for later repository/service layers.
 * No repository, service, or route logic lives here.
 */

/** Canonical conversation workflow statuses (PR 2). Assignment is never a status. */
export const WHATSAPP_INBOX_CONVERSATION_STATUSES = [
  "open",
  "pending",
  "resolved",
  "archived",
] as const;

export type WhatsAppInboxConversationStatus =
  (typeof WHATSAPP_INBOX_CONVERSATION_STATUSES)[number];

export const WHATSAPP_OUTBOUND_IDEMPOTENCY_STATES = [
  "processing",
  "completed",
  "failed_known",
  "outcome_unknown",
] as const;

export type WhatsAppOutboundIdempotencyState =
  (typeof WHATSAPP_OUTBOUND_IDEMPOTENCY_STATES)[number];

export const WHATSAPP_CRM_LINK_ENTITY_TYPES = ["lead", "customer"] as const;

export type WhatsAppCrmLinkEntityType =
  (typeof WHATSAPP_CRM_LINK_ENTITY_TYPES)[number];

export const WHATSAPP_AI_OWNERSHIP_STATES = [
  "AI_SHADOW",
  "AI_ACTIVE",
  "HUMAN_HANDLING",
  "AI_PAUSED",
] as const;

export type WhatsAppAiOwnershipState =
  (typeof WHATSAPP_AI_OWNERSHIP_STATES)[number];

export function isWhatsAppAiOwnershipState(
  value: unknown
): value is WhatsAppAiOwnershipState {
  return (
    typeof value === "string" &&
    (WHATSAPP_AI_OWNERSHIP_STATES as readonly string[]).includes(value)
  );
}

/** Additive columns on PR 1 `whatsapp_conversations` (plus existing PR 1 fields). */
export type WhatsAppConversationInboxRow = {
  id: string;
  company_id: string;
  channel_id: string;
  contact_id: string;
  status: WhatsAppInboxConversationStatus;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  assigned_user_id: string | null;
  assigned_at: string | null;
  assigned_by: string | null;
  lock_version: number;
  has_failed_message: boolean;
  ai_ownership_state?: WhatsAppAiOwnershipState;
};

export type WhatsAppConversationAssignmentEventRow = {
  id: string;
  company_id: string;
  conversation_id: string;
  assigned_user_id: string | null;
  assigned_by: string;
  created_at: string;
};

export type WhatsAppConversationStatusEventRow = {
  id: string;
  company_id: string;
  conversation_id: string;
  from_status: WhatsAppInboxConversationStatus | null;
  to_status: WhatsAppInboxConversationStatus;
  changed_by_user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type WhatsAppReadWatermarkRow = {
  company_id: string;
  conversation_id: string;
  user_id: string;
  last_read_inbound_message_id: string | null;
  last_read_inbound_message_created_at: string | null;
  updated_at: string;
};

export type WhatsAppConversationCrmLinkRow = {
  conversation_id: string;
  company_id: string;
  linked_entity_type: WhatsAppCrmLinkEntityType;
  linked_entity_id: string;
  linked_by_user_id: string;
  linked_at: string;
};

export type WhatsAppOutboundIdempotencyKeyRow = {
  idempotency_key: string;
  company_id: string;
  conversation_id: string;
  state: WhatsAppOutboundIdempotencyState;
  message_id: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

/** CamelCase domain mirrors for later layers (no runtime mapping here). */
export type WhatsAppConversationInbox = {
  id: string;
  companyId: string;
  channelId: string;
  contactId: string;
  status: WhatsAppInboxConversationStatus;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignedUserId: string | null;
  assignedAt: string | null;
  assignedBy: string | null;
  lockVersion: number;
  hasFailedMessage: boolean;
  aiOwnershipState?: WhatsAppAiOwnershipState;
  /** Safe contact display fields (joined; never LID/raw JID). */
  profileName?: string | null;
  phoneE164?: string | null;
};

export type WhatsAppConversationAssignmentEvent = {
  id: string;
  companyId: string;
  conversationId: string;
  assignedUserId: string | null;
  assignedBy: string;
  createdAt: string;
};

export type WhatsAppConversationStatusEvent = {
  id: string;
  companyId: string;
  conversationId: string;
  fromStatus: WhatsAppInboxConversationStatus | null;
  toStatus: WhatsAppInboxConversationStatus;
  changedByUserId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type WhatsAppReadWatermark = {
  companyId: string;
  conversationId: string;
  userId: string;
  lastReadInboundMessageId: string | null;
  lastReadInboundMessageCreatedAt: string | null;
  updatedAt: string;
};

export type WhatsAppConversationCrmLink = {
  conversationId: string;
  companyId: string;
  linkedEntityType: WhatsAppCrmLinkEntityType;
  linkedEntityId: string;
  linkedByUserId: string;
  linkedAt: string;
};

export type WhatsAppOutboundIdempotencyKey = {
  idempotencyKey: string;
  companyId: string;
  conversationId: string;
  state: WhatsAppOutboundIdempotencyState;
  messageId: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

/** Table names owned by PR 2 inbox schema (for typed clients / docs). */
export type WhatsAppInboxTableName =
  | "whatsapp_conversation_assignment_events"
  | "whatsapp_conversation_status_events"
  | "whatsapp_read_watermarks"
  | "whatsapp_conversation_crm_links"
  | "whatsapp_outbound_idempotency_keys";

export type WhatsAppInboxDatabase = {
  public: {
    Tables: {
      whatsapp_conversations: {
        Row: WhatsAppConversationInboxRow;
        Insert: Partial<WhatsAppConversationInboxRow> &
          Pick<
            WhatsAppConversationInboxRow,
            "id" | "company_id" | "channel_id" | "contact_id"
          >;
        Update: Partial<WhatsAppConversationInboxRow>;
      };
      whatsapp_conversation_assignment_events: {
        Row: WhatsAppConversationAssignmentEventRow;
        Insert: WhatsAppConversationAssignmentEventRow;
        Update: Partial<WhatsAppConversationAssignmentEventRow>;
      };
      whatsapp_conversation_status_events: {
        Row: WhatsAppConversationStatusEventRow;
        Insert: WhatsAppConversationStatusEventRow;
        Update: Partial<WhatsAppConversationStatusEventRow>;
      };
      whatsapp_read_watermarks: {
        Row: WhatsAppReadWatermarkRow;
        Insert: WhatsAppReadWatermarkRow;
        Update: Partial<WhatsAppReadWatermarkRow>;
      };
      whatsapp_conversation_crm_links: {
        Row: WhatsAppConversationCrmLinkRow;
        Insert: WhatsAppConversationCrmLinkRow;
        Update: Partial<WhatsAppConversationCrmLinkRow>;
      };
      whatsapp_outbound_idempotency_keys: {
        Row: WhatsAppOutboundIdempotencyKeyRow;
        Insert: Omit<WhatsAppOutboundIdempotencyKeyRow, "completed_at" | "message_id" | "error"> &
          Partial<
            Pick<
              WhatsAppOutboundIdempotencyKeyRow,
              "completed_at" | "message_id" | "error"
            >
          >;
        Update: Partial<WhatsAppOutboundIdempotencyKeyRow>;
      };
    };
  };
};
