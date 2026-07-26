/**
 * AI-03 adapter factory.
 *
 * Until AI-01 is merged, production wiring uses the mock adapter only.
 * After rebase, replace the body of `createInboxAiDraftAdapter` with a
 * thin wrap of `createQueryAgentService` — do not add a second gateway.
 */

import {
  readAiDraftConfig,
  type AiDraftConfig,
} from "./aiDraftConfig.ts";
import { createMockAiDraftAdapter } from "./mockAiDraftAdapter.ts";
import type { InboxAiDraftAdapter } from "./aiDraftTypes.ts";

export type CreateInboxAiDraftAdapterOptions = {
  config?: AiDraftConfig;
  /** Test / DI override. */
  adapter?: InboxAiDraftAdapter;
};

/**
 * Resolve the inbox AI draft adapter.
 * Default: mock implementation (no live provider calls).
 *
 * AI-01 integration point:
 * ```ts
 * import { createQueryAgentService } from "../aiQueryAgent/index.ts";
 * const service = createQueryAgentService({ gateway });
 * return {
 *   adapterId: "query-agent",
 *   generateDraft: (req) => service.generateDraft(req),
 * };
 * ```
 */
export function createInboxAiDraftAdapter(
  options: CreateInboxAiDraftAdapterOptions = {}
): InboxAiDraftAdapter {
  if (options.adapter) return options.adapter;
  const config = options.config ?? readAiDraftConfig();
  return createMockAiDraftAdapter({ config });
}
