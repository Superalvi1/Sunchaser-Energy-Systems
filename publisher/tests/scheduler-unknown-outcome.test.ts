import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockProvider, mockAccount } from "../src/mocks/MockProvider.ts";
import {
  classifyTransportFailure,
  jobStatusFromAttempt,
  mayAutoRepublish,
  mayStartNewPublishAttempt,
  nextIdempotencyKey,
} from "../src/scheduler/outcomes.ts";
import { recordAttempt, InMemoryMetrics } from "../src/observability/metrics.ts";
import type { PublishJob } from "../src/providers/types.ts";

function job(n = 1): PublishJob {
  return {
    jobId: "job_dup",
    organizationId: "org_1",
    accountId: "acct_1",
    idempotencyKey: nextIdempotencyKey("job_dup", n),
    attemptNumber: n,
    scheduledAt: new Date().toISOString(),
    mediaKind: "image",
  };
}

describe("duplicate-post protection", () => {
  it("does not start a new publish after unknown", async () => {
    const provider = new MockProvider({ scenario: "timeout_after_accept" });
    const attempt = await provider.publishImage(job(), mockAccount("facebook", "org_1"), {
      imageAssetId: "asset_1",
      contentType: "image/jpeg",
      byteLength: 12_000,
    });
    const status = jobStatusFromAttempt(attempt);
    assert.equal(status, "unknown");
    assert.equal(mayStartNewPublishAttempt(status), false);
    assert.equal(mayAutoRepublish(status), false);
    assert.equal(provider.publishCalls, 1);
  });

  it("classifies pre-send timeout as failed (retryable) and post-send as unknown", () => {
    assert.equal(
      classifyTransportFailure({ requestSent: false, abortBeforeSend: true }),
      "failed"
    );
    assert.equal(
      classifyTransportFailure({ requestSent: true, abortBeforeSend: false }),
      "unknown"
    );
  });

  it("records unknown metric separately from failures", async () => {
    const metrics = new InMemoryMetrics();
    const provider = new MockProvider({ scenario: "timeout_after_accept" });
    const attempt = await provider.publishText(job(), mockAccount("facebook", "org_1"), {
      text: "x",
    });
    recordAttempt(metrics, {
      provider: "facebook",
      outcome: attempt.outcome,
      durationMs: attempt.durationMs,
      httpStatus: attempt.httpStatus,
      category: attempt.category,
      isRetry: false,
    });
    assert.equal(metrics.get("publisher.posts.unknown", { provider: "facebook" }), 1);
    assert.equal(metrics.get("publisher.posts.published", { provider: "facebook" }), 0);
  });
});
