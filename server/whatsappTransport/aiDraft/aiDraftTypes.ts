/**
 * AI-03 — Inbox AI draft adapter contract.
 *
 * Aligned with AI-01 `QueryDraftRequest` / `QueryDraftOutcome` so AI-03 can
 * rebase onto `QueryAgentService.generateDraft` without duplicating the
 * provider gateway. Automatic WhatsApp send is never represented here.
 */

export const AI_DRAFT_INTENTS = [
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

export type AiDraftIntent = (typeof AI_DRAFT_INTENTS)[number];

export type AiDraftEscalationReason =
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
  | "config_unavailable";

export type AiDraftSafeSource = {
  sourceId: string;
  title: string;
  publicUrl?: string;
};

/** Staff-initiated draft request — never triggers outbound send. */
export type AiDraftGenerateRequest = {
  companyId: string;
  conversationId: string;
  conversationCompanyId: string;
  actorUserId: string;
  messageText: string;
  messageId?: string;
  locale?: string;
  abortSignal?: AbortSignal;
};

export type AiDraftAuditMetadata = {
  draftId: string;
  companyId: string;
  conversationId: string;
  actorUserId: string;
  messageIdHash: string | null;
  intent: AiDraftIntent | "unknown";
  confidenceBucket: "low" | "medium" | "high" | "n/a";
  escalate: boolean;
  escalationReasons: AiDraftEscalationReason[];
  injectionSuspected: boolean;
  providerId: string;
  providerConfigured: boolean;
  draftEnabled: boolean;
  autoReplyEnabled: boolean;
  latencyMs: number;
  retries: number;
  outcome: "draft" | "denied";
  reasonCode: AiDraftEscalationReason | null;
  createdAt: string;
};

export type AiDraftResult = {
  status: "draft";
  companyId: string;
  conversationId: string;
  draftId: string;
  answer: string;
  intent: AiDraftIntent;
  confidence: number;
  warnings: string[];
  requiresHumanReview: true;
  autoSendBlocked: true;
  escalate: boolean;
  escalationReasons: AiDraftEscalationReason[];
  safeSources: AiDraftSafeSource[];
  audit: AiDraftAuditMetadata;
};

export type AiDraftDenied = {
  status: "denied";
  companyId: string;
  conversationId: string;
  reasonCode: AiDraftEscalationReason;
  message: string;
  requiresHumanReview: true;
  autoSendBlocked: true;
  escalate: true;
  escalationReasons: AiDraftEscalationReason[];
  audit: AiDraftAuditMetadata;
};

export type AiDraftOutcome = AiDraftResult | AiDraftDenied;

/**
 * Thin port AI-03 calls. AI-01 must satisfy this with
 * `QueryAgentService.generateDraft` (or a one-line wrapper).
 * Do not implement a second provider gateway here.
 */
export type InboxAiDraftAdapter = {
  readonly adapterId: string;
  generateDraft(request: AiDraftGenerateRequest): Promise<AiDraftOutcome>;
};

/** Hard guarantee: this module never sends WhatsApp. */
export const AI_DRAFT_CAN_SEND_WHATSAPP = false as const;
