import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomBytes } from "node:crypto";
import { FacebookProvider } from "../src/providers/facebook/FacebookProvider.ts";
import { encryptSecret, decryptSecret } from "../src/crypto/tokenEnvelope.ts";
import { createScenarioFetch } from "../src/mocks/httpMock.ts";
import { mockAccount } from "../src/mocks/MockProvider.ts";
import type { PublishJob } from "../src/providers/types.ts";

function job(): PublishJob {
  return {
    jobId: "fb_job",
    organizationId: "org",
    accountId: "acct",
    idempotencyKey: "fb_job:1",
    attemptNumber: 1,
    scheduledAt: new Date().toISOString(),
    mediaKind: "text",
  };
}

describe("FacebookProvider HTTP scenarios", () => {
  const key = randomBytes(32);

  function make(scenario: Parameters<typeof createScenarioFetch>[0]) {
    const { fetchLike, calls } = createScenarioFetch(scenario);
    const provider = new FacebookProvider({
      config: { appId: "id", appSecret: "secret", redirectUri: "https://x/cb" },
      encrypt: (p) => encryptSecret(p, key),
      decrypt: (s) => decryptSecret(s, key),
      fetchLike,
    });
    const account = mockAccount("facebook", "org");
    account.accessTokenEnvelope = encryptSecret("user", key);
    account.pageTokenEnvelope = encryptSecret("page", key);
    return { provider, account, calls };
  }

  it("success stores provider object id", async () => {
    const { provider, account } = make("success");
    const attempt = await provider.publishText(job(), account, { text: "hello" });
    assert.equal(attempt.outcome, "accepted");
    assert.equal(attempt.handle.providerObjectId, "mock_post_1");
  });

  it("429 is rate_limited / retry_new_attempt", async () => {
    const { provider, account } = make("http_429");
    const attempt = await provider.publishText(job(), account, { text: "hello" });
    assert.equal(attempt.outcome, "failed");
    assert.equal(attempt.category, "rate_limited");
    assert.equal(attempt.retryClass, "retry_new_attempt");
  });

  it("403 is permission_denied / do_not_retry", async () => {
    const { provider, account } = make("http_403");
    const attempt = await provider.publishText(job(), account, { text: "hello" });
    assert.equal(attempt.category, "permission_denied");
    assert.equal(attempt.retryClass, "do_not_retry");
  });

  it("timeout_after_accept becomes unknown", async () => {
    const { provider, account } = make("timeout_after_accept");
    const attempt = await provider.publishText(job(), account, { text: "hello" });
    assert.equal(attempt.outcome, "unknown");
  });

  it("malformed JSON at 200 is unknown, not published", async () => {
    const { provider, account } = make("malformed_response");
    const attempt = await provider.publishText(job(), account, { text: "hello" });
    assert.equal(attempt.outcome, "unknown");
    assert.equal(attempt.category, "malformed_response");
  });
});
