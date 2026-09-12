import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockProvider, mockAccount } from "../src/mocks/MockProvider.ts";
import { reconcileOne } from "../src/reconciliation/worker.ts";
import { nextIdempotencyKey } from "../src/scheduler/outcomes.ts";
import type { PublishJob } from "../src/providers/types.ts";

function job(): PublishJob {
  return {
    jobId: "job_r",
    organizationId: "org_1",
    accountId: "acct_1",
    idempotencyKey: nextIdempotencyKey("job_r", 1),
    attemptNumber: 1,
    scheduledAt: new Date().toISOString(),
    mediaKind: "text",
  };
}

describe("reconciliation worker", () => {
  it("skips fresh processing locks", async () => {
    const provider = new MockProvider({ scenario: "success" });
    const result = await reconcileOne(provider, {
      job: job(),
      status: "processing",
      account: mockAccount("facebook", "org_1"),
      handle: {
        provider: "facebook",
        attemptedAt: new Date().toISOString(),
        fingerprint: {},
      },
      processingSince: new Date().toISOString(),
    });
    assert.equal("skipped" in result && result.skipped, true);
  });

  it("marks unknown without provider id as manual review — never republish", async () => {
    const provider = new MockProvider({ scenario: "timeout_after_accept" });
    const result = await reconcileOne(provider, {
      job: job(),
      status: "unknown",
      account: mockAccount("facebook", "org_1"),
      handle: {
        provider: "facebook",
        attemptedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        fingerprint: {},
      },
      unknownSince: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    assert.equal("skipped" in result, false);
    if (!("skipped" in result)) {
      assert.equal(result.decision, "manual_review");
      assert.equal(result.republishAllowed, false);
      assert.equal(result.nextJobStatus, "needs_review");
    }
  });

  it("promotes to published when the provider object exists", async () => {
    const provider = new MockProvider({
      scenario: "success",
      publishedIds: ["post_abc"],
    });
    const result = await reconcileOne(provider, {
      job: job(),
      status: "unknown",
      account: mockAccount("facebook", "org_1"),
      handle: {
        provider: "facebook",
        providerObjectId: "post_abc",
        attemptedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        fingerprint: {},
      },
      unknownSince: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    if (!("skipped" in result)) {
      assert.equal(result.decision, "definitely_published");
      assert.equal(result.nextJobStatus, "published");
      assert.equal(result.republishAllowed, false);
    } else {
      assert.fail("should not skip");
    }
  });
});
