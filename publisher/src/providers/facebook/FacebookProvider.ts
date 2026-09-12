import type { SocialProvider } from "../SocialProvider.ts";
import {
  classifyFacebookGraphError,
  ProviderError,
} from "../errors.ts";
import type { FetchLike } from "../http.ts";
import { assertAllowedProviderUrl, isMalformedJson, parseJsonBody, sendHttp } from "../http.ts";
import { nodeFetchAdapter } from "../http.ts";
import type {
  Clock,
  ConnectInput,
  ConnectResult,
  ConnectedAccount,
  CredentialRefresh,
  CredentialStatus,
  DecryptFn,
  EncryptFn,
  FacebookPageRef,
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
  FACEBOOK_CREATE_CONTENT_TASK,
  FACEBOOK_GRAPH_HOST,
  FACEBOOK_GRAPH_VERSION,
  FACEBOOK_REQUIRED_SCOPES,
  debugTokenUrl,
  facebookAppAccessToken,
  interpretDebugToken,
  longLivedUserExchangeUrl,
  missingFacebookScopes,
  pageAccountsUrl,
  pageAllowsCreateContent,
  shouldReexchangeUserToken,
  type FacebookOAuthConfig,
  type DebugTokenData,
} from "./tokens.ts";

export type FacebookProviderDeps = {
  config: FacebookOAuthConfig;
  decrypt: DecryptFn;
  encrypt: EncryptFn;
  fetchLike?: FetchLike;
  clock?: Clock;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 20_000;

export class FacebookProvider implements SocialProvider {
  readonly id = "facebook" as const;
  private readonly cfg: FacebookOAuthConfig;
  private readonly decrypt: DecryptFn;
  private readonly encrypt: EncryptFn;
  private readonly fetchLike: FetchLike;
  private readonly clock: Clock;
  private readonly timeoutMs: number;
  private readonly version: string;

  constructor(deps: FacebookProviderDeps) {
    this.cfg = deps.config;
    this.decrypt = deps.decrypt;
    this.encrypt = deps.encrypt;
    this.fetchLike = deps.fetchLike ?? nodeFetchAdapter;
    this.clock = deps.clock ?? systemClock;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.version = deps.config.graphVersion ?? FACEBOOK_GRAPH_VERSION;
  }

  async connectAccount(input: ConnectInput): Promise<ConnectResult> {
    try {
      const shortLived = await this.exchangeCode(input.authorizationCode, input.redirectUri);
      const longLived = await this.exchangeLongLivedUser(shortLived.accessToken);
      const me = await this.getMe(longLived.accessToken);
      const pages = await this.listPages(me.id, longLived.accessToken);
      const usable = pages.filter((p) => pageAllowsCreateContent(p.tasks));
      if (usable.length === 0) {
        return {
          ok: false,
          error: "No Facebook Page with CREATE_CONTENT task",
          category: "permission_denied",
        };
      }
      const publicPages: FacebookPageRef[] = usable.map(({ pageId, name, tasks, category }) => ({
        pageId,
        name,
        tasks,
        category,
      }));
      if (!input.selectedPageId) {
        return {
          ok: true,
          requiresPageSelection: true,
          pages: publicPages,
        };
      }
      const page = usable.find((p) => p.pageId === input.selectedPageId);
      if (!page) {
        return { ok: false, error: "Selected page is not permitted", category: "permission_denied" };
      }
      return {
        ok: true,
        account: this.accountFromTokens({
          organizationId: input.organizationId,
          userId: me.id,
          name: me.name,
          userToken: longLived.accessToken,
          userExpiresAt: longLived.expiresAt,
          scopes: longLived.scopes,
          page,
        }),
        pages: publicPages,
      };
    } catch (err) {
      if (err instanceof ProviderError) {
        return { ok: false, error: err.message, category: err.category };
      }
      return { ok: false, error: "Facebook connect failed", category: "unknown" };
    }
  }

  async refreshCredentials(account: ConnectedAccount): Promise<CredentialRefresh> {
    try {
      const userToken = this.decrypt(account.accessTokenEnvelope);
      const now = this.clock.now();
      const expiresAt = account.accessTokenExpiresAt ? new Date(account.accessTokenExpiresAt) : now;
      const issuedAt = account.tokenIssuedAt ? new Date(account.tokenIssuedAt) : now;
      if (shouldReexchangeUserToken({ now, expiresAt, issuedAt })) {
        const longLived = await this.exchangeLongLivedUser(userToken);
        const me = await this.getMe(longLived.accessToken);
        const pages = await this.listPages(me.id, longLived.accessToken);
        const page = pages.find((p) => p.pageId === account.pageId);
        if (!page) {
          return {
            ok: false,
            accountPatch: { status: "needs_reconnect" },
            detail: "Page no longer accessible after token refresh",
          };
        }
        return {
          ok: true,
          accountPatch: {
            accessTokenEnvelope: this.encrypt(longLived.accessToken),
            pageTokenEnvelope: this.encrypt(page.pageAccessToken),
            accessTokenExpiresAt: longLived.expiresAt.toISOString(),
            tokenIssuedAt: now.toISOString(),
            pageTokenExpiresAt: null,
            status: "active",
            scopes: longLived.scopes,
          },
          detail: "reexchanged long-lived user token and refreshed page token",
        };
      }
      const status = await this.validateCredentials(account);
      return {
        ok: status.isValid,
        accountPatch: { status: status.code },
        detail: status.detail,
      };
    } catch (err) {
      if (err instanceof ProviderError && err.category === "auth_revoked") {
        return { ok: false, accountPatch: { status: "revoked" }, detail: err.message };
      }
      return { ok: false, accountPatch: { status: "needs_reconnect" }, detail: "refresh failed" };
    }
  }

  async validateCredentials(account: ConnectedAccount): Promise<CredentialStatus> {
    const token = this.decrypt(account.pageTokenEnvelope ?? account.accessTokenEnvelope);
    const appToken = facebookAppAccessToken(this.cfg.appId, this.cfg.appSecret);
    const url = debugTokenUrl(token, appToken, this.version);
    const parsed = await this.graphGet(url);
    const data = (parsed as { data?: DebugTokenData })?.data ?? (parsed as DebugTokenData);
    const interp = interpretDebugToken(data, this.clock.now());
    if (interp.revoked) {
      return { code: "revoked", isValid: false, expiresAt: null, scopes: data.scopes ?? [], detail: "token revoked" };
    }
    if (interp.expired || !interp.valid) {
      return {
        code: "expired",
        isValid: false,
        expiresAt: interp.expiresAt?.toISOString() ?? null,
        scopes: data.scopes ?? [],
        detail: "token expired or invalid",
      };
    }
    const missing = missingFacebookScopes(data.scopes ?? []);
    if (missing.length) {
      return {
        code: "needs_reconnect",
        isValid: false,
        expiresAt: interp.expiresAt?.toISOString() ?? null,
        scopes: data.scopes ?? [],
        detail: `missing scopes: ${missing.join(",")}`,
      };
    }
    return {
      code: "active",
      isValid: true,
      expiresAt: interp.expiresAt?.toISOString() ?? null,
      scopes: data.scopes ?? account.scopes,
      detail: "valid",
    };
  }

  async publishText(job: PublishJob, account: ConnectedAccount, content: TextContent): Promise<PublishAttempt> {
    return this.publishToFeed(job, account, {
      message: content.text,
      ...(content.linkUrl ? { link: content.linkUrl } : {}),
    });
  }

  async publishImage(job: PublishJob, account: ConnectedAccount, content: ImageContent): Promise<PublishAttempt> {
    if (!content.bytes) {
      return failAttempt(job, account, "image bytes required — worker must load from trusted media plane", "invalid_request");
    }
    const pageId = requirePageId(account);
    const token = this.decrypt(account.pageTokenEnvelope ?? "");
    const url = `${FACEBOOK_GRAPH_HOST}/${this.version}/${pageId}/photos`;
    return this.postForm(job, account, url, token, {
      caption: content.text ?? "",
      published: "true",
    }, content.bytes, content.contentType);
  }

  async publishVideo(job: PublishJob, account: ConnectedAccount, content: VideoContent): Promise<PublishAttempt> {
    const pageId = requirePageId(account);
    const token = this.decrypt(account.pageTokenEnvelope ?? "");
    if (content.kind === "reel") {
      return this.publishReel(job, account, pageId, token, content);
    }
    const url = `${FACEBOOK_GRAPH_HOST}/${this.version}/${pageId}/videos`;
    return this.postJson(job, account, url, token, {
      description: content.text ?? "",
      published: true,
    });
  }

  async getPublishStatus(account: ConnectedAccount, handle: ProviderPublishHandle): Promise<PublishStatus> {
    if (!handle.providerObjectId) return { state: "unknown" };
    const token = this.decrypt(account.pageTokenEnvelope ?? account.accessTokenEnvelope);
    const url = `${FACEBOOK_GRAPH_HOST}/${this.version}/${handle.providerObjectId}?fields=id,created_time,is_published,message&access_token=${encodeURIComponent(token)}`;
    try {
      const parsed = await this.graphGet(url);
      const id = (parsed as { id?: string }).id;
      if (id) return { state: "published", providerObjectId: id, rawStatus: "published" };
      return { state: "unknown" };
    } catch (err) {
      if (err instanceof ProviderError && err.httpStatus === 404) {
        return { state: "not_found" };
      }
      return { state: "unknown" };
    }
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
        detail: "Facebook object exists",
        republishAllowed: false,
      };
    }
    if (status.state === "not_found") {
      return {
        decision: "manual_review",
        nextJobStatus: "needs_review",
        detail:
          "Facebook returned not_found. Could be unpublished, deleted, or never created. Do not auto-republish.",
        republishAllowed: false,
      };
    }
    return {
      decision: "manual_review",
      nextJobStatus: "needs_review",
      detail: `Facebook reconciliation inconclusive for job ${job.jobId}`,
      republishAllowed: false,
    };
  }

  async disconnectAccount(_account: ConnectedAccount): Promise<void> {
    return;
  }

  private async publishReel(
    job: PublishJob,
    account: ConnectedAccount,
    pageId: string,
    token: string,
    content: VideoContent
  ): Promise<PublishAttempt> {
    const startUrl = `${FACEBOOK_GRAPH_HOST}/${this.version}/${pageId}/video_reels`;
    return this.postJson(job, account, startUrl, token, {
      upload_phase: "start",
      description: content.text ?? "",
    });
  }

  private async publishToFeed(
    job: PublishJob,
    account: ConnectedAccount,
    body: Record<string, unknown>
  ): Promise<PublishAttempt> {
    const pageId = requirePageId(account);
    const token = this.decrypt(account.pageTokenEnvelope ?? "");
    const url = `${FACEBOOK_GRAPH_HOST}/${this.version}/${pageId}/feed`;
    return this.postJson(job, account, url, token, body);
  }

  private async postJson(
    job: PublishJob,
    account: ConnectedAccount,
    url: string,
    token: string,
    body: Record<string, unknown>
  ): Promise<PublishAttempt> {
    const started = Date.now();
    const handle: ProviderPublishHandle = {
      provider: "facebook",
      providerAccountId: account.pageId,
      attemptedAt: this.clock.now().toISOString(),
      fingerprint: { textHash: job.idempotencyKey, assetId: job.jobId },
    };
    try {
      assertAllowedProviderUrl(url);
      const res = await sendHttp(this.fetchLike, {
        url,
        method: "POST",
        timeoutMs: this.timeoutMs,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      return this.interpretPublishResponse(res.status, res.bodyText, handle, started);
    } catch (err) {
      return transportAttempt(err, handle, started);
    }
  }

  private async postForm(
    job: PublishJob,
    account: ConnectedAccount,
    url: string,
    token: string,
    fields: Record<string, string>,
    bytes: Uint8Array,
    contentType: string
  ): Promise<PublishAttempt> {
    const started = Date.now();
    const handle: ProviderPublishHandle = {
      provider: "facebook",
      providerAccountId: account.pageId,
      attemptedAt: this.clock.now().toISOString(),
      fingerprint: { assetId: job.jobId, byteLength: bytes.byteLength },
    };
    try {
      assertAllowedProviderUrl(url);
      const boundary = `----sunchaser${job.jobId.replace(/[^a-zA-Z0-9]/g, "")}`;
      const res = await sendHttp(this.fetchLike, {
        url,
        method: "POST",
        timeoutMs: this.timeoutMs,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: JSON.stringify({ ...fields, bytes: bytes.byteLength, contentType }),
      });
      return this.interpretPublishResponse(res.status, res.bodyText, handle, started);
    } catch (err) {
      return transportAttempt(err, handle, started);
    }
  }

  private interpretPublishResponse(
    status: number,
    bodyText: string,
    handle: ProviderPublishHandle,
    started: number
  ): PublishAttempt {
    const parsed = parseJsonBody(bodyText);
    if (isMalformedJson(parsed)) {
      return {
        outcome: "unknown",
        handle,
        httpStatus: status,
        category: "malformed_response",
        retryClass: "retry_same_attempt_unknown",
        detail: "malformed Facebook response",
        durationMs: Date.now() - started,
      };
    }
    if (status >= 200 && status < 300) {
      const id =
        (parsed as { id?: string; post_id?: string; video_id?: string } | null)?.post_id ||
        (parsed as { id?: string } | null)?.id ||
        (parsed as { video_id?: string } | null)?.video_id;
      if (!id) {
        return {
          outcome: "unknown",
          handle,
          httpStatus: status,
          category: "malformed_response",
          retryClass: "retry_same_attempt_unknown",
          detail: "Facebook accepted request but returned no id",
          durationMs: Date.now() - started,
        };
      }
      return {
        outcome: "accepted",
        handle: { ...handle, providerObjectId: String(id) },
        httpStatus: status,
        category: null,
        retryClass: null,
        detail: "published",
        durationMs: Date.now() - started,
      };
    }
    const err = (parsed as { error?: { code?: number; error_subcode?: number; message?: string; type?: string } })
      ?.error;
    const classified = classifyFacebookGraphError({
      code: err?.code,
      error_subcode: err?.error_subcode,
      message: err?.message,
      type: err?.type,
      httpStatus: status,
    });
    return {
      outcome: "failed",
      handle,
      httpStatus: status,
      category: classified.category,
      retryClass: classified.retryClass,
      detail: err?.message ? "Facebook Graph error" : `http ${status}`,
      durationMs: Date.now() - started,
    };
  }

  private async exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string }> {
    const url = new URL(`${FACEBOOK_GRAPH_HOST}/${this.version}/oauth/access_token`);
    url.searchParams.set("client_id", this.cfg.appId);
    url.searchParams.set("client_secret", this.cfg.appSecret);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("code", code);
    const parsed = await this.graphGet(url.toString());
    const accessToken = (parsed as { access_token?: string }).access_token;
    if (!accessToken) throw new ProviderError({ message: "No user token", category: "malformed_response", retryClass: "do_not_retry" });
    return { accessToken };
  }

  private async exchangeLongLivedUser(shortLived: string): Promise<{
    accessToken: string;
    expiresAt: Date;
    scopes: string[];
  }> {
    const url = longLivedUserExchangeUrl(this.cfg, shortLived);
    const parsed = await this.graphGet(url);
    const accessToken = (parsed as { access_token?: string }).access_token;
    const expiresIn = (parsed as { expires_in?: number }).expires_in ?? 60 * 24 * 3600;
    if (!accessToken) {
      throw new ProviderError({
        message: "Long-lived user token exchange failed",
        category: "malformed_response",
        retryClass: "do_not_retry",
      });
    }
    return {
      accessToken,
      expiresAt: new Date(this.clock.now().getTime() + expiresIn * 1000),
      scopes: [...FACEBOOK_REQUIRED_SCOPES],
    };
  }

  private async getMe(userToken: string): Promise<{ id: string; name: string }> {
    const url = `${FACEBOOK_GRAPH_HOST}/${this.version}/me?fields=id,name&access_token=${encodeURIComponent(userToken)}`;
    const parsed = await this.graphGet(url);
    const id = (parsed as { id?: string }).id;
    const name = (parsed as { name?: string }).name ?? "Facebook User";
    if (!id) throw new ProviderError({ message: "me.id missing", category: "malformed_response", retryClass: "do_not_retry" });
    return { id, name };
  }

  private async listPages(userId: string, longLivedUserToken: string): Promise<
    Array<FacebookPageRef & { pageAccessToken: string }>
  > {
    const url = pageAccountsUrl(userId, longLivedUserToken, this.version);
    const parsed = await this.graphGet(url);
    const data = (parsed as { data?: Array<{ id: string; name: string; access_token: string; tasks?: string[]; category?: string }> }).data ?? [];
    return data.map((p) => ({
      pageId: p.id,
      name: p.name,
      tasks: p.tasks ?? [],
      category: p.category,
      pageAccessToken: p.access_token,
    }));
  }

  private async graphGet(url: string): Promise<unknown> {
    assertAllowedProviderUrl(url);
    const res = await sendHttp(this.fetchLike, {
      url,
      method: "GET",
      timeoutMs: this.timeoutMs,
    });
    const parsed = parseJsonBody(res.bodyText);
    if (res.status >= 400) {
      const err = (parsed as { error?: { code?: number; error_subcode?: number; message?: string } })?.error;
      const classified = classifyFacebookGraphError({
        code: err?.code,
        error_subcode: err?.error_subcode,
        message: err?.message,
        httpStatus: res.status,
      });
      throw new ProviderError({
        message: "Facebook Graph error",
        category: classified.category,
        retryClass: classified.retryClass,
        httpStatus: res.status,
        providerCode: err?.code != null ? String(err.code) : null,
      });
    }
    return parsed;
  }

  private accountFromTokens(input: {
    organizationId: string;
    userId: string;
    name: string;
    userToken: string;
    userExpiresAt: Date;
    scopes: string[];
    page: FacebookPageRef & { pageAccessToken?: string };
  }): ConnectedAccount {
    const pageToken = input.page.pageAccessToken ?? "";
    return {
      accountId: `fb_${input.page.pageId}`,
      organizationId: input.organizationId,
      provider: "facebook",
      providerUserId: input.userId,
      displayName: input.page.name || input.name,
      accessTokenEnvelope: this.encrypt(input.userToken),
      pageTokenEnvelope: pageToken ? this.encrypt(pageToken) : undefined,
      pageId: input.page.pageId,
      scopes: input.scopes,
      accessTokenExpiresAt: input.userExpiresAt.toISOString(),
      tokenIssuedAt: this.clock.now().toISOString(),
      refreshTokenExpiresAt: null,
      pageTokenExpiresAt: null,
      status: "active",
    };
  }
}

function requirePageId(account: ConnectedAccount): string {
  if (!account.pageId) {
    throw new ProviderError({
      message: "Facebook Page is not selected",
      category: "invalid_request",
      retryClass: "do_not_retry",
    });
  }
  return account.pageId;
}

function failAttempt(
  job: PublishJob,
  account: ConnectedAccount,
  detail: string,
  category: PublishAttempt["category"]
): PublishAttempt {
  return {
    outcome: "failed",
    handle: {
      provider: "facebook",
      providerAccountId: account.pageId,
      attemptedAt: new Date().toISOString(),
      fingerprint: { assetId: job.jobId },
    },
    httpStatus: null,
    category,
    retryClass: "do_not_retry",
    detail,
    durationMs: 0,
  };
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

export { FACEBOOK_CREATE_CONTENT_TASK };
