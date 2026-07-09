import type { Database } from "../../../dbManager.ts";
import type { RequestActor } from "../../middleware/actor.ts";
import type {
  AICompanyContext,
  CompanyContextProvider,
  CompanyContextRequest,
} from "../core/AIContext.ts";
import { MinimalChatContextProvider } from "../chatV1.ts";
import { buildBusinessInsightPrompt } from "./BusinessInsightPromptBuilder.ts";
import { buildSafeBusinessContext } from "./SafeBusinessContext.ts";

export interface ChatBusinessContextProviderOptions {
  requestActor: RequestActor;
  db: Database;
  includeBusinessContext: boolean;
}

/** Session context + optional permission-filtered business insights for AI chat V3. */
export class ChatBusinessContextProvider implements CompanyContextProvider {
  private readonly base = new MinimalChatContextProvider();

  constructor(private readonly options: ChatBusinessContextProviderOptions) {}

  async load(request: CompanyContextRequest): Promise<AICompanyContext> {
    const baseContext = await this.base.load(request);
    if (!this.options.includeBusinessContext) {
      return baseContext;
    }

    const summary = await buildSafeBusinessContext(
      this.options.requestActor,
      this.options.db,
      true
    );
    if (!summary) return baseContext;

    const content = buildBusinessInsightPrompt({
      actorRole: this.options.requestActor.role,
      agentId: request.agentId,
      summary,
    });

    return {
      blocks: [
        ...baseContext.blocks,
        {
          key: "business-insights",
          title: "Business insights (read-only, permission-filtered)",
          content,
        },
      ],
      facts: {
        ...baseContext.facts,
        businessContextIncluded: true,
        businessContextScope: summary.scope,
        businessInsightsV3: true,
      },
    };
  }
}
