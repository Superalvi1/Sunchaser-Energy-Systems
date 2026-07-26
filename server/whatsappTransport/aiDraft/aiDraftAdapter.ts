/**
 * AI-04 adapter factory — wires AI-03 inbox draft API to AI-01 QueryAgentService.
 *
 * Default path uses the approved query-agent service with mock phrasing.
 * A live provider is constructed only when fully opted in (draft enabled +
 * provider=env + GEMINI_API_KEY + WHATSAPP_AI_LIVE_PROVIDER_ENABLED).
 * Does not call WhatsApp send transport. Automatic replies remain blocked.
 */

import {
  createQueryAgentService,
  isLiveQueryProviderOptedIn,
  readQueryAgentConfig,
  type LivePhraseCompleteFn,
  type QueryAgentConfig,
  type QueryAgentGateway,
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
  /** Env for provider opt-in checks (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** Injected gateway (tests). */
  gateway?: QueryAgentGateway;
  /**
   * Injected fake live complete — only used when full live opt-in is true.
   * Tests must inject this; never pass a real network client in tests.
   */
  liveComplete?: LivePhraseCompleteFn;
};

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

  const env = options.env ?? process.env;
  const draftConfig = options.config ?? readAiDraftConfig(env);
  const baseQuery = options.queryAgentConfig ?? readQueryAgentConfig(env);

  const queryConfig: QueryAgentConfig = {
    ...baseQuery,
    draftEnabled: draftConfig.draftEnabled,
    autoReplyEnabled: false,
    timeoutMs: draftConfig.timeoutMs || baseQuery.timeoutMs,
  };

  const liveOptIn = isLiveQueryProviderOptedIn(env, queryConfig);

  // Without full opt-in: force mock — no network call.
  const effectiveConfig: QueryAgentConfig = {
    ...queryConfig,
    provider: liveOptIn ? "env" : "mock",
    liveProviderEnabled: liveOptIn ? queryConfig.liveProviderEnabled : false,
  };

  const service = createQueryAgentService({
    config: effectiveConfig,
    env,
    enableKnowledge: true,
    gateway: options.gateway,
    liveComplete: liveOptIn ? options.liveComplete : undefined,
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
