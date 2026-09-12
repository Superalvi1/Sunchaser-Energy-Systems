import type { ProviderErrorCategory, RetryClass } from "./errors.ts";

export type ProviderName = "facebook" | "tiktok";

export type MediaKind = "text" | "image" | "video" | "reel";

export type JobStatus =
  | "scheduled"
  | "processing"
  | "provider_pending"
  | "published"
  | "failed"
  | "unknown"
  | "needs_review"
  | "cancelled";

export type ConnectInput = {
  organizationId: string;
  authorizationCode: string;
  redirectUri: string;
  /** CSRF state already verified by the API layer. */
  state: string;
  /** Facebook: selected page id after listing. TikTok: unused. */
  selectedPageId?: string;
};

export type FacebookPageRef = {
  pageId: string;
  name: string;
  tasks: string[];
  category?: string;
};

export type ConnectResult =
  | {
      ok: true;
      /** Omitted when Facebook still requires an explicit Page pick. */
      account?: ConnectedAccount;
      pages?: FacebookPageRef[];
      requiresPageSelection?: boolean;
    }
  | { ok: false; error: string; category: ProviderErrorCategory };

export type ConnectedAccount = {
  accountId: string;
  organizationId: string;
  provider: ProviderName;
  providerUserId: string;
  displayName: string;
  /** Encrypted envelopes — never plaintext. */
  accessTokenEnvelope: string;
  refreshTokenEnvelope?: string;
  /** Facebook page token (encrypted). */
  pageTokenEnvelope?: string;
  pageId?: string;
  scopes: string[];
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  /** When the current user/access token was issued (ISO). Required for Facebook reexchange age ≥ 24h. */
  tokenIssuedAt?: string | null;
  /** Facebook long-lived page tokens typically have no expiry. */
  pageTokenExpiresAt: string | null;
  status: CredentialStatusCode;
  tiktokUnaudited?: boolean;
};

export type CredentialStatusCode =
  | "active"
  | "needs_refresh"
  | "expired"
  | "revoked"
  | "needs_reconnect";

export type CredentialStatus = {
  code: CredentialStatusCode;
  isValid: boolean;
  expiresAt: string | null;
  scopes: string[];
  detail: string;
};

export type CredentialRefresh = {
  ok: boolean;
  accountPatch: Partial<ConnectedAccount>;
  detail: string;
};

export type TextContent = { text: string; linkUrl?: string };
export type ImageContent = {
  text?: string;
  /**
   * HTTPS URL already stored in our object store. Providers must not fetch
   * arbitrary user-supplied hosts (SSRF). The worker resolves bytes via the
   * trusted media plane, not via the provider adapter.
   */
  imageAssetId: string;
  bytes?: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  byteLength: number;
};
export type VideoContent = {
  text?: string;
  videoAssetId: string;
  bytes?: Uint8Array;
  contentType: "video/mp4" | "video/quicktime" | "video/webm";
  byteLength: number;
  durationSec?: number;
  kind: "video" | "reel";
  coverTimestampMs?: number;
};

export type PublishJob = {
  jobId: string;
  organizationId: string;
  accountId: string;
  idempotencyKey: string;
  attemptNumber: number;
  scheduledAt: string;
  mediaKind: MediaKind;
};

export type ProviderPublishHandle = {
  provider: ProviderName;
  /** Facebook post/photo/video id; TikTok publish_id. */
  providerObjectId?: string;
  /** Facebook page id / TikTok open_id */
  providerAccountId?: string;
  attemptedAt: string;
  fingerprint: PublishFingerprint;
};

export type PublishFingerprint = {
  textHash?: string;
  byteLength?: number;
  assetId?: string;
};

export type PublishOutcome =
  | "accepted"
  | "provider_pending"
  | "failed"
  | "unknown";

export type PublishAttempt = {
  outcome: PublishOutcome;
  handle: ProviderPublishHandle;
  httpStatus: number | null;
  category: ProviderErrorCategory | null;
  retryClass: RetryClass | null;
  detail: string;
  durationMs: number;
};

export type PublishStatus = {
  state: "published" | "processing" | "failed" | "not_found" | "unknown";
  providerObjectId?: string;
  failReason?: string;
  rawStatus?: string;
};

export type ReconcileDecision =
  | "definitely_published"
  | "definitely_failed"
  | "still_processing"
  | "manual_review";

export type ReconcileResult = {
  decision: ReconcileDecision;
  nextJobStatus: JobStatus;
  providerObjectId?: string;
  detail: string;
  republishAllowed: false;
};

export type DecryptFn = (envelope: string) => string;
export type EncryptFn = (plaintext: string) => string;

export type Clock = { now(): Date };

export const systemClock: Clock = { now: () => new Date() };
