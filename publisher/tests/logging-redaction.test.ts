import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactString, redactValue, assertNoSecrets } from "../src/logging/redact.ts";
import { publishLogFields } from "../src/logging/structured.ts";

describe("secret redaction", () => {
  it("strips bearer tokens, access_token query params, and envelopes", () => {
    const raw =
      "Authorization: Bearer EAAG1234567890abcdef TOKEN access_token=EAAGSECRET&x=1 v1:aaa:bbb:ccc";
    const out = redactString(raw);
    assert.equal(out.includes("EAAG1234567890abcdef"), false);
    assert.equal(out.includes("EAAGSECRET"), false);
    assert.equal(out.includes("v1:aaa:bbb:ccc"), false);
    assert.ok(out.includes("[redacted]"));
  });

  it("redacts object keys named access_token / refresh_token / authorization", () => {
    const redacted = redactValue({
      access_token: "secret",
      refresh_token: "secret2",
      Authorization: "Bearer abc",
      job_id: "job_1",
    }) as Record<string, unknown>;
    assert.equal(redacted.access_token, "[redacted]");
    assert.equal(redacted.refresh_token, "[redacted]");
    assert.equal(redacted.Authorization, "[redacted]");
    assert.equal(redacted.job_id, "job_1");
  });

  it("structured publish logs never include tokens", () => {
    const fields = publishLogFields({
      msg: "publish",
      jobId: "job_1",
      organizationId: "org_1",
      accountId: "acct_1",
      provider: "facebook",
      attemptNumber: 1,
      status: "unknown",
      providerErrorCategory: "timeout_after_possible_accept",
      durationMs: 42,
    });
    assertNoSecrets(fields);
    assert.equal(fields.job_id, "job_1");
    assert.equal(fields.organization_id, "org_1");
    assert.equal(fields.provider, "facebook");
  });
});
