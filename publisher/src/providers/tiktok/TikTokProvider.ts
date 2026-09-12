import type { SocialProvider } from "../SocialProvider.ts";
import { classifyTikTokError, ProviderError } from "../errors.ts";
import type { FetchLike } from "../http.ts";
import {
  assertAllowedProviderUrl,
  isMalformedJson,
  nodeFetchAdapter,
  parseJsonBody,
  sendHttp,
} from "../http.ts";
import type {
  Clock,
  ConnectInput,
  ConnectResult,
  ConnectedAccount,
  CredentialRefresh,
  CredentialStatus,
  DecryptFn,
  EncryptFn,
  ImageContent,
  PublishAttempt,
  PublishJob,
  PublishStatus,
  ProviderPublishHandle,
  ReconcileResult,
  TextContent,
  VideoContent,
} from "../types.ts";
import { systemClock } from "../types.ts";
import {
  TIKTOK_API_HOST,
  TIKTOK_REQUIRED_SCOPES,
  applyTikTokTokenResponse,
  missingTikTokScopes,
  shouldRefreshTikTokAccessToken,
  type TikTokOAuthConfig,
} from "./tokens.ts";
import { contentRangeHeader, planTikTokFileUpload } from "./chunking.ts";

export type TikTokProviderDeps = {
  config: TikTokOAuthConfig;
  decrypt: DecryptFn;
  encrypt: EncryptFn;
  fetchLike?: FetchLike;
  clock?: Clock;
  timeoutMs?: number;
  /** Unaudited apps must force SELF_ONLY. Default true until audit is confirmed. */
  unauditedApp?: boolean;
};

const DEFAULT_TIMEOUT_MS = 30_000;

export type CreatorInfo = {
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
};

export class TikTokProvider implements SocialProvider {
  readonly id = "tiktok" as const;
  private readonly cfg: TikTokOAuthConfig;
  private readonly decrypt: DecryptFn;
  private readonly encrypt: EncryptFn;
  private readonly fetchLike: FetchLike;
  private readonly clock: Clock;
  private readonly timeoutMs: number;
  private readonly unauditedApp: boolean;

  constructor(deps: TikTokProviderDeps) {
    this.cfg = deps.config;
    this.decrypt = deps.decrypt;
    this.encrypt = deps.encrypt;
    this.fetchLike = deps.fetchLike ?? nodeFetchAdapter;
    this.clock = deps.clock ?? systemClock;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.unauditedApp = deps.unauditedApp ?? true;
  }

  async connectAccount(input: ConnectInput): Promise<ConnectResult> {
    try {
      const tokens = await this.exchangeCode(input.authorizationCode, input.redirectUri);
      const missing = missingTikTokScopes(tokens.scope);
      if (missing.length) {
        return {
          ok: false,
          error: `Missing TikTok scopes: ${missing.join(",")}`,
          category: "permission_denied",
        };
      }
      return {
        ok: true,
        account: {
          accountId: `tt_${tokens.openId}`,
          organizationId: input.organizationId,
          provider: "tiktok",
          providerUserId: tokens.openId,
          displayName: tokens.openId,
          accessTokenEnvelope: this.encrypt(tokens.accessToken),
          refreshTokenEnvelope: this.encrypt(tokens.refreshToken),
          scopes: tokens.scope,
          accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
          tokenIssuedAt: this.clock.now().toISOString(),
          pageTokenExpiresAt: null,
          status: "active",
          tiktokUnaudited: this.unauditedApp,
        },
      };
    } catch (err) {
      if (err instanceof ProviderError) {
        return { ok: false, error: err.message, category: err.category };
      }
      return { ok: false, error: "TikTok connect failed", category: "unknown" };
    }
  }

  async refreshCredentials(account: ConnectedAccount): Promise<CredentialRefresh> {
    if (!account.refreshTokenEnvelope) {
      return { ok: false, accountPatch: { status: "needs_reconnect" }, detail: "no refresh token" };
    }
    const now = this.clock.now();
    const expiresAt = account.accessTokenExpiresAt
      ? new Date(account.accessTokenExpiresAt)
      : now;
    if (!shouldRefreshTikTokAccessToken({ now, expiresAt })) {
      return { ok: true, accountPatch: { status: "active" }, detail: "not due" };
    }
    const refreshToken = this.decrypt(account.refreshTokenEnvelope);
    try {
      const json = await this.tokenRequest({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      const next = applyTikTokTokenResponse(
        json,
        {
          refreshToken,
          refreshTokenExpiresAt: account.refreshTokenExpiresAt
            ? new Date(account.refreshTokenExpiresAt)
            : undefined,
        },
        now
      );
      return {
        ok: true,
        accountPatch: {
          accessTokenEnvelope: this.encrypt(next.accessToken),
          refreshTokenEnvelope: this.encrypt(next.refreshToken),
          accessTokenExpiresAt: next.accessTokenExpiresAt.toISOString(),
          refreshTokenExpiresAt: next.refreshTokenExpiresAt.toISOString(),
          tokenIssuedAt: now.toISOString(),
          scopes: next.scope.length ? next.scope : account.scopes,
          status: "active",
        },
        detail: next.refreshToken !== refreshToken ? "rotated refresh token" : "refreshed access token",
      };
    } catch (err) {
      if (err instanceof ProviderError && (err.category === "auth_revoked" || err.category === "auth_expired")) {
        return { ok: false, accountPatch: { status: "revoked" }, detail: "refresh rejected" };
      }
      return { ok: false, accountPatch: { status: "needs_refresh" }, detail: "refresh failed" };
    }
  }

  async validateCredentials(account: ConnectedAccount): Promise<CredentialStatus> {
    const token = this.decrypt(account.accessTokenEnvelope);
    try {
      const info = await this.queryCreatorInfo(token);
      return {
        code: "active",
        isValid: true,
        expiresAt: account.accessTokenExpiresAt,
        scopes: account.scopes,
        detail: info.creator_username ?? "ok",
      };
    } catch (err) {
      if (err instanceof ProviderError && err.category === "auth_revoked") {
        return { code: "revoked", isValid: false, expiresAt: null, scopes: account.scopes, detail: "revoked" };
      }
      if (err instanceof ProviderError && err.category === "auth_expired") {
        return {
          code: "expired",
          isValid: false,
          expiresAt: account.accessTokenExpiresAt,
          scopes: account.scopes,
          detail: "expired",
        };
      }
      return { code: "needs_reconnect", isValid: false, expiresAt: account.accessTokenExpiresAt, scopes: account.scopes, detail: "validate failed" };
    }
  }

  async publishText(_job: PublishJob, _account: ConnectedAccount, _content: TextContent): Promise<PublishAttempt> {
    return {
      outcome: "failed",
      handle: {
        provider: "tiktok",
        attemptedAt: this.clock.now().toISOString(),
        fingerprint: {},
      },
      httpStatus: null,
      category: "invalid_request",
      retryClass: "do_not_retry",
      detail: "TikTok Content Posting API does not support text-only posts",
      durationMs: 0,
    };
  }

  async publishImage(job: PublishJob, account: ConnectedAccount, content: ImageContent): Promise<PublishAttempt> {
    const started = Date.now();
    const handle: ProviderPublishHandle = {
      provider: "tiktok",
      providerAccountId: account.providerUserId,
      attemptedAt: this.clock.now().toISOString(),
      fingerprint: { assetId: content.imageAssetId, byteLength: content.byteLength },
    };
    try {
      await this.ensureFresh(account);
      const token = this.decrypt(account.accessTokenEnvelope);
      const creator = await this.queryCreatorInfo(token);
      const privacy = this.selectPrivacy(creator.privacy_level_options);
      const body = {
        media_type: "PHOTO",
        post_mode: "DIRECT_POST",
        post_info: {
          title: (content.text ?? "").slice(0, 90),
          privacy_level: privacy,
          disable_comment: false,
          auto_add_music: true,
          brand_content_toggle: false,
          brand_organic_toggle: false,
        },
        source_info: {
          source: "FILE_UPLOAD",
          photo_images: [{ image_size: content.byteLength }],
        },
      };
      return await this.initPublish(job, handle, token, `${TIKTOK_API_HOST}/v2/post/publish/content/init/`, body, started);
    } catch (err) {
      return transportAttempt(err, handle, started);
    }
  }

  async publishVideo(job: PublishJob, account: ConnectedAccount, content: VideoContent): Promise<PublishAttempt> {
    const started = Date.now();
    const handle: ProviderPublishHandle = {
      provider: "tiktok",
      providerAccountId: account.providerUserId,
      attemptedAt: this.clock.now().toISOString(),
      fingerprint: { assetId: content.videoAssetId, byteLength: content.byteLength },
    };
    try {
      await this.ensureFresh(account);
      const token = this.decrypt(account.accessTokenEnvelope);
      const creator = await this.queryCreatorInfo(token);
      if (
        content.durationSec &&
        creator.max_video_post_duration_sec &&
        content.durationSec > creator.max_video_post_duration_sec
      ) {
        return {
          outcome: "failed",
          handle,
          httpStatus: null,
          category: "media_rejected",
          retryClass: "do_not_retry",
          detail: "video longer than creator max_video_post_duration_sec",
          durationMs: Date.now() - started,
        };
      }
      const privacy = this.selectPrivacy(creator.privacy_level_options);
      const plan = planTikTokFileUpload(content.byteLength);
      const body = {
        post_info: {
          title: (content.text ?? "").slice(0, 2200),
          privacy_level: privacy,
          disable_duet: Boolean(creator.duet_disabled),
          disable_comment: Boolean(creator.comment_disabled),
          disable_stitch: Boolean(creator.stitch_disabled),
          video_cover_timestamp_ms: content.coverTimestampMs ?? 1000,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: plan.videoSize,
          chunk_size: plan.chunkSize,
          total_chunk_count: plan.totalChunkCount,
        },
      };
      const init = await this.initPublish(
        job,
        handle,
        token,
        `${TIKTOK_API_HOST}/v2/post/publish/video/init/`,
        body,
        started
      );
      if (init.outcome !== "provider_pending" && init.outcome !== "accepted") return init;
      if (!content.bytes) return init;
      const uploadUrl = (init as PublishAttempt & { uploadUrl?: string }).uploadUrl;
      if (!uploadUrl) return init;
      await this.uploadChunks(uploadUrl, content.bytes, plan, content.contentType);
      return init;
    } catch (err) {
      return transportAttempt(err, handle, started);
    }
  }

  async getPublishStatus(account: ConnectedAccount, handle: ProviderPublishHandle): Promise<PublishStatus> {
    if (!handle.providerObjectId) return { state: "unknown" };
    const token = this.decrypt(account.accessTokenEnvelope);
    const url = `${TIKTOK_API_HOST}/v2/post/publish/status/fetch/`;
    assertAllowedProviderUrl(url);
    const res = await sendHttp(this.fetchLike, {
      url,
      method: "POST",
      timeoutMs: this.timeoutMs,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ publish_id: handle.providerObjectId }),
    });
    const parsed = parseJsonBody(res.bodyText) as {
      data?: { status?: string; fail_reason?: string };
      error?: { code?: string };
    };
    const status = parsed?.data?.status;
    if (status === "PUBLISH_COMPLETE") {
      return { state: "published", providerObjectId: handle.providerObjectId, rawStatus: status };
    }
    if (status === "FAILED") {
      return {
        state: "failed",
        providerObjectId: handle.providerObjectId,
        failReason: parsed?.data?.fail_reason,
        rawStatus: status,
      };
    }
    if (
      status === "PROCESSING_UPLOAD" ||
      status === "PROCESSING_DOWNLOAD" ||
      status === "SEND_TO_USER_INBOX"
    ) {
      return { state: "processing", providerObjectId: handle.providerObjectId, rawStatus: status };
    }
    return { state: "unknown", rawStatus: status };
  }

  async reconcilePublish(
    job: PublishJob,
    account: ConnectedAccount,
    handle: ProviderPublishHandle
  ): Promise<ReconcileResult> {
    if (!handle.providerObjectId) {
      return {
        decision: "manual_review",
        nextJobStatus: "needs_review",
        detail:
          "No TikTok publish_id. Init may or may not have succeeded. TikTok has no idempotency key — do not re-init.",
        republishAllowed: false,
      };
    }
    const status = await this.getPublishStatus(account, handle);
    if (status.state === "published") {
      return {
        decision: "definitely_published",
        nextJobStatus: "published",
        providerObjectId: handle.providerObjectId,
        detail: "PUBLISH_COMPLETE",
        republishAllowed: false,
      };
    }
    if (status.state === "failed") {
      return {
        decision: "definitely_failed",
        nextJobStatus: "failed",
        providerObjectId: handle.providerObjectId,
        detail: status.failReason ?? "FAILED",
        republishAllowed: false,
      };
    }
    if (status.state === "processing") {
      return {
        decision: "still_processing",
        nextJobStatus: "provider_pending",
        providerObjectId: handle.providerObjectId,
        detail: status.rawStatus ?? "processing",
        republishAllowed: false,
      };
    }
    return {
      decision: "manual_review",
      nextJobStatus: "needs_review",
      detail: `TikTok status inconclusive for job ${job.jobId}`,
      republishAllowed: false,
    };
  }

  async disconnectAccount(_account: ConnectedAccount): Promise<void> {
    return;
  }

  private selectPrivacy(options: string[] | undefined): string {
    if (this.unauditedApp) return "SELF_ONLY";
    if (options?.includes("PUBLIC_TO_EVERYONE")) return "PUBLIC_TO_EVERYONE";
    if (options?.includes("SELF_ONLY")) return "SELF_ONLY";
    return options?.[0] ?? "SELF_ONLY";
  }

  private async ensureFresh(account: ConnectedAccount): Promise<void> {
    const expiresAt = account.accessTokenExpiresAt
      ? new Date(account.accessTokenExpiresAt)
      : this.clock.now();
    if (shouldRefreshTikTokAccessToken({ now: this.clock.now(), expiresAt })) {
      const result = await this.refreshCredentials(account);
      if (!result.ok) {
        throw new ProviderError({
          message: "TikTok token refresh failed before publish",
          category: "auth_expired",
          retryClass: "do_not_retry",
        });
      }
      Object.assign(account, result.accountPatch);
    }
  }

  private async queryCreatorInfo(accessToken: string): Promise<CreatorInfo> {
    const url = `${TIKTOK_API_HOST}/v2/post/publish/creator_info/query/`;
    assertAllowedProviderUrl(url);
    const res = await sendHttp(this.fetchLike, {
      url,
      method: "POST",
      timeoutMs: this.timeoutMs,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: "{}",
    });
    const parsed = parseJsonBody(res.bodyText) as {
      data?: CreatorInfo;
      error?: { code?: string; message?: string };
    };
    const code = parsed?.error?.code ?? "ok";
    if (code !== "ok" || res.status >= 400) {
      const classified = classifyTikTokError({
        code,
        message: parsed?.error?.message,
        httpStatus: res.status,
      });
      throw new ProviderError({
        message: "creator_info failed",
        category: classified.category,
        retryClass: classified.retryClass,
        httpStatus: res.status,
        providerCode: code,
      });
    }
    return parsed.data ?? {};
  }

  private async initPublish(
    _job: PublishJob,
    handle: ProviderPublishHandle,
    token: string,
    url: string,
    body: unknown,
    started: number
  ): Promise<PublishAttempt & { uploadUrl?: string }> {
    assertAllowedProviderUrl(url);
    const res = await sendHttp(this.fetchLike, {
      url,
      method: "POST",
      timeoutMs: this.timeoutMs,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(body),
    });
    const parsed = parseJsonBody(res.bodyText);
    if (isMalformedJson(parsed)) {
      return {
        outcome: "unknown",
        handle,
        httpStatus: res.status,
        category: "malformed_response",
        retryClass: "retry_same_attempt_unknown",
        detail: "malformed TikTok init response",
        durationMs: Date.now() - started,
      };
    }
    const data = parsed as {
      data?: { publish_id?: string; upload_url?: string };
      error?: { code?: string; message?: string };
    };
    const code = data.error?.code ?? "ok";
    if (res.status >= 400 || (code && code !== "ok")) {
      const classified = classifyTikTokError({
        code,
        message: data.error?.message,
        httpStatus: res.status,
      });
      return {
        outcome: "failed",
        handle,
        httpStatus: res.status,
        category: classified.category,
        retryClass: classified.retryClass,
        detail: "TikTok init error",
        durationMs: Date.now() - started,
      };
    }
    const publishId = data.data?.publish_id;
    if (!publishId) {
      return {
        outcome: "unknown",
        handle,
        httpStatus: res.status,
        category: "malformed_response",
        retryClass: "retry_same_attempt_unknown",
        detail: "TikTok init returned no publish_id",
        durationMs: Date.now() - started,
      };
    }
    return {
      outcome: "provider_pending",
      handle: { ...handle, providerObjectId: publishId },
      httpStatus: res.status,
      category: null,
      retryClass: null,
      detail: "init accepted",
      durationMs: Date.now() - started,
      uploadUrl: data.data?.upload_url,
    };
  }

  private async uploadChunks(
    uploadUrl: string,
    bytes: Uint8Array,
    plan: ReturnType<typeof planTikTokFileUpload>,
    contentType: string
  ): Promise<void> {
    assertAllowedProviderUrl(uploadUrl);
    for (const range of plan.ranges) {
      const slice = bytes.subarray(range.start, range.end + 1);
      const res = await sendHttp(this.fetchLike, {
        url: uploadUrl,
        method: "PUT",
        timeoutMs: Math.max(this.timeoutMs, 60_000),
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(slice.byteLength),
          "Content-Range": contentRangeHeader(range, plan.videoSize),
        },
        body: slice,
      });
      const isLast = range.index === plan.ranges.length - 1;
      const expected = isLast ? 201 : 206;
      if (res.status !== expected && res.status !== 201 && res.status !== 206) {
        throw new ProviderError({
          message: `TikTok chunk ${range.index} unexpected status ${res.status}`,
          category: "provider_unavailable",
          retryClass: "retry_same_attempt_unknown",
          httpStatus: res.status,
        });
      }
    }
  }

  private async exchangeCode(code: string, redirectUri: string) {
    const json = await this.tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
    return applyTikTokTokenResponse(json, { refreshToken: json.refresh_token ?? "" }, this.clock.now());
  }

  private async tokenRequest(params: Record<string, string>): Promise<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_expires_in?: number;
    open_id?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  }> {
    const url = `${TIKTOK_API_HOST}/v2/oauth/token/`;
    assertAllowedProviderUrl(url);
    const body = new URLSearchParams({
      client_key: this.cfg.clientKey,
      client_secret: this.cfg.clientSecret,
      ...params,
    });
    const res = await sendHttp(this.fetchLike, {
      url,
      method: "POST",
      timeoutMs: this.timeoutMs,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const parsed = parseJsonBody(res.bodyText) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_expires_in?: number;
      open_id?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (res.status >= 400 || parsed.error) {
      const classified = classifyTikTokError({
        code: parsed.error,
        message: parsed.error_description,
        httpStatus: res.status,
      });
      throw new ProviderError({
        message: "TikTok token endpoint error",
        category: classified.category,
        retryClass: classified.retryClass,
        httpStatus: res.status,
        providerCode: parsed.error ?? null,
      });
    }
    return parsed;
  }
}

function transportAttempt(err: unknown, handle: ProviderPublishHandle, started: number): PublishAttempt {
  if (err instanceof ProviderError && err.category === "timeout_after_possible_accept") {
    return {
      outcome: "unknown",
      handle,
      httpStatus: null,
      category: err.category,
      retryClass: "retry_same_attempt_unknown",
      detail: err.message,
      durationMs: Date.now() - started,
    };
  }
  if (err instanceof ProviderError && err.category === "timeout_before_request") {
    return {
      outcome: "failed",
      handle,
      httpStatus: null,
      category: err.category,
      retryClass: "retry_new_attempt",
      detail: err.message,
      durationMs: Date.now() - started,
    };
  }
  if (err instanceof ProviderError) {
    const unknown = err.retryClass === "retry_same_attempt_unknown";
    return {
      outcome: unknown ? "unknown" : "failed",
      handle,
      httpStatus: err.httpStatus,
      category: err.category,
      retryClass: err.retryClass,
      detail: err.message,
      durationMs: Date.now() - started,
    };
  }
  return {
    outcome: "unknown",
    handle,
    httpStatus: null,
    category: "unknown",
    retryClass: "retry_same_attempt_unknown",
    detail: "unclassified transport failure",
    durationMs: Date.now() - started,
  };
}

export { TIKTOK_REQUIRED_SCOPES };
