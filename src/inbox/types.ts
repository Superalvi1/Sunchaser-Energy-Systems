/** Client-side inbox types mirroring `/api/inbox` envelopes (Revision 3). */

export type InboxConversationStatus =
  | "open"
  | "pending"
  | "resolved"
  | "archived";

export type InboxAiOwnershipState =
  | "AI_SHADOW"
  | "AI_ACTIVE"
  | "HUMAN_HANDLING"
  | "AI_PAUSED";

export type InboxConversation = {
  id: string;
  companyId: string;
  channelId: string;
  contactId: string;
  status: InboxConversationStatus;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignedUserId: string | null;
  assignedAt: string | null;
  assignedBy: string | null;
  lockVersion: number;
  hasFailedMessage: boolean;
  aiOwnershipState?: InboxAiOwnershipState;
};

export type InboxCrmLink = {
  conversationId: string;
  companyId: string;
  linkedEntityType: "lead" | "customer";
  linkedEntityId: string;
  linkedByUserId: string;
  linkedAt: string;
};

export type FreeFormEligibility = {
  freeFormAllowed: boolean;
  windowExpiresAt: string | null;
  latestInboundAt: string | null;
  latestInboundMessageId: string | null;
};

export type InboxConversationDetail = {
  conversation: InboxConversation;
  crmLink: InboxCrmLink | null;
  freeForm: FreeFormEligibility;
  selfHealed: boolean;
};

export type InboxMessage = {
  id: string;
  companyId: string;
  conversationId: string;
  direction: string;
  status: string;
  textBody: string | null;
  createdAt: string;
  occurredAt: string | null;
  messageType?: string | null;
  metaMediaId?: string | null;
  mimeType?: string | null;
  caption?: string | null;
  filename?: string | null;
  sha256?: string | null;
  voice?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  placeName?: string | null;
};

export type InboxListFilters = {
  status?: InboxConversationStatus | "";
  assignedTo?: string;
  hasFailedMessage?: boolean;
  unreadOnly?: boolean;
  search?: string;
};

export type InboxListPage = {
  conversations: InboxConversation[];
  nextCursor: string | null;
};

export type InboxMessagesPage = {
  messages: InboxMessage[];
  nextCursor: string | null;
};

export type InboxApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export class InboxClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(status: number, error: InboxApiError) {
    super(error.message);
    this.name = "InboxClientError";
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }
}

export type WhatsAppConnectionStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "ERROR"
  | "TOKEN_EXPIRED"
  | "WEBHOOK_PENDING";

export type WhatsAppConnectionStatusPayload = {
  status: WhatsAppConnectionStatus;
  connectionMode: "COEXISTENCE";
  wabaIdMasked: string | null;
  phoneNumberMasked: string | null;
  phoneNumberIdMasked: string | null;
  lastWebhookAt: string | null;
  webhookHealth: "healthy" | "degraded" | "failing" | "unknown";
  tokenHealth: "valid" | "expiring_soon" | "expired" | "reauth_required";
  connectionErrorSummary: string | null;
  canReconnect: boolean;
  /** Sanitized non-fatal warning when Meta unsubscribe failed during disconnect. */
  revokeWarning?: string | null;
};

export type WhatsAppSetupChecklistItem = {
  id: string;
  label: string;
  ok: boolean;
  detail: string | null;
};

export type WhatsAppOnboardingDiagnostics = {
  checklist: WhatsAppSetupChecklistItem[];
  connection: WhatsAppConnectionStatusPayload;
  webhookCallbackUrl: string;
  /** Whether the server has WHATSAPP_WEBHOOK_VERIFY_TOKEN — never includes the value. */
  webhookVerifyTokenConfigured: boolean;
  publicBaseUrlConfigured: boolean;
  graphApi: {
    version: string;
    connectivityOk: boolean;
    detail: string | null;
  };
  environment: {
    metaAppIdConfigured: boolean;
    metaConfigIdConfigured: boolean;
    appSecretConfigured: boolean;
    encryptionKeyConfigured: boolean;
    conversationsEnabled: boolean;
  };
};

export type WhatsAppConnectionTestResult = {
  ok: boolean;
  tokenValid: boolean;
  wabaAccessOk: boolean;
  phoneAccessOk: boolean;
  status: WhatsAppConnectionStatusPayload;
  summary: string;
  details: {
    wabaIdMasked: string | null;
    phoneNumberIdMasked: string | null;
  };
};
