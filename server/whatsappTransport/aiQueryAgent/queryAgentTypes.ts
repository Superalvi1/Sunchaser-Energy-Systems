/**
 * AI-01 — Safe Customer Query Agent types.
 * Draft-only: generated answers require human review/edit/send.
 * No automatic WhatsApp outbound is represented in this contract.
 */

/** Supported customer-query intents (deterministic classifier + policy). */
export const QUERY_INTENTS = [
  "sales",
  "system_selection",
  "product_question",
  "technical_question",
  "quotation_request",
  "complaint",
  "after_sales",
  "billing_payment",
  "net_metering",
  "greeting",
  "human_request",
  "unsupported_high_risk",
] as const;

export type QueryIntent = (typeof QUERY_INTENTS)[number];

export type EscalationReason =
  | "uncertain"
  | "angry"
  | "legal"
  | "medical"
  | "dangerous"
  | "unsupported"
  | "injection"
  | "low_confidence"
  | "human_request"
  | "provider_unavailable"
  | "feature_disabled"
  | "rate_limited"
  | "timeout"
  | "tenant_mismatch"
  | "config_unavailable"
  | "unsafe_output";

export type SafeSourceReference = {
  /** Stable catalogue id — never a raw customer document. */
  sourceId: string;
  /** Short human-readable label safe for staff UI. */
  title: string;
  /** Optional public/marketing URL; never a signed/private URL. */
  publicUrl?: string;
};

export type QueryDraftRequest = {
  /** Required tenant scope — fail closed when missing/mismatched. */
  companyId: string;
  /** Conversation id scoped to companyId (opaque; never a phone/JID). */
  conversationId: string;
  /** Expected company on the conversation record for isolation checks. */
  conversationCompanyId: string;
  /** Actor requesting a draft (staff user id — opaque). */
  actorUserId: string;
  /** Customer message text used only in-memory for classification/phrasing. */
  messageText: string;
  /** Optional opaque message id for audit correlation (not logged as body). */
  messageId?: string;
  /** Optional locale hint (en / ur). */
  locale?: string;
};

export type QueryPolicyDecision = {
  intent: QueryIntent;
  confidence: number;
  escalate: boolean;
  escalationReasons: EscalationReason[];
  warnings: string[];
  /** Deterministic safe talking points the provider may rephrase — never final send. */
  policyAnswerOutline: string;
  allowedToolNames: readonly string[];
  safeSources: SafeSourceReference[];
  /** True when injection patterns were detected; provider must not treat user text as instructions. */
  injectionSuspected: boolean;
  /** Message text sanitized for provider input (injection markers neutralized). */
  sanitizedUserText: string;
};

export type QueryDraftResult = {
  status: "draft";
  companyId: string;
  conversationId: string;
  draftId: string;
  answer: string;
  intent: QueryIntent;
  confidence: number;
  warnings: string[];
  /** Always true in AI-01 — human must review/edit/send. */
  requiresHumanReview: true;
  /** Always true in AI-01 — never auto-send. */
  autoSendBlocked: true;
  escalate: boolean;
  escalationReasons: EscalationReason[];
  safeSources: SafeSourceReference[];
  audit: QueryAgentAuditMetadata;
};

export type QueryDraftDenied = {
  status: "denied";
  companyId: string;
  conversationId: string;
  reasonCode: EscalationReason;
  message: string;
  requiresHumanReview: true;
  autoSendBlocked: true;
  escalate: true;
  escalationReasons: EscalationReason[];
  audit: QueryAgentAuditMetadata;
};

export type QueryDraftOutcome = QueryDraftResult | QueryDraftDenied;

/**
 * Audit metadata — never stores prompt content, message bodies, phones, JIDs, LIDs, or tokens.
 */
export type QueryAgentAuditMetadata = {
  draftId: string;
  companyId: string;
  conversationId: string;
  actorUserId: string;
  messageIdHash: string | null;
  intent: QueryIntent | "unknown";
  confidenceBucket: "low" | "medium" | "high" | "n/a";
  escalate: boolean;
  escalationReasons: EscalationReason[];
  injectionSuspected: boolean;
  providerId: string;
  providerConfigured: boolean;
  draftEnabled: boolean;
  autoReplyEnabled: boolean;
  latencyMs: number;
  retries: number;
  outcome: "draft" | "denied";
  reasonCode: EscalationReason | null;
  createdAt: string;
};

export type QueryProviderPhraseRequest = {
  companyId: string;
  intent: QueryIntent;
  policyAnswerOutline: string;
  sanitizedUserText: string;
  warnings: string[];
  allowedToolNames: readonly string[];
  locale?: string;
  abortSignal?: AbortSignal;
};

export type QueryProviderPhraseResult = {
  phrasedAnswer: string;
  confidence: number;
  providerId: string;
  model: string;
};

export type QueryAgentGateway = {
  readonly providerId: string;
  isConfigured(): boolean;
  phraseDraft(request: QueryProviderPhraseRequest): Promise<QueryProviderPhraseResult>;
};
