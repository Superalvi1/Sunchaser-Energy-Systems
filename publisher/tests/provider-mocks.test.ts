import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockProvider, mockAccount } from "../src/mocks/MockProvider.ts";
import { ALL_MOCK_SCENARIOS } from "../src/mocks/scenarios.ts";
import { jobStatusFromAttempt, mayAutoRepublish } from "../src/scheduler/outcomes.ts";
import type { PublishJob } from "../src/providers/types.ts";

function job(): PublishJob {
  return {
    jobId: "job_1",
    organizationId: "org_1",
    accountId: "acct_facebook_1",
    idempotencyKey: "job_1:1",
    attemptNumber: 1,
    scheduledAt: new Date().toISOString(),
    mediaKind: "text",
  };
}

describe("MockProvider scenarios", () => {
  it("exposes every required scenario", () => {
    assert.deepEqual(
      [...ALL_MOCK_SCENARIOS].sort(),
      [
        "expired_token",
        "http_400",
        "http_401",
        "http_403",
        "http_429",
        "http_500",
        "malformed_response",
        "rate_limited",
        "revoked_token",
        "success",
        "timeout_after_accept",
        "timeout_before_request",
      ]
    );
  });

  it("success publishes without hitting a real network", async () => {
    const provider = new MockProvider({ scenario: "success" });
    const attempt = await provider.publishText(job(), mockAccount("facebook", "org_1"), {
      text: "hello",
    });
    assert.equal(attempt.outcome, "accepted");
    assert.ok(attempt.handle.providerObjectId);
    assert.equal(jobStatusFromAttempt(attempt), "published");
  });

  it("timeout_before_request is a failed attempt that may retry", async () => {
    const provider = new MockProvider({ scenario: "timeout_before_request" });
    const attempt = await provider.publishText(job(), mockAccount("facebook", "org_1"), {
      text: "hello",
    });
    assert.equal(attempt.outcome, "failed");
    assert.equal(attempt.category, "timeout_before_request");
    assert.equal(mayAutoRepublish(jobStatusFromAttempt(attempt)), true);
  });

  it("timeout_after_accept is unknown and must not auto-republish", async () => {
    const provider = new MockProvider({ scenario: "timeout_after_accept" });
    const attempt = await provider.publishText(job(), mockAccount("facebook", "org_1"), {
      text: "hello",
    });
    assert.equal(attempt.outcome, "unknown");
    assert.equal(attempt.category, "timeout_after_possible_accept");
    assert.equal(mayAutoRepublish(jobStatusFromAttempt(attempt)), false);
    const rec = await provider.reconcilePublish(job(), mockAccount("facebook", "org_1"), attempt.handle);
    assert.equal(rec.republishAllowed, false);
    assert.equal(rec.decision, "manual_review");
  });

  it("malformed_response is unknown", async () => {
    const provider = new MockProvider({ scenario: "malformed_response" });
    const attempt = await provider.publishText(job(), mockAccount("facebook", "org_1"), {
      text: "hello",
    });
    assert.equal(attempt.outcome, "unknown");
    assert.equal(attempt.category, "malformed_response");
  });

  for (const name of ["http_400", "http_401", "http_403", "http_429", "http_500", "expired_token", "revoked_token", "rate_limited"] as const) {
    it(`${name} returns failed with a classified category`, async () => {
      const provider = new MockProvider({ scenario: name });
      const attempt = await provider.publishText(job(), mockAccount("facebook", "org_1"), {
        text: "hello",
      });
      assert.equal(attempt.outcome, "failed");
      assert.ok(attempt.httpStatus && attempt.httpStatus >= 400);
      assert.ok(attempt.category);
    });
  }
});
