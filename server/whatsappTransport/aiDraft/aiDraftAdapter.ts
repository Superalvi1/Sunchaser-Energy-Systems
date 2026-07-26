/**
 * AI-04 adapter factory — wires AI-03 inbox draft API to AI-01 QueryAgentService.
 *
 * Default path uses the approved query-agent service (mock phrasing when no
 * live GEMINI key). Does not call WhatsApp send transport. Automatic replies
 * remain blocked. No second provider gateway is introduced here.
 */

import {
  createQueryAgentService,
  readQueryAgentConfig,
  type QueryAgentConfig,
  type QueryDraftOutcome,
} from "../aiQueryAgent/index.ts";
import {
  readAiDraftConfig,
  type AiDraftConfig,
} from "./aiDraftConfig.ts";
import type {
  AiDraftEscalationReason,
  AiDraftOutcome,
  InboxAiDraftAdapter,
} from "./aiDraftTypes.ts";

export type CreateInboxAiDraftAdapterOptions = {
  config?: AiDraftConfig;
  /** Test / DI override. */
  adapter?: InboxAiDraftAdapter;
  /** Optional query-agent config override (tests). */
  queryAgentConfig?: QueryAgentConfig;
};

function hasLiveGeminiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(String(env.GEMINI_API_KEY ?? "").trim());
}

function toAiDraftOutcome(outcome: QueryDraftOutcome): AiDraftOutcome {
  // AI-01 may emit unsafe_output; AI-03 union includes it after R4 alignment.
  return outcome as AiDraftOutcome;
}

/**
 * Resolve the inbox AI draft adapter.
 * Production/integration default: AI-01 QueryAgentService (+ AI-02 knowledge).
 * Never enables automatic WhatsApp send.
 */
export function createInboxAiDraftAdapter(
  options: CreateInboxAiDraftAdapterOptions = {}
): InboxAiDraftAdapter {
  if (options.adapter) return options.adapter;

  const draftConfig = options.config ?? readAiDraftConfig();
  const baseQuery = options.queryAgentConfig ?? readQueryAgentConfig();

  // Prefer mock phrasing unless a live Gemini key is present AND provider=env.
  // AI-04 must not call a live AI provider in default local/integration paths.
  const useMock =
    baseQuery.provider === "mock" || !hasLiveGeminiKey();

  const queryConfig: QueryAgentConfig = {
    ...baseQuery,
    draftEnabled: draftConfig.draftEnabled,
    autoReplyEnabled: false,
    provider: useMock ? "mock" : "env",
    timeoutMs: draftConfig.timeoutMs || baseQuery.timeoutMs,
  };

  const service = createQueryAgentService({
    config: queryConfig,
    enableKnowledge: true,
  });

  return {
    adapterId: "query-agent",
    async generateDraft(request) {
      const outcome = await service.generateDraft({
        companyId: request.companyId,
        conversationId: request.conversationId,
        conversationCompanyId: request.conversationCompanyId,
        actorUserId: request.actorUserId,
        messageText: request.messageText,
        messageId: request.messageId,
        locale: request.locale,
      });
      return toAiDraftOutcome(outcome);
    },
  };
}

/** Re-export for tests that assert escalation reason typing. */
export type { AiDraftEscalationReason };
