import type { SocialProvider } from "../providers/SocialProvider.ts";
import { ProviderError, classifyFacebookGraphError } from "../providers/errors.ts";
import type {
  ConnectInput,
  ConnectResult,
  ConnectedAccount,
  CredentialRefresh,
  CredentialStatus,
  ImageContent,
  PublishAttempt,
  PublishJob,
  PublishStatus,
  ProviderPublishHandle,
  ReconcileResult,
  TextContent,
  VideoContent,
} from "../providers/types.ts";
import { MOCK_SCENARIOS, type MockScenarioName } from "./scenarios.ts";
import { classifyTransportFailure } from "../scheduler/outcomes.ts";

export type MockProviderOptions = {
  scenario: MockScenarioName;
  provider?: "facebook" | "tiktok";
  publishedIds?: string[];
};

/**
 * Drop-in SocialProvider for scheduler tests. Never talks to Facebook/TikTok.
 */
export class MockProvider implements SocialProvider {
  readonly id;
  scenario: MockScenarioName;
  readonly published = new Map<string, { id: string; fingerprint: string }>();
  publishCalls = 0;

  constructor(opts: MockProviderOptions) {
    this.id = opts.provider ?? "facebook";
    this.scenario = opts.scenario;
    for (const id of opts.publishedIds ?? []) {
      this.published.set(id, { id, fingerprint: "seed" });
    }
  }

  async connectAccount(input: ConnectInput): Promise<ConnectResult> {
    if (this.scenario === "http_401" || this.scenario === "revoked_token") {
      return { ok: false, error: "OAuth denied", category: "auth_revoked" };
    }
    return {
      ok: true,
      account: mockAccount(this.id, input.organizationId),
      pages:
        this.id === "facebook"
          ? [{ pageId: "page_1", name: "Sunchaser", tasks: ["CREATE_CONTENT", "ANALYZE"] }]
          : undefined,
    };
  }

  async refreshCredentials(account: ConnectedAccount): Promise<CredentialRefresh> {
    if (this.scenario === "expired_token") {
      return {
        ok: true,
        accountPatch: {
          accessTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          status: "active",
        },
        detail: "refreshed",
      };
    }
    if (this.scenario === "revoked_token") {
      return { ok: false, accountPatch: { status: "revoked" }, detail: "revoked" };
    }
    return { ok: true, accountPatch: { status: "active" }, detail: "ok" };
  }

  async validateCredentials(account: ConnectedAccount): Promise<CredentialStatus> {
    if (this.scenario === "revoked_token") {
      return { code: "revoked", isValid: false, expiresAt: null, scopes: [], detail: "revoked" };
    }
    if (this.scenario === "expired_token") {
      return { code: "expired", isValid: false, expiresAt: new Date().toISOString(), scopes: account.scopes, detail: "expired" };
    }
    return { code: "active", isValid: true, expiresAt: account.accessTokenExpiresAt, scopes: account.scopes, detail: "ok" };
  }

  publishText(job: PublishJob, account: ConnectedAccount, content: TextContent): Promise<PublishAttempt> {
    return this.publish(job, account, content.text ?? "");
  }
  publishImage(job: PublishJob, account: ConnectedAccount, content: ImageContent): Promise<PublishAttempt> {
    return this.publish(job, account, content.imageAssetId);
  }
  publishVideo(job: PublishJob, account: ConnectedAccount, content: VideoContent): Promise<PublishAttempt> {
    return this.publish(job, account, content.videoAssetId);
  }

  async getPublishStatus(_account: ConnectedAccount, handle: ProviderPublishHandle): Promise<PublishStatus> {
    if (!handle.providerObjectId) return { state: "unknown" };
    if (this.published.has(handle.providerObjectId)) {
      return { state: "published", providerObjectId: handle.providerObjectId };
    }
    if (this.scenario === "http_500") return { state: "unknown" };
    return { state: "not_found" };
  }

  async reconcilePublish(
    job: PublishJob,
    account: ConnectedAccount,
    handle: ProviderPublishHandle
  ): Promise<ReconcileResult> {
    const status = await this.getPublishStatus(account, handle);
    if (status.state === "published") {
      return {
        decision: "definitely_published",
        nextJobStatus: "published",
        providerObjectId: status.providerObjectId,
        detail: "Found provider object",
        republishAllowed: false,
      };
    }
    if (status.state === "not_found" && handle.providerObjectId) {
      return {
        decision: "manual_review",
        nextJobStatus: "needs_review",
        detail: "Provider id present but object not found — do not republish",
        republishAllowed: false,
      };
    }
    return {
      decision: "manual_review",
      nextJobStatus: "needs_review",
      detail: `Unknown outcome for job ${job.jobId}; reconciliation cannot prove failure`,
      republishAllowed: false,
    };
  }

  async disconnectAccount(_account: ConnectedAccount): Promise<void> {
    return;
  }

  private async publish(job: PublishJob, account: ConnectedAccount, fingerprint: string): Promise<PublishAttempt> {
    this.publishCalls += 1;
    const started = Date.now();
    const scenario = MOCK_SCENARIOS[this.scenario];
    const handle: ProviderPublishHandle = {
      provider: this.id,
      providerAccountId: account.providerUserId,
      attemptedAt: new Date().toISOString(),
      fingerprint: { textHash: fingerprint, assetId: job.idempotencyKey },
    };

    if (scenario.abortBeforeSend) {
      return {
        outcome: classifyTransportFailure({ requestSent: false, abortBeforeSend: true }),
        handle,
        httpStatus: null,
        category: "timeout_before_request",
        retryClass: "retry_new_attempt",
        detail: "timeout before request",
        durationMs: Date.now() - started,
      };
    }

    if (scenario.abortAfterSend) {
      return {
        outcome: "unknown",
        handle: { ...handle, providerObjectId: undefined },
        httpStatus: null,
        category: "timeout_after_possible_accept",
        retryClass: "retry_same_attempt_unknown",
        detail: "timeout after request may have been accepted — do not republish",
        durationMs: Date.now() - started,
      };
    }

    if (scenario.rawBody) {
      return {
        outcome: "unknown",
        handle,
        httpStatus: scenario.httpStatus ?? 200,
        category: "malformed_response",
        retryClass: "retry_same_attempt_unknown",
        detail: "malformed provider response",
        durationMs: Date.now() - started,
      };
    }

    const status = scenario.httpStatus ?? 200;
    if (status >= 200 && status < 300) {
      const id = `mock_${this.id}_${job.jobId}_${job.attemptNumber}`;
      this.published.set(id, { id, fingerprint });
      return {
        outcome: this.id === "tiktok" ? "provider_pending" : "accepted",
        handle: { ...handle, providerObjectId: id },
        httpStatus: status,
        category: null,
        retryClass: null,
        detail: "accepted",
        durationMs: Date.now() - started,
      };
    }

    const classified = classifyFacebookGraphError({
      httpStatus: status,
      code: (scenario.json as { error?: { code?: number } } | undefined)?.error?.code,
      error_subcode: (scenario.json as { error?: { error_subcode?: number } } | undefined)?.error
        ?.error_subcode,
      message: (scenario.json as { error?: { message?: string } } | undefined)?.error?.message,
    });

    return {
      outcome: "failed",
      handle,
      httpStatus: status,
      category: classified.category,
      retryClass: classified.retryClass,
      detail: `http ${status}`,
      durationMs: Date.now() - started,
    };
  }
}

export function mockAccount(
  provider: "facebook" | "tiktok",
  organizationId: string
): ConnectedAccount {
  return {
    accountId: `acct_${provider}_1`,
    organizationId,
    provider,
    providerUserId: provider === "facebook" ? "user_1" : "openid_1",
    displayName: "Mock Account",
    accessTokenEnvelope: "v1:bW9jaw==:bW9jaw==:bW9jaw==",
    pageTokenEnvelope: provider === "facebook" ? "v1:bW9jaw==:bW9jaw==:bW9jaw==" : undefined,
    pageId: provider === "facebook" ? "page_1" : undefined,
    scopes: provider === "facebook" ? ["pages_manage_posts"] : ["video.publish"],
    accessTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 31_536_000_000).toISOString(),
    pageTokenExpiresAt: null,
    status: "active",
  };
}

export function asProviderError(attempt: PublishAttempt): ProviderError | null {
  if (attempt.outcome !== "failed" || !attempt.category || !attempt.retryClass) return null;
  return new ProviderError({
    message: attempt.detail,
    category: attempt.category,
    retryClass: attempt.retryClass,
    httpStatus: attempt.httpStatus,
  });
}
