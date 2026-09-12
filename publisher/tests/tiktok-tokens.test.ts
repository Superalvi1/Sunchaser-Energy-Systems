import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TIKTOK_ACCESS_TOKEN_SECONDS,
  TIKTOK_REFRESH_TOKEN_SECONDS,
  applyTikTokTokenResponse,
  shouldRefreshTikTokAccessToken,
} from "../src/providers/tiktok/tokens.ts";
import { classifyTikTokError } from "../src/providers/errors.ts";
import { TikTokProvider } from "../src/providers/tiktok/TikTokProvider.ts";
import { createScenarioFetch } from "../src/mocks/httpMock.ts";
import { encryptSecret, decryptSecret } from "../src/crypto/tokenEnvelope.ts";
import { randomBytes } from "node:crypto";
import { mockAccount } from "../src/mocks/MockProvider.ts";
import { planTikTokFileUpload } from "../src/providers/tiktok/chunking.ts";

describe("TikTok token lifecycle", () => {
  it("documents 24h access / 365d refresh", () => {
    assert.equal(TIKTOK_ACCESS_TOKEN_SECONDS, 86_400);
    assert.equal(TIKTOK_REFRESH_TOKEN_SECONDS, 31_536_000);
  });

  it("rotates refresh_token when the provider returns a new value", () => {
    const now = new Date("2026-09-12T12:00:00Z");
    const next = applyTikTokTokenResponse(
      {
        access_token: "new-access",
        refresh_token: "rotated-refresh",
        expires_in: 86400,
        refresh_expires_in: 31536000,
        open_id: "oid",
        scope: "user.info.basic,video.publish",
      },
      { refreshToken: "old-refresh" },
      now
    );
    assert.equal(next.refreshToken, "rotated-refresh");
    assert.equal(next.accessToken, "new-access");
    assert.ok(next.scope.includes("video.publish"));
  });

  it("keeps the previous refresh_token when the field is omitted", () => {
    const now = new Date();
    const next = applyTikTokTokenResponse(
      { access_token: "a", open_id: "oid", expires_in: 86400 },
      { refreshToken: "keep-me" },
      now
    );
    assert.equal(next.refreshToken, "keep-me");
  });

  it("refreshes access tokens within 1 hour of expiry", () => {
    const now = new Date("2026-09-12T12:00:00Z");
    assert.equal(
      shouldRefreshTikTokAccessToken({
        now,
        expiresAt: new Date("2026-09-12T12:30:00Z"),
      }),
      true
    );
    assert.equal(
      shouldRefreshTikTokAccessToken({
        now,
        expiresAt: new Date("2026-09-13T12:00:00Z"),
      }),
      false
    );
  });

  it("classifies access_token_invalid as expired (refresh) unless revoked wording", () => {
    const expired = classifyTikTokError({ code: "access_token_invalid" });
    assert.equal(expired.category, "auth_expired");
    const revoked = classifyTikTokError({
      code: "access_token_invalid",
      message: "refresh token revoked",
    });
    assert.equal(revoked.category, "auth_revoked");
  });
});

describe("TikTokProvider against HTTP mocks", () => {
  it("text-only publish is a definite failure (unsupported)", async () => {
    const key = randomBytes(32);
    const provider = new TikTokProvider({
      config: { clientKey: "k", clientSecret: "s", redirectUri: "https://x/cb" },
      encrypt: (p) => encryptSecret(p, key),
      decrypt: (s) => decryptSecret(s, key),
    });
    const attempt = await provider.publishText(
      {
        jobId: "j",
        organizationId: "o",
        accountId: "a",
        idempotencyKey: "j:1",
        attemptNumber: 1,
        scheduledAt: new Date().toISOString(),
        mediaKind: "text",
      },
      mockAccount("tiktok", "o"),
      { text: "nope" }
    );
    assert.equal(attempt.outcome, "failed");
    assert.equal(attempt.retryClass, "do_not_retry");
  });

  it("timeout after init is unknown and does not invent a second publish_id", async () => {
    const key = randomBytes(32);
    const { fetchLike } = createScenarioFetch("timeout_after_accept");
    const provider = new TikTokProvider({
      config: { clientKey: "k", clientSecret: "s", redirectUri: "https://x/cb" },
      encrypt: (p) => encryptSecret(p, key),
      decrypt: (s) => decryptSecret(s, key),
      fetchLike,
    });
    const account = mockAccount("tiktok", "org");
    account.accessTokenEnvelope = encryptSecret("tok", key);
    account.refreshTokenEnvelope = encryptSecret("ref", key);
    account.accessTokenExpiresAt = new Date(Date.now() + 10 * 3600_000).toISOString();
    const attempt = await provider.publishVideo(
      {
        jobId: "j2",
        organizationId: "org",
        accountId: account.accountId,
        idempotencyKey: "j2:1",
        attemptNumber: 1,
        scheduledAt: new Date().toISOString(),
        mediaKind: "video",
      },
      account,
      {
        videoAssetId: "vid",
        contentType: "video/mp4",
        byteLength: 2_000_000,
        kind: "video",
      }
    );
    assert.equal(attempt.outcome, "unknown");
    assert.equal(attempt.retryClass, "retry_same_attempt_unknown");
  });

  it("planner and provider agree on declared chunk count for 51MB", () => {
    const plan = planTikTokFileUpload(51_000_000);
    assert.equal(plan.totalChunkCount, plan.ranges.length);
    assert.equal(plan.totalChunkCount, Math.floor(51_000_000 / plan.chunkSize));
    assert.ok(plan.totalChunkCount >= 2);
  });

  it("unaudited apps force SELF_ONLY even when creator_info offers PUBLIC_TO_EVERYONE", async () => {
    const key = randomBytes(32);
    let initBody = "";
    const fetchLike = async (req: { url: string; body?: string | Uint8Array | null }) => {
      if (req.url.includes("creator_info")) {
        return {
          status: 200,
          headers: {},
          bodyText: JSON.stringify({
            data: {
              creator_username: "demo",
              privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
            },
            error: { code: "ok" },
          }),
        };
      }
      initBody = typeof req.body === "string" ? req.body : "";
      return {
        status: 200,
        headers: {},
        bodyText: JSON.stringify({
          data: {
            publish_id: "v_pub_file~v2.123",
            upload_url: "https://open-upload.tiktokapis.com/video/?upload_id=1",
          },
          error: { code: "ok" },
        }),
      };
    };
    const provider = new TikTokProvider({
      config: { clientKey: "k", clientSecret: "s", redirectUri: "https://x/cb" },
      encrypt: (p) => encryptSecret(p, key),
      decrypt: (s) => decryptSecret(s, key),
      fetchLike,
      unauditedApp: true,
    });
    const account = mockAccount("tiktok", "org");
    account.accessTokenEnvelope = encryptSecret("tok", key);
    account.refreshTokenEnvelope = encryptSecret("ref", key);
    account.accessTokenExpiresAt = new Date(Date.now() + 10 * 3600_000).toISOString();
    const attempt = await provider.publishVideo(
      {
        jobId: "j3",
        organizationId: "org",
        accountId: account.accountId,
        idempotencyKey: "j3:1",
        attemptNumber: 1,
        scheduledAt: new Date().toISOString(),
        mediaKind: "video",
      },
      account,
      {
        videoAssetId: "vid",
        contentType: "video/mp4",
        byteLength: 2_000_000,
        kind: "video",
      }
    );
    assert.equal(attempt.outcome, "provider_pending");
    assert.equal(attempt.handle.providerObjectId, "v_pub_file~v2.123");
    assert.ok(initBody.includes("SELF_ONLY"));
    assert.equal(initBody.includes("PUBLIC_TO_EVERYONE"), false);
  });
});
