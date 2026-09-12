export type MockScenarioName =
  | "success"
  | "http_400"
  | "http_401"
  | "http_403"
  | "http_429"
  | "http_500"
  | "timeout_before_request"
  | "timeout_after_accept"
  | "malformed_response"
  | "expired_token"
  | "revoked_token"
  | "rate_limited";

export const ALL_MOCK_SCENARIOS: readonly MockScenarioName[] = [
  "success",
  "http_400",
  "http_401",
  "http_403",
  "http_429",
  "http_500",
  "timeout_before_request",
  "timeout_after_accept",
  "malformed_response",
  "expired_token",
  "revoked_token",
  "rate_limited",
] as const;

export type MockScenario = {
  name: MockScenarioName;
  /** If set, throw/abort before the adapter considers the request sent. */
  abortBeforeSend?: boolean;
  /** If set, request is considered sent then the socket dies. */
  abortAfterSend?: boolean;
  httpStatus?: number;
  json?: unknown;
  rawBody?: string;
  retryAfterMs?: number;
};

export const MOCK_SCENARIOS: Record<MockScenarioName, MockScenario> = {
  success: {
    name: "success",
    httpStatus: 200,
    json: { id: "mock_post_1", publish_id: "mock_publish_1" },
  },
  http_400: {
    name: "http_400",
    httpStatus: 400,
    json: { error: { message: "Invalid parameter", code: 100, type: "OAuthException" } },
  },
  http_401: {
    name: "http_401",
    httpStatus: 401,
    json: { error: { message: "Invalid OAuth access token", code: 190 } },
  },
  http_403: {
    name: "http_403",
    httpStatus: 403,
    json: { error: { message: "Permissions error", code: 200 } },
  },
  http_429: {
    name: "http_429",
    httpStatus: 429,
    json: { error: { message: "Calls to this api have exceeded the rate limit.", code: 613 } },
    retryAfterMs: 30_000,
  },
  http_500: {
    name: "http_500",
    httpStatus: 500,
    json: { error: { message: "An unexpected error has occurred", code: 2 } },
  },
  timeout_before_request: {
    name: "timeout_before_request",
    abortBeforeSend: true,
  },
  timeout_after_accept: {
    name: "timeout_after_accept",
    abortAfterSend: true,
    httpStatus: 200,
    json: { id: "accepted_but_unseen", publish_id: "accepted_but_unseen" },
  },
  malformed_response: {
    name: "malformed_response",
    httpStatus: 200,
    rawBody: "<html>not json",
  },
  expired_token: {
    name: "expired_token",
    httpStatus: 401,
    json: {
      error: {
        message: "Error validating access token: Session has expired",
        type: "OAuthException",
        code: 190,
        error_subcode: 463,
      },
    },
  },
  revoked_token: {
    name: "revoked_token",
    httpStatus: 401,
    json: {
      error: {
        message: "Error validating access token: The session has been invalidated because the user changed their password or Facebook has changed the session for security reasons.",
        type: "OAuthException",
        code: 190,
        error_subcode: 460,
      },
    },
  },
  rate_limited: {
    name: "rate_limited",
    httpStatus: 429,
    json: { error: { code: "rate_limit_exceeded", message: "Too many requests" } },
    retryAfterMs: 60_000,
  },
};
