import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertAllowedProviderUrl, PROVIDER_ALLOWED_HOSTS, sendHttp } from "../src/providers/http.ts";
import { ProviderError } from "../src/providers/errors.ts";
import { facebookOAuthDialogUrl } from "../src/providers/facebook/tokens.ts";
import { tiktokAuthorizeUrl } from "../src/providers/tiktok/tokens.ts";
import { mayAutoRepublish } from "../src/scheduler/outcomes.ts";

describe("security invariants (provider layer)", () => {
  it("SSRF: provider HTTP allowlist rejects private and unknown hosts", () => {
    assert.throws(
      () => assertAllowedProviderUrl("http://graph.facebook.com/v26.0/me"),
      ProviderError
    );
    assert.throws(
      () => assertAllowedProviderUrl("https://169.254.169.254/latest/meta-data"),
      ProviderError
    );
    assert.throws(
      () => assertAllowedProviderUrl("https://evil.example/steal"),
      ProviderError
    );
    assert.ok(PROVIDER_ALLOWED_HOSTS.has("graph.facebook.com"));
    assert.ok(PROVIDER_ALLOWED_HOSTS.has("open.tiktokapis.com"));
    assertAllowedProviderUrl("https://graph.facebook.com/v26.0/me");
    assertAllowedProviderUrl("https://open.tiktokapis.com/v2/oauth/token/");
  });

  it("SSRF: FILE_UPLOAD / Reels upload hosts are allowlisted, other subdomains are not", () => {
    assertAllowedProviderUrl("https://open-upload.tiktokapis.com/video/?upload_id=1");
    assertAllowedProviderUrl("https://rupload.facebook.com/video-upload/v26.0/123");
    assert.throws(
      () => assertAllowedProviderUrl("https://attacker.tiktokapis.com/steal"),
      ProviderError
    );
    assert.throws(
      () => assertAllowedProviderUrl("https://graph.facebook.com.evil.example/"),
      ProviderError
    );
  });

  it("timeout after the request is handed to fetch is unknown, not a failed retryable post", async () => {
    await assert.rejects(
      () =>
        sendHttp(
          async (_req, signal) =>
            new Promise((_, reject) => {
              signal.addEventListener("abort", () => reject(new Error("aborted")));
            }),
          {
            url: "https://graph.facebook.com/v26.0/me",
            method: "GET",
            timeoutMs: 25,
          }
        ),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.category, "timeout_after_possible_accept");
        assert.equal(err.retryClass, "retry_same_attempt_unknown");
        return true;
      }
    );
  });

  it("OAuth dialog URLs include state (CSRF) and never embed secrets", () => {
    const fb = facebookOAuthDialogUrl({
      appId: "123",
      redirectUri: "https://publisher.example/oauth/facebook/callback",
      state: "csrf-token-abc",
    });
    assert.ok(fb.includes("state=csrf-token-abc"));
    assert.equal(fb.includes("secret"), false);
    const tt = tiktokAuthorizeUrl({
      clientKey: "ck",
      redirectUri: "https://publisher.example/oauth/tiktok/callback",
      state: "csrf-token-abc",
    });
    assert.ok(tt.includes("state=csrf-token-abc"));
    assert.equal(tt.includes("client_secret"), false);
  });

  it("unknown / needs_review / provider_pending / published never auto-republish", () => {
    for (const s of ["unknown", "needs_review", "provider_pending", "published", "processing", "cancelled"] as const) {
      assert.equal(mayAutoRepublish(s), false, s);
    }
    assert.equal(mayAutoRepublish("failed"), true);
  });
});
