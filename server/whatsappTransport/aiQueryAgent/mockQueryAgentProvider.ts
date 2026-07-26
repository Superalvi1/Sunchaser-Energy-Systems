/**
 * Mock AI gateway for tests — never calls a live provider.
 */

import type {
  QueryAgentGateway,
  QueryProviderPhraseRequest,
  QueryProviderPhraseResult,
} from "./queryAgentTypes.ts";

export type MockQueryAgentProviderOptions = {
  /** Force a custom phrased answer. */
  phrasedAnswer?: string;
  /** Force confidence. */
  confidence?: number;
  /** Simulate provider failure. */
  failWith?: Error;
  /** Simulate slow response (ms). */
  delayMs?: number;
};

export class MockQueryAgentProvider implements QueryAgentGateway {
  readonly providerId = "mock";
  private options: MockQueryAgentProviderOptions;

  constructor(options: MockQueryAgentProviderOptions = {}) {
    this.options = options;
  }

  setOptions(options: MockQueryAgentProviderOptions): void {
    this.options = options;
  }

  isConfigured(): boolean {
    return true;
  }

  async phraseDraft(
    request: QueryProviderPhraseRequest
  ): Promise<QueryProviderPhraseResult> {
    if (this.options.delayMs && this.options.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.options.delayMs);
        if (request.abortSignal) {
          const onAbort = () => {
            clearTimeout(timer);
            reject(Object.assign(new Error("Query agent provider timed out"), { code: "timeout" }));
          };
          if (request.abortSignal.aborted) {
            onAbort();
            return;
          }
          request.abortSignal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }

    if (request.abortSignal?.aborted) {
      throw Object.assign(new Error("Query agent provider timed out"), { code: "timeout" });
    }

    if (this.options.failWith) {
      throw this.options.failWith;
    }

    const answer =
      this.options.phrasedAnswer ??
      `[DRAFT — human review required] ${request.policyAnswerOutline}`;

    return {
      phrasedAnswer: answer,
      confidence: this.options.confidence ?? 0.82,
      providerId: this.providerId,
      model: "mock-deterministic",
    };
  }
}

/** Gateway that is never configured — used to test fail-closed behavior. */
export class UnconfiguredQueryAgentProvider implements QueryAgentGateway {
  readonly providerId = "unconfigured";

  isConfigured(): boolean {
    return false;
  }

  async phraseDraft(): Promise<QueryProviderPhraseResult> {
    throw Object.assign(new Error("AI query provider is not configured"), {
      code: "provider_unavailable",
    });
  }
}
