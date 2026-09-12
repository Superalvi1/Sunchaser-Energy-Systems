/**
 * TikTok Login Kit / Content Posting token lifecycle.
 * Source: OAuth User Access Token Management, last updated 2026-08-04.
 *
 * - access_token expires_in = 86400 (24 hours)
 * - refresh_token refresh_expires_in = 31536000 (365 days)
 * - Refresh ROTATES: the returned refresh_token MAY differ; persist it
 * - Refresh endpoint: POST https://open.tiktokapis.com/v2/oauth/token/
 *     grant_type=refresh_token
 * - Unaudited apps: Direct Post privacy is restricted to SELF_ONLY
 */

export const TIKTOK_API_HOST = "https://open.tiktokapis.com";
export const TIKTOK_AUTH_HOST = "https://www.tiktok.com";

export const TIKTOK_ACCESS_TOKEN_SECONDS = 86_400;
export const TIKTOK_REFRESH_TOKEN_SECONDS = 31_536_000;
export const TIKTOK_REFRESH_ACCESS_BEFORE_MS = 60 * 60 * 1000; // 1 hour

export const TIKTOK_REQUIRED_SCOPES = ["user.info.basic", "video.publish"] as const;
export const TIKTOK_DRAFT_SCOPES = ["video.upload"] as const;

export type TikTokTokenSet = {
  accessToken: string;
  refreshToken: string;
  openId: string;
  scope: string[];
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  issuedAt: Date;
};

export type TikTokOAuthConfig = {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
};

export function tiktokAuthorizeUrl(input: {
  clientKey: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
  codeChallenge?: string;
}): string {
  const u = new URL(`${TIKTOK_AUTH_HOST}/v2/auth/authorize/`);
  u.searchParams.set("client_key", input.clientKey);
  u.searchParams.set("redirect_uri", input.redirectUri);
  u.searchParams.set("state", input.state);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", (input.scopes ?? TIKTOK_REQUIRED_SCOPES).join(","));
  if (input.codeChallenge) {
    u.searchParams.set("code_challenge", input.codeChallenge);
    u.searchParams.set("code_challenge_method", "S256");
  }
  return u.toString();
}

export function shouldRefreshTikTokAccessToken(input: { now: Date; expiresAt: Date }): boolean {
  return input.expiresAt.getTime() - input.now.getTime() <= TIKTOK_REFRESH_ACCESS_BEFORE_MS;
}

export function applyTikTokTokenResponse(
  json: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_expires_in?: number;
    open_id?: string;
    scope?: string;
  },
  previous: { refreshToken: string; refreshTokenExpiresAt?: Date },
  now: Date
): TikTokTokenSet {
  if (!json.access_token || !json.open_id) {
    throw new Error("TikTok token response missing access_token or open_id");
  }
  const refreshToken = json.refresh_token && json.refresh_token !== previous.refreshToken
    ? json.refresh_token
    : json.refresh_token ?? previous.refreshToken;
  const accessSecs = json.expires_in ?? TIKTOK_ACCESS_TOKEN_SECONDS;
  const refreshSecs = json.refresh_expires_in ?? TIKTOK_REFRESH_TOKEN_SECONDS;
  return {
    accessToken: json.access_token,
    refreshToken,
    openId: json.open_id,
    scope: (json.scope ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    accessTokenExpiresAt: new Date(now.getTime() + accessSecs * 1000),
    refreshTokenExpiresAt: new Date(now.getTime() + refreshSecs * 1000),
    issuedAt: now,
  };
}

export function missingTikTokScopes(granted: string[]): string[] {
  return TIKTOK_REQUIRED_SCOPES.filter((s) => !granted.includes(s));
}
