/**
 * Mock InboxAiDraftAdapter for AI-03.
 * Never calls OpenAI/Gemini/Anthropic or any live provider.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  isAiAutoReplyEnabled,
  isAiDraftEnabled,
  readAiDraftConfig,
  type AiDraftConfig,
} from "./aiDraftConfig.ts";
import type {
  AiDraftAuditMetadata,
  AiDraftDenied,
  AiDraftGenerateRequest,
  AiDraftOutcome,
  AiDraftResult,
  InboxAiDraftAdapter,
} from "./aiDraftTypes.ts";

export type MockAiDraftAdapterOptions = {
  config?: AiDraftConfig;
  /** Force a custom draft answer. */
  answer?: string;
  confidence?: number;
  /** Simulate provider/adapter failure after enablement checks. */
  failWith?: Error;
  /** Simulate slow response (ms). Honors abortSignal. */
  delayMs?: number;
  /** Force a denied outcome with this reason. */
  denyWith?: AiDraftDenied["reasonCode"];
  now?: () => number;
};

function hashMessageId(messageId: string | undefined): string | null {
  if (!messageId) return null;
  return createHash("sha256").update(messageId).digest("hex").slice(0, 16);
}

function confidenceBucket(
  confidence: number | undefined
): AiDraftAuditMetadata["confidenceBucket"] {
  if (confidence == null || !Number.isFinite(confidence)) return "n/a";
  if (confidence < 0.55) return "low";
  if (confidence < 0.8) return "medium";
  return "high";
}

function buildAudit(
  request: AiDraftGenerateRequest,
  partial: Omit<
    AiDraftAuditMetadata,
    "companyId" | "conversationId" | "actorUserId" | "messageIdHash" | "createdAt"
  > & { createdAt?: string }
): AiDraftAuditMetadata {
  return {
    draftId: partial.draftId,
    companyId: request.companyId,
    conversationId: request.conversationId,
    actorUserId: request.actorUserId,
    messageIdHash: hashMessageId(request.messageId),
    intent: partial.intent,
    confidenceBucket: partial.confidenceBucket,
    escalate: partial.escalate,
    escalationReasons: partial.escalationReasons,
    injectionSuspected: partial.injectionSuspected,
    providerId: partial.providerId,
    providerConfigured: partial.providerConfigured,
    draftEnabled: partial.draftEnabled,
    autoReplyEnabled: partial.autoReplyEnabled,
    latencyMs: partial.latencyMs,
    retries: partial.retries,
    outcome: partial.outcome,
    reasonCode: partial.reasonCode,
    createdAt: partial.createdAt ?? new Date().toISOString(),
  };
}

function deny(
  request: AiDraftGenerateRequest,
  reasonCode: AiDraftDenied["reasonCode"],
  message: string,
  meta: {
    draftId: string;
    draftEnabled: boolean;
    autoReplyEnabled: boolean;
    latencyMs: number;
    providerConfigured?: boolean;
  }
): AiDraftDenied {
  return {
    status: "denied",
    companyId: request.companyId,
    conversationId: request.conversationId,
    reasonCode,
    message,
    requiresHumanReview: true,
    autoSendBlocked: true,
    escalate: true,
    escalationReasons: [reasonCode],
    audit: buildAudit(request, {
      draftId: meta.draftId,
      intent: "unknown",
      confidenceBucket: "n/a",
      escalate: true,
      escalationReasons: [reasonCode],
      injectionSuspected: false,
      providerId: "mock",
      providerConfigured: meta.providerConfigured ?? true,
      draftEnabled: meta.draftEnabled,
      autoReplyEnabled: meta.autoReplyEnabled,
      latencyMs: meta.latencyMs,
      retries: 0,
      outcome: "denied",
      reasonCode,
    }),
  };
}

async function maybeDelay(
  delayMs: number | undefined,
  signal: AbortSignal | undefined
): Promise<void> {
  if (!delayMs || delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => resolve(), delayMs);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        Object.assign(new Error("AI draft adapter timed out"), {
          code: "timeout",
        })
      );
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class MockAiDraftAdapter implements InboxAiDraftAdapter {
  readonly adapterId = "mock-ai-draft";
  private options: MockAiDraftAdapterOptions;

  constructor(options: MockAiDraftAdapterOptions = {}) {
    this.options = options;
  }

  setOptions(options: MockAiDraftAdapterOptions): void {
    this.options = { ...this.options, ...options };
  }

  async generateDraft(
    request: AiDraftGenerateRequest
  ): Promise<AiDraftOutcome> {
    const started = (this.options.now ?? Date.now)();
    const config = this.options.config ?? readAiDraftConfig();
    const draftEnabled = isAiDraftEnabled(config);
    const autoReplyEnabled = isAiAutoReplyEnabled(config);
    const draftId = `draft_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

    if (!draftEnabled) {
      return deny(
        request,
        "feature_disabled",
        "AI draft generation is disabled",
        {
          draftId,
          draftEnabled,
          autoReplyEnabled,
          latencyMs: (this.options.now ?? Date.now)() - started,
        }
      );
    }

    if (
      !request.companyId ||
      !request.conversationCompanyId ||
      request.companyId !== request.conversationCompanyId
    ) {
      return deny(
        request,
        "tenant_mismatch",
        "Conversation does not belong to the requesting tenant",
        {
          draftId,
          draftEnabled,
          autoReplyEnabled,
          latencyMs: (this.options.now ?? Date.now)() - started,
        }
      );
    }

    if (this.options.denyWith) {
      return deny(
        request,
        this.options.denyWith,
        `Draft denied: ${this.options.denyWith}`,
        {
          draftId,
          draftEnabled,
          autoReplyEnabled,
          latencyMs: (this.options.now ?? Date.now)() - started,
        }
      );
    }

    try {
      await maybeDelay(this.options.delayMs, request.abortSignal);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      if (code === "timeout" || request.abortSignal?.aborted) {
        return deny(request, "timeout", "AI draft generation timed out", {
          draftId,
          draftEnabled,
          autoReplyEnabled,
          latencyMs: (this.options.now ?? Date.now)() - started,
        });
      }
      throw err;
    }

    if (this.options.failWith) {
      throw this.options.failWith;
    }

    const confidence = this.options.confidence ?? 0.78;
    const escalate = confidence < 0.55;
    const warnings = [
      "AI-generated content — human review required before sending.",
      "This draft was produced by a mock adapter (no live provider).",
    ];
    if (escalate) {
      warnings.push("Low confidence — consider escalating to a senior agent.");
    }

    const answer =
      this.options.answer ??
      [
        "[DRAFT — human review required]",
        "Thanks for your message. Based on your question, here is a suggested reply.",
        "Please edit this text before sending — AI content is not auto-sent.",
        request.messageText.trim()
          ? `(Context: responding to customer message of ${request.messageText.trim().length} characters.)`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");

    const result: AiDraftResult = {
      status: "draft",
      companyId: request.companyId,
      conversationId: request.conversationId,
      draftId,
      answer,
      intent: "product_question",
      confidence,
      warnings,
      requiresHumanReview: true,
      autoSendBlocked: true,
      escalate,
      escalationReasons: escalate ? ["low_confidence"] : [],
      safeSources: [
        {
          sourceId: "faq_public_overview",
          title: "Public solar FAQ overview",
        },
      ],
      audit: buildAudit(request, {
        draftId,
        intent: "product_question",
        confidenceBucket: confidenceBucket(confidence),
        escalate,
        escalationReasons: escalate ? ["low_confidence"] : [],
        injectionSuspected: false,
        providerId: "mock",
        providerConfigured: true,
        draftEnabled,
        autoReplyEnabled,
        latencyMs: (this.options.now ?? Date.now)() - started,
        retries: 0,
        outcome: "draft",
        reasonCode: null,
      }),
    };

    return result;
  }
}

export function createMockAiDraftAdapter(
  options?: MockAiDraftAdapterOptions
): InboxAiDraftAdapter {
  return new MockAiDraftAdapter(options);
}
