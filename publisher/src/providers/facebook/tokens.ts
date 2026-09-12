/**
 * Facebook / Meta token lifecycle — current official rules (Graph v26.0 docs,
 * Pages API updated 2026-06-30, long-lived token guide).
 *
 * Production flow (do NOT skip steps):
 *  1. Facebook Login for Business → short-lived USER token (~1–2 hours)
 *  2. GET /oauth/access_token?grant_type=fb_exchange_token → long-lived USER token (~60 days)
 *  3. GET /{user-id}/accounts with the LONG-LIVED user token → Page tokens
 *     Official: long-lived Page tokens have NO expiry and only die on invalidation.
 *  4. User must pick a Page that includes task CREATE_CONTENT
 *  5. Store encrypted user token + page token + page id + granted scopes
 *  6. debug_token before first publish and on a cadence
 *
 * Classic bug (called out in the original audit): exchanging the user token
 * then publishing with the SHORT-LIVED page token from the original login
 * response. Page tokens obtained from a short-lived user token expire in ~1h.
 */

export const FACEBOOK_GRAPH_VERSION = "v26.0";
export const FACEBOOK_GRAPH_HOST = "https://graph.facebook.com";

export const FACEBOOK_REQUIRED_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "pages_manage_metadata",
] as const;

/** Video/Reels additionally need publish_video. */
export const FACEBOOK_VIDEO_SCOPES = ["publish_video"] as const;

export const FACEBOOK_CREATE_CONTENT_TASK = "CREATE_CONTENT";

export const FACEBOOK_LONG_LIVED_USER_SECONDS = 60 * 24 * 60 * 60; // ~60 days
export const FACEBOOK_REFRESH_USER_TOKEN_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;
/** Meta: long-lived user token can only be exchanged if ≥ 24h old and not expired. */
export const FACEBOOK_MIN_TOKEN_AGE_BEFORE_REEXCHANGE_MS = 24 * 60 * 60 * 1000;

export type FacebookTokenSet = {
  userAccessToken: string;
  userTokenExpiresAt: Date;
  userTokenIssuedAt: Date;
  pageAccessToken: string;
  pageId: string;
  pageName: string;
  pageTasks: string[];
  scopes: string[];
};

export type FacebookOAuthConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphVersion?: string;
};

export function facebookOAuthDialogUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
  graphVersion?: string;
}): string {
  const version = input.graphVersion ?? FACEBOOK_GRAPH_VERSION;
  const scope = (input.scopes ?? FACEBOOK_REQUIRED_SCOPES).join(",");
  const u = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
  u.searchParams.set("client_id", input.appId);
  u.searchParams.set("redirect_uri", input.redirectUri);
  u.searchParams.set("state", input.state);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scope);
  return u.toString();
}

export function longLivedUserExchangeUrl(cfg: FacebookOAuthConfig, shortLivedUserToken: string): string {
  const version = cfg.graphVersion ?? FACEBOOK_GRAPH_VERSION;
  const u = new URL(`${FACEBOOK_GRAPH_HOST}/${version}/oauth/access_token`);
  u.searchParams.set("grant_type", "fb_exchange_token");
  u.searchParams.set("client_id", cfg.appId);
  u.searchParams.set("client_secret", cfg.appSecret);
  u.searchParams.set("fb_exchange_token", shortLivedUserToken);
  return u.toString();
}

export function pageAccountsUrl(userId: string, longLivedUserToken: string, graphVersion = FACEBOOK_GRAPH_VERSION): string {
  const u = new URL(`${FACEBOOK_GRAPH_HOST}/${graphVersion}/${userId}/accounts`);
  u.searchParams.set("access_token", longLivedUserToken);
  u.searchParams.set("fields", "id,name,access_token,tasks,category");
  return u.toString();
}

export function debugTokenUrl(inputToken: string, appAccessToken: string, graphVersion = FACEBOOK_GRAPH_VERSION): string {
  const u = new URL(`${FACEBOOK_GRAPH_HOST}/${graphVersion}/debug_token`);
  u.searchParams.set("input_token", inputToken);
  u.searchParams.set("access_token", appAccessToken);
  return u.toString();
}

export function facebookAppAccessToken(appId: string, appSecret: string): string {
  return `${appId}|${appSecret}`;
}

export function pageAllowsCreateContent(tasks: string[] | undefined): boolean {
  return Array.isArray(tasks) && tasks.includes(FACEBOOK_CREATE_CONTENT_TASK);
}

export function missingFacebookScopes(granted: string[], extra: readonly string[] = []): string[] {
  const need = new Set<string>([...FACEBOOK_REQUIRED_SCOPES, ...extra]);
  return [...need].filter((s) => !granted.includes(s));
}

export function shouldReexchangeUserToken(input: {
  now: Date;
  expiresAt: Date;
  issuedAt: Date;
}): boolean {
  const remaining = input.expiresAt.getTime() - input.now.getTime();
  if (remaining <= 0) return false;
  const age = input.now.getTime() - input.issuedAt.getTime();
  if (age < FACEBOOK_MIN_TOKEN_AGE_BEFORE_REEXCHANGE_MS) return false;
  return remaining <= FACEBOOK_REFRESH_USER_TOKEN_BEFORE_MS;
}

export type DebugTokenData = {
  is_valid?: boolean;
  expires_at?: number;
  scopes?: string[];
  user_id?: string;
  type?: string;
  error?: { code?: number; message?: string; subcode?: number };
};

export function interpretDebugToken(data: DebugTokenData, now = new Date()): {
  valid: boolean;
  revoked: boolean;
  expired: boolean;
  expiresAt: Date | null;
} {
  const expiresAt =
    typeof data.expires_at === "number" && data.expires_at > 0
      ? new Date(data.expires_at * 1000)
      : null;
  const expired = expiresAt != null && expiresAt.getTime() <= now.getTime();
  const valid = data.is_valid === true && !expired;
  const revoked = data.is_valid === false && !expired;
  return { valid, revoked, expired, expiresAt };
}
