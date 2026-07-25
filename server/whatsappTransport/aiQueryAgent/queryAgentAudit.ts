/**
 * Audit metadata builder — operational fields only.
 * Never stores prompt content, message bodies, phones, JIDs, LIDs, or tokens.
 */

import { createHash, randomUUID } from "node:crypto";

import type {
  EscalationReason,
  QueryAgentAuditMetadata,
  QueryIntent,
} from "./queryAgentTypes.ts";

export function newDraftId(): string {
  return `qdraft_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/** One-way hash for optional message id correlation — never the body. */
export function hashMessageId(messageId: string | null | undefined): string | null {
  const id = String(messageId ?? "").trim();
  if (!id) return null;
  return createHash("sha256").update(id).digest("hex").slice(0, 16);
}

export function confidenceBucket(
  confidence: number | null | undefined
): QueryAgentAuditMetadata["confidenceBucket"] {
  if (confidence === null || confidence === undefined || !Number.isFinite(confidence)) {
    return "n/a";
  }
  if (confidence < 0.55) return "low";
  if (confidence < 0.8) return "medium";
  return "high";
}

export type BuildAuditInput = {
  draftId: string;
  companyId: string;
  conversationId: string;
  actorUserId: string;
  messageId?: string;
  intent: QueryIntent | "unknown";
  confidence?: number;
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
};

export function buildAuditMetadata(input: BuildAuditInput): QueryAgentAuditMetadata {
  return {
    draftId: input.draftId,
    companyId: input.companyId,
    conversationId: input.conversationId,
    actorUserId: input.actorUserId,
    messageIdHash: hashMessageId(input.messageId),
    intent: input.intent,
    confidenceBucket: confidenceBucket(input.confidence),
    escalate: input.escalate,
    escalationReasons: [...input.escalationReasons],
    injectionSuspected: input.injectionSuspected,
    providerId: input.providerId,
    providerConfigured: input.providerConfigured,
    draftEnabled: input.draftEnabled,
    autoReplyEnabled: input.autoReplyEnabled,
    latencyMs: input.latencyMs,
    retries: input.retries,
    outcome: input.outcome,
    reasonCode: input.reasonCode,
    createdAt: new Date().toISOString(),
  };
}

/** Assert audit payload has no sensitive content fields. */
export function auditContainsForbiddenFields(audit: QueryAgentAuditMetadata): string[] {
  const json = JSON.stringify(audit);
  const hits: string[] = [];
  if (/"prompt"/i.test(json)) hits.push("prompt");
  if (/"messageText"/i.test(json) || /"textBody"/i.test(json)) hits.push("message_body");
  if (/"phone"/i.test(json)) hits.push("phone");
  if (/"jid"/i.test(json) || /"lid"/i.test(json)) hits.push("jid_lid");
  if (/"accessToken"/i.test(json) || /"apiKey"/i.test(json)) hits.push("token");
  return hits;
}
