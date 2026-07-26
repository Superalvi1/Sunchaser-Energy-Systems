/**
 * AI-01 Customer Query Agent service — DRAFT ONLY.
 *
 * Guarantees:
 * - Never sends WhatsApp messages
 * - Never enables automatic replies
 * - Requires human review on every draft
 * - Fails closed when flags/provider/config are unavailable
 * - Enforces company/tenant isolation
 */

import {
  buildAuditMetadata,
  hashOpaqueId,
  newDraftId,
} from "./queryAgentAudit.ts";
import {
  isQueryAutoReplyEnabled,
  isQueryDraftEnabled,
  readQueryAgentConfig,
  type QueryAgentConfig,
} from "./queryAgentConfig.ts";
import {
  createQueryAgentGateway,
  type LivePhraseCompleteFn,
} from "./queryAgentGateway.ts";
import { logQueryAgent } from "./queryAgentLogger.ts";
import {
  MAX_DRAFT_CHARS,
  SAFE_ESCALATION_DRAFT,
  validateProviderDraftOutput,
} from "./queryOutputValidation.ts";
import { QueryPolicyLayer } from "./queryPolicyLayer.ts";
import { QueryRateLimiter } from "./queryRateLimiter.ts";
import {
  createQueryKnowledgeAdapter,
  enrichOutlineWithKnowledge,
  knowledgeFactsToSafeSources,
  knowledgeRequiresHumanEscalation,
  prepareKnowledgeDraftForPhrasing,
  safeKnowledgeEscalationWarning,
  type QueryKnowledgePort,
} from "./queryKnowledgeAdapter.ts";
import type {
  EscalationReason,
  QueryAgentGateway,
  QueryDraftDenied,
  QueryDraftOutcome,
  QueryDraftRequest,
  QueryDraftResult,
} from "./queryAgentTypes.ts";

export type QueryAgentServiceOptions = {
  config?: QueryAgentConfig;
  gateway?: QueryAgentGateway;
  policyLayer?: QueryPolicyLayer;
  rateLimiter?: QueryRateLimiter;
  /** AI-02 knowledge retrieval port (tenant-scoped). */
  knowledge?: QueryKnowledgePort;
  /** When false, skip knowledge retrieval (unit tests for policy-only paths). */
  enableKnowledge?: boolean;
  /** Env used for live-provider opt-in checks (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** Injected live complete fn — tests only; never a real network client. */
  liveComplete?: LivePhraseCompleteFn;
  /** Test seam for time. */
  now?: () => number;
  /** Test seam — override sleep between retries. */
  sleep?: (ms: number) => Promise<void>;
};

function deny(
  request: QueryDraftRequest,
  reasonCode: EscalationReason,
  message: string,
  auditBase: {
    draftId: string;
    providerId: string;
    providerConfigured: boolean;
    draftEnabled: boolean;
    autoReplyEnabled: boolean;
    latencyMs: number;
    retries: number;
    intent?: QueryDraftDenied["audit"]["intent"];
    confidence?: number;
    injectionSuspected?: boolean;
    escalationReasons?: EscalationReason[];
  }
): QueryDraftDenied {
  const escalationReasons = [
    ...(auditBase.escalationReasons ?? []),
    reasonCode,
  ];
  const uniqueReasons = [...new Set(escalationReasons)];

  return {
    status: "denied",
    companyId: request.companyId,
    conversationId: request.conversationId,
    reasonCode,
    message,
    requiresHumanReview: true,
    autoSendBlocked: true,
    escalate: true,
    escalationReasons: uniqueReasons,
    audit: buildAuditMetadata({
      draftId: auditBase.draftId,
      companyId: request.companyId,
      conversationId: request.conversationId,
      actorUserId: request.actorUserId,
      messageId: request.messageId,
      intent: auditBase.intent ?? "unknown",
      confidence: auditBase.confidence,
      escalate: true,
      escalationReasons: uniqueReasons,
      injectionSuspected: auditBase.injectionSuspected ?? false,
      providerId: auditBase.providerId,
      providerConfigured: auditBase.providerConfigured,
      draftEnabled: auditBase.draftEnabled,
      autoReplyEnabled: auditBase.autoReplyEnabled,
      latencyMs: auditBase.latencyMs,
      retries: auditBase.retries,
      outcome: "denied",
      reasonCode,
    }),
  };
}

async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  _sleep: (ms: number) => Promise<void>
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(
        Object.assign(new Error("Query agent provider timed out"), {
          code: "timeout",
        })
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([work(controller.signal), timeoutPromise]);
  } catch (err) {
    if (timedOut || (err as { code?: string })?.code === "timeout") {
      throw Object.assign(new Error("Query agent provider timed out"), {
        code: "timeout",
      });
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    void _sleep;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Hard guarantee: this service has no WhatsApp send capability.
 * Present for static review / tests — always false / no-op.
 */
export const QUERY_AGENT_CAN_SEND_WHATSAPP = false as const;

export function assertNoWhatsAppSendCapability(): void {
  if (QUERY_AGENT_CAN_SEND_WHATSAPP) {
    throw new Error("AI query agent must not have WhatsApp send capability");
  }
}

export class QueryAgentService {
  private readonly config: QueryAgentConfig;
  private readonly gateway: QueryAgentGateway;
  private readonly policyLayer: QueryPolicyLayer;
  private readonly rateLimiter: QueryRateLimiter;
  private readonly knowledge: QueryKnowledgePort | null;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: QueryAgentServiceOptions = {}) {
    this.config = options.config ?? readQueryAgentConfig(options.env);
    this.gateway =
      options.gateway ??
      createQueryAgentGateway({
        config: this.config,
        env: options.env,
        liveComplete: options.liveComplete,
        forceMock: this.config.provider === "mock",
      });
    this.policyLayer =
      options.policyLayer ??
      new QueryPolicyLayer({ minConfidence: this.config.minConfidence });
    this.rateLimiter =
      options.rateLimiter ??
      new QueryRateLimiter({
        windowMs: this.config.rateLimitWindowMs,
        maxAttempts: this.config.rateLimitMax,
      });
    // Knowledge is opt-in via createQueryAgentService / explicit port.
    // Unit tests constructing QueryAgentService directly stay policy-only.
    // AI-05: source selected via WHATSAPP_AI_KNOWLEDGE_SOURCE (fail-closed).
    this.knowledge =
      options.knowledge !== undefined
        ? options.knowledge
        : options.enableKnowledge
          ? createQueryKnowledgeAdapter({ env: options.env })
          : null;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    assertNoWhatsAppSendCapability();
  }

  getConfig(): QueryAgentConfig {
    return this.config;
  }

  /**
   * Generate a draft reply for staff review.
   * Never sends a WhatsApp message. Auto-reply remains blocked.
   */
  async generateDraft(request: QueryDraftRequest): Promise<QueryDraftOutcome> {
    const started = this.now();
    const draftId = newDraftId();
    const draftEnabled = isQueryDraftEnabled(this.config);
    const autoReplyEnabled = isQueryAutoReplyEnabled(this.config);
    // Even if the future auto-reply flag is true, AI-01 blocks send.
    void autoReplyEnabled;

    const baseAudit = {
      draftId,
      providerId: this.gateway.providerId,
      providerConfigured: this.gateway.isConfigured(),
      draftEnabled,
      autoReplyEnabled: false, // record effective auto-reply as OFF for AI-01
      latencyMs: 0,
      retries: 0,
    };

    const companyId = String(request.companyId || "").trim();
    const conversationCompanyId = String(request.conversationCompanyId || "").trim();
    const conversationId = String(request.conversationId || "").trim();
    const actorUserId = String(request.actorUserId || "").trim();

    if (!companyId || !conversationId || !actorUserId || !conversationCompanyId) {
      const denied = deny(
        { ...request, companyId: companyId || "unknown", conversationId: conversationId || "unknown" },
        "config_unavailable",
        "Draft generation requires companyId, conversationCompanyId, conversationId, and actorUserId.",
        { ...baseAudit, latencyMs: this.now() - started }
      );
      logQueryAgent("warn", "draft_denied", {
        reasonCode: denied.reasonCode,
        companyIdPresent: Boolean(companyId),
      });
      return denied;
    }

    if (companyId !== conversationCompanyId) {
      const denied = deny(
        request,
        "tenant_mismatch",
        "Conversation does not belong to the requesting company.",
        { ...baseAudit, latencyMs: this.now() - started }
      );
      logQueryAgent("warn", "draft_denied", {
        reasonCode: "tenant_mismatch",
        companyIdHash: hashOpaqueId(companyId),
      });
      return denied;
    }

    if (!draftEnabled) {
      const denied = deny(
        request,
        "feature_disabled",
        "AI draft generation is disabled.",
        { ...baseAudit, latencyMs: this.now() - started }
      );
      logQueryAgent("info", "draft_denied", { reasonCode: "feature_disabled" });
      return denied;
    }

    if (!this.gateway.isConfigured()) {
      const denied = deny(
        request,
        "provider_unavailable",
        "AI provider is not configured. Draft generation failed closed.",
        { ...baseAudit, latencyMs: this.now() - started }
      );
      logQueryAgent("warn", "draft_denied", { reasonCode: "provider_unavailable" });
      return denied;
    }

    const limit = this.rateLimiter.check(companyId, actorUserId);
    if (!limit.allowed) {
      const denied = deny(
        request,
        "rate_limited",
        "Draft generation rate limit exceeded. Try again later.",
        { ...baseAudit, latencyMs: this.now() - started }
      );
      logQueryAgent("warn", "draft_denied", { reasonCode: "rate_limited" });
      return denied;
    }

    // Deterministic policy BEFORE AI phrasing.
    const policy = this.policyLayer.evaluate(request.messageText);

    // AI-02 knowledge retrieval (tenant-scoped) — before provider phrasing.
    let policyAnswerOutline = policy.policyAnswerOutline;
    let safeSources = [...policy.safeSources];
    let knowledgeEscalationReasons: EscalationReason[] = [];
    let knowledgeWarnings: string[] = [];

    // Skip knowledge for pure greetings — empty packs must not force escalation.
    const shouldRetrieveKnowledge =
      this.knowledge != null && policy.intent !== "greeting";

    if (shouldRetrieveKnowledge && this.knowledge) {
      try {
        const knowledgeDraft = this.knowledge.retrieve({
          companyId,
          queryText: policy.sanitizedUserText,
          intent: policy.intent,
        });
        if (
          knowledgeRequiresHumanEscalation(knowledgeDraft, {
            queryText: policy.sanitizedUserText,
          })
        ) {
          knowledgeEscalationReasons = ["uncertain"];
          if (
            knowledgeDraft.category === "unsafe_engineering" ||
            knowledgeDraft.category === "net_metering_general"
          ) {
            knowledgeEscalationReasons = ["dangerous"];
          }
          // Never surface stale/conflicting monetary amounts in warnings.
          knowledgeWarnings = [
            safeKnowledgeEscalationWarning(knowledgeDraft),
          ];
        } else {
          const phrasingDraft = prepareKnowledgeDraftForPhrasing(
            knowledgeDraft,
            policy.sanitizedUserText
          );
          // AI-05-R1: production port must not append unapproved legacy claims.
          const productionSafe =
            this.knowledge.portId === "knowledge-production";
          policyAnswerOutline = enrichOutlineWithKnowledge(
            policy.policyAnswerOutline,
            phrasingDraft,
            {
              productionSafe,
              intent: policy.intent,
            }
          );
          const kSources = knowledgeFactsToSafeSources(phrasingDraft);
          const seen = new Set(safeSources.map((s) => s.sourceId));
          for (const src of kSources) {
            if (!seen.has(src.sourceId)) {
              seen.add(src.sourceId);
              safeSources.push(src);
            }
          }
          if (phrasingDraft.disposition === "partial") {
            knowledgeWarnings.push(
              "Knowledge answer is partial — staff must verify before send."
            );
          }
        }
        logQueryAgent("info", "knowledge_retrieved", {
          disposition: knowledgeDraft.disposition,
          category: knowledgeDraft.category,
          matchedRecordCount: knowledgeDraft.retrieval.matchedRecordCount,
        });
      } catch {
        // Fail closed to human escalation — never invent facts.
        knowledgeEscalationReasons = ["uncertain"];
        knowledgeWarnings = [
          "Knowledge retrieval failed closed; human review required.",
        ];
        logQueryAgent("warn", "knowledge_retrieval_failed", {
          companyIdHash: hashOpaqueId(companyId),
        });
      }
    }

    const combinedEscalationReasons = [
      ...new Set([...policy.escalationReasons, ...knowledgeEscalationReasons]),
    ];
    const combinedWarnings = [...policy.warnings, ...knowledgeWarnings];

    // For high-risk / injection / knowledge gaps / unsupported scope:
    // safe escalation draft without requiring (or trusting) provider creativity.
    if (
      policy.intent === "unsupported_high_risk" ||
      policy.injectionSuspected ||
      combinedEscalationReasons.includes("dangerous") ||
      combinedEscalationReasons.includes("legal") ||
      combinedEscalationReasons.includes("medical") ||
      combinedEscalationReasons.includes("unsupported") ||
      knowledgeEscalationReasons.length > 0
    ) {
      const answer =
        "Thank you for your message. A Sunchaser team member will review this and follow up with you shortly.";
      const result: QueryDraftResult = {
        status: "draft",
        companyId,
        conversationId,
        draftId,
        answer,
        intent: policy.intent,
        confidence: policy.confidence,
        warnings: combinedWarnings,
        requiresHumanReview: true,
        autoSendBlocked: true,
        escalate: true,
        escalationReasons: combinedEscalationReasons.length
          ? combinedEscalationReasons
          : policy.escalationReasons,
        safeSources,
        audit: buildAuditMetadata({
          draftId,
          companyId,
          conversationId,
          actorUserId,
          messageId: request.messageId,
          intent: policy.intent,
          confidence: policy.confidence,
          escalate: true,
          escalationReasons: combinedEscalationReasons.length
            ? combinedEscalationReasons
            : policy.escalationReasons,
          injectionSuspected: policy.injectionSuspected,
          providerId: this.gateway.providerId,
          providerConfigured: true,
          draftEnabled,
          autoReplyEnabled: false,
          latencyMs: this.now() - started,
          retries: 0,
          outcome: "draft",
          reasonCode: null,
        }),
      };
      logQueryAgent("info", "draft_created_escalation", {
        intent: policy.intent,
        escalate: true,
        injectionSuspected: policy.injectionSuspected,
        knowledgeEscalated: knowledgeEscalationReasons.length > 0,
      });
      return result;
    }

    let retries = 0;
    let lastError: unknown;

    while (retries <= this.config.maxRetries) {
      try {
        const phrase = await withTimeout(
          (signal) =>
            this.gateway.phraseDraft({
              companyId,
              intent: policy.intent,
              policyAnswerOutline,
              sanitizedUserText: policy.sanitizedUserText,
              warnings: combinedWarnings,
              allowedToolNames: policy.allowedToolNames,
              locale: request.locale,
              abortSignal: signal,
            }),
          this.config.timeoutMs,
          this.sleep
        );

        const validation = validateProviderDraftOutput(phrase.phrasedAnswer, {
          maxChars: MAX_DRAFT_CHARS,
        });

        if (validation.ok === false) {
          const failure = validation;
          if (failure.action === "deny") {
            const denied = deny(
              request,
              failure.reasonCode,
              failure.message,
              {
                ...baseAudit,
                latencyMs: this.now() - started,
                retries,
                intent: policy.intent,
                confidence: policy.confidence,
                injectionSuspected: policy.injectionSuspected,
                escalationReasons: [
                  ...policy.escalationReasons,
                  failure.reasonCode,
                ],
              }
            );
            logQueryAgent("warn", "draft_denied", {
              reasonCode: failure.reasonCode,
              violation: failure.violation,
              retries,
            });
            return denied;
          }

          // Escalate with a safe replacement — never return unsafe provider text.
          const escalationReasons = [
            ...policy.escalationReasons,
            failure.reasonCode,
          ];
          const result: QueryDraftResult = {
            status: "draft",
            companyId,
            conversationId,
            draftId,
            answer: SAFE_ESCALATION_DRAFT,
            intent: policy.intent,
            confidence: Math.min(policy.confidence, phrase.confidence, 0.4),
            warnings: [
              ...combinedWarnings,
              "Provider draft failed safety validation — escalated for human review.",
              "Automatic WhatsApp replies are disabled — staff must send manually.",
            ],
            requiresHumanReview: true,
            autoSendBlocked: true,
            escalate: true,
            escalationReasons: [...new Set(escalationReasons)],
            safeSources,
            audit: buildAuditMetadata({
              draftId,
              companyId,
              conversationId,
              actorUserId,
              messageId: request.messageId,
              intent: policy.intent,
              confidence: Math.min(policy.confidence, phrase.confidence, 0.4),
              escalate: true,
              escalationReasons: [...new Set(escalationReasons)],
              injectionSuspected: policy.injectionSuspected,
              providerId: phrase.providerId,
              providerConfigured: true,
              draftEnabled,
              autoReplyEnabled: false,
              latencyMs: this.now() - started,
              retries,
              outcome: "draft",
              reasonCode: failure.reasonCode,
            }),
          };
          logQueryAgent("warn", "draft_escalated_unsafe_output", {
            violation: failure.violation,
            retries,
          });
          return result;
        }

        const confidence = Math.min(policy.confidence, phrase.confidence);
        const escalate =
          policy.escalate || confidence < this.config.minConfidence;
        const escalationReasons = [...policy.escalationReasons];
        if (confidence < this.config.minConfidence) {
          escalationReasons.push("low_confidence");
          escalationReasons.push("uncertain");
        }

        const result: QueryDraftResult = {
          status: "draft",
          companyId,
          conversationId,
          draftId,
          answer: validation.text,
          intent: policy.intent,
          confidence,
          warnings: [
            ...combinedWarnings,
            "Automatic WhatsApp replies are disabled — staff must send manually.",
          ],
          requiresHumanReview: true,
          autoSendBlocked: true,
          escalate,
          escalationReasons: [...new Set(escalationReasons)],
          safeSources,
          audit: buildAuditMetadata({
            draftId,
            companyId,
            conversationId,
            actorUserId,
            messageId: request.messageId,
            intent: policy.intent,
            confidence,
            escalate,
            escalationReasons: [...new Set(escalationReasons)],
            injectionSuspected: policy.injectionSuspected,
            providerId: phrase.providerId,
            providerConfigured: true,
            draftEnabled,
            autoReplyEnabled: false,
            latencyMs: this.now() - started,
            retries,
            outcome: "draft",
            reasonCode: null,
          }),
        };

        logQueryAgent("info", "draft_created", {
          intent: policy.intent,
          escalate,
          retries,
          latencyMs: result.audit.latencyMs,
        });
        return result;
      } catch (err) {
        lastError = err;
        const code = (err as { code?: string })?.code;
        if (code === "timeout") {
          const denied = deny(request, "timeout", "Draft generation timed out.", {
            ...baseAudit,
            latencyMs: this.now() - started,
            retries,
            intent: policy.intent,
            confidence: policy.confidence,
            injectionSuspected: policy.injectionSuspected,
            escalationReasons: policy.escalationReasons,
          });
          logQueryAgent("warn", "draft_denied", { reasonCode: "timeout", retries });
          return denied;
        }

        if (retries >= this.config.maxRetries) break;
        retries += 1;
        await this.sleep(25 * retries);
      }
    }

    void lastError;
    const denied = deny(
      request,
      "provider_unavailable",
      "AI provider failed. Draft generation failed closed.",
      {
        ...baseAudit,
        latencyMs: this.now() - started,
        retries,
        intent: policy.intent,
        confidence: policy.confidence,
        injectionSuspected: policy.injectionSuspected,
        escalationReasons: policy.escalationReasons,
      }
    );
    logQueryAgent("error", "draft_denied", {
      reasonCode: "provider_unavailable",
      retries,
    });
    return denied;
  }
}

export function createQueryAgentService(
  options: QueryAgentServiceOptions = {}
): QueryAgentService {
  return new QueryAgentService({
    ...options,
    // Integrated path: AI-02 knowledge on by default (source via env; no live AI).
    enableKnowledge: options.enableKnowledge ?? true,
  });
}
