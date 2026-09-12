import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FacebookProvider } from "../src/providers/facebook/FacebookProvider.ts";
import { createScenarioFetch } from "../src/mocks/httpMock.ts";
import {
  FACEBOOK_REQUIRED_SCOPES,
  interpretDebugToken,
  missingFacebookScopes,
  pageAllowsCreateContent,
  shouldReexchangeUserToken,
} from "../src/providers/facebook/tokens.ts";
import { classifyFacebookGraphError } from "../src/providers/errors.ts";
import { encryptSecret, decryptSecret } from "../src/crypto/tokenEnvelope.ts";
import { randomBytes } from "node:crypto";
import { mockAccount } from "../src/mocks/MockProvider.ts";

describe("Facebook token lifecycle", () => {
  it("requires CREATE_CONTENT on the selected Page", () => {
    assert.equal(pageAllowsCreateContent(["ANALYZE"]), false);
    assert.equal(pageAllowsCreateContent(["CREATE_CONTENT", "ANALYZE"]), true);
  });

  it("detects missing pages_manage_posts", () => {
    const missing = missingFacebookScopes(["pages_show_list", "public_profile"]);
    assert.ok(missing.includes("pages_manage_posts"));
    assert.ok(FACEBOOK_REQUIRED_SCOPES.includes("pages_manage_posts"));
  });

  it("only reexchanges long-lived user tokens that are ≥24h old and near expiry", () => {
    const now = new Date("2026-09-12T12:00:00Z");
    const issuedAt = new Date("2026-09-12T11:00:00Z");
    const expiresAt = new Date("2026-09-14T12:00:00Z");
    assert.equal(shouldReexchangeUserToken({ now, issuedAt, expiresAt }), false);
    const oldIssued = new Date("2026-07-20T12:00:00Z");
    const nearExpiry = new Date("2026-09-16T12:00:00Z");
    assert.equal(
      shouldReexchangeUserToken({ now, issuedAt: oldIssued, expiresAt: nearExpiry }),
      true
    );
  });

  it("debug_token: expires_at in the past is expired; is_valid false while unexpired is revoked", () => {
    const now = new Date("2026-09-12T12:00:00Z");
    const expired = interpretDebugToken({ is_valid: false, expires_at: 1 }, now);
    assert.equal(expired.expired, true);
    const revoked = interpretDebugToken(
      { is_valid: false, expires_at: Math.floor(now.getTime() / 1000) + 3600 },
      now
    );
    assert.equal(revoked.revoked, true);
    assert.equal(revoked.expired, false);
  });

  it("classifies 190/463 as expired (refresh) and 190/460 as revoked (reconnect)", () => {
    const expired = classifyFacebookGraphError({
      code: 190,
      error_subcode: 463,
      message: "Session has expired",
    });
    assert.equal(expired.category, "auth_expired");
    assert.equal(expired.retryClass, "refresh_then_retry");
    const revoked = classifyFacebookGraphError({
      code: 190,
      error_subcode: 460,
      message: "session has been invalidated",
    });
    assert.equal(revoked.category, "auth_revoked");
    assert.equal(revoked.retryClass, "do_not_retry");
  });

  it("does not leak page access tokens and does not bind a Page until the user picks one", async () => {
    const key = randomBytes(32);
    const fetchLike = async (req: { url: string }) => {
      const url = req.url;
      if (url.includes("/oauth/access_token")) {
        return {
          status: 200,
          headers: {},
          bodyText: JSON.stringify({ access_token: "LONG_USER_TOKEN", expires_in: 5_184_000 }),
        };
      }
      if (url.includes("/me")) {
        return { status: 200, headers: {}, bodyText: JSON.stringify({ id: "u1", name: "Ada" }) };
      }
      if (url.includes("/accounts")) {
        return {
          status: 200,
          headers: {},
          bodyText: JSON.stringify({
            data: [
              {
                id: "page_a",
                name: "Page A",
                access_token: "PAGE_TOKEN_SECRET_A",
                tasks: ["CREATE_CONTENT", "ANALYZE"],
              },
              {
                id: "page_b",
                name: "Page B",
                access_token: "PAGE_TOKEN_SECRET_B",
                tasks: ["ANALYZE"],
              },
            ],
          }),
        };
      }
      return { status: 404, headers: {}, bodyText: "{}" };
    };
    const provider = new FacebookProvider({
      config: {
        appId: "app",
        appSecret: "secret",
        redirectUri: "https://publisher.example/oauth/facebook/callback",
      },
      encrypt: (p) => encryptSecret(p, key),
      decrypt: (s) => decryptSecret(s, key),
      fetchLike,
    });
    const pending = await provider.connectAccount({
      organizationId: "org_1",
      authorizationCode: "code",
      redirectUri: "https://publisher.example/oauth/facebook/callback",
      state: "csrf",
    });
    assert.equal(pending.ok, true);
    if (!pending.ok) throw new Error("expected ok");
    assert.equal(pending.requiresPageSelection, true);
    assert.equal(pending.account, undefined);
    assert.equal(pending.pages?.length, 1);
    assert.equal(pending.pages?.[0]?.pageId, "page_a");
    const serialized = JSON.stringify(pending);
    assert.equal(serialized.includes("PAGE_TOKEN_SECRET"), false);
    assert.equal("access_token" in (pending.pages?.[0] ?? {}), false);

    const bound = await provider.connectAccount({
      organizationId: "org_1",
      authorizationCode: "code",
      redirectUri: "https://publisher.example/oauth/facebook/callback",
      state: "csrf",
      selectedPageId: "page_a",
    });
    assert.equal(bound.ok, true);
    if (!bound.ok || !bound.account) throw new Error("expected bound account");
    assert.equal(bound.account.pageId, "page_a");
    assert.equal(decryptSecret(bound.account.pageTokenEnvelope!, key), "PAGE_TOKEN_SECRET_A");
    assert.ok(bound.account.tokenIssuedAt);

    const denied = await provider.connectAccount({
      organizationId: "org_1",
      authorizationCode: "code",
      redirectUri: "https://publisher.example/oauth/facebook/callback",
      state: "csrf",
      selectedPageId: "page_b",
    });
    assert.equal(denied.ok, false);
  });

  it("expired_token scenario via mock HTTP is classified, not retried as a new post", async () => {
    const key = randomBytes(32);
    const { fetchLike } = createScenarioFetch("expired_token");
    const provider = new FacebookProvider({
      config: { appId: "app", appSecret: "secret", redirectUri: "https://x/cb" },
      encrypt: (p) => encryptSecret(p, key),
      decrypt: (s) => decryptSecret(s, key),
      fetchLike,
    });
    const account = mockAccount("facebook", "org_1");
    account.accessTokenEnvelope = encryptSecret("user-token", key);
    account.pageTokenEnvelope = encryptSecret("page-token", key);
    const attempt = await provider.publishText(
      {
        jobId: "j1",
        organizationId: "org_1",
        accountId: account.accountId,
        idempotencyKey: "j1:1",
        attemptNumber: 1,
        scheduledAt: new Date().toISOString(),
        mediaKind: "text",
      },
      account,
      { text: "hello" }
    );
    assert.equal(attempt.outcome, "failed");
    assert.equal(attempt.category, "auth_expired");
  });
});
