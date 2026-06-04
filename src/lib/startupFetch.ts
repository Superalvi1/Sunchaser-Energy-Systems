export const STARTUP_FETCH_TIMEOUT_MS = 12000;

export const LOGIN_FETCH_TIMEOUT_MS = 60000;

export const CONNECTION_ERROR_MESSAGE =
  "Connection issue. Please check internet and try again.";

export const LOGIN_UNABLE_CONNECT_MESSAGE =
  "Unable to connect. Please check internet or try again in 1 minute.";

export async function readApiErrorBody(
  res: Response
): Promise<{ error?: string; message?: string }> {
  try {
    const body = await res.json();
    if (body && typeof body === "object") {
      return body as { error?: string; message?: string };
    }
  } catch {
    /* ignore non-json */
  }
  return {};
}

export function logApiFailure(
  label: string,
  url: string,
  status: number | null,
  body: { error?: string; message?: string },
  err?: unknown
) {
  console.error(`[API] ${label} failed`, {
    url,
    status,
    backendError: body.error || body.message || null,
    err,
  });
}

export function isNetworkFetchError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof Error && /failed to fetch/i.test(err.message)) return true;
  return false;
}

export function toConnectionError(err: unknown): Error {
  if (err instanceof Error && err.message === CONNECTION_ERROR_MESSAGE) {
    return err;
  }
  if (err instanceof Error && err.message === LOGIN_UNABLE_CONNECT_MESSAGE) {
    return err;
  }
  if (err instanceof Error && err.name === "AbortError") {
    return new Error(CONNECTION_ERROR_MESSAGE);
  }
  if (isNetworkFetchError(err)) {
    return new Error(CONNECTION_ERROR_MESSAGE);
  }
  return new Error(CONNECTION_ERROR_MESSAGE);
}

/** Login: keep backend auth messages; only map true network/timeout failures. */
export function toLoginError(err: unknown): Error {
  if (err instanceof Error && err.message === LOGIN_UNABLE_CONNECT_MESSAGE) {
    return err;
  }
  if (err instanceof Error && err.name === "AbortError") {
    return new Error(LOGIN_UNABLE_CONNECT_MESSAGE);
  }
  if (isNetworkFetchError(err)) {
    return new Error(LOGIN_UNABLE_CONNECT_MESSAGE);
  }
  if (err instanceof Error && err.message) {
    return err;
  }
  return new Error(LOGIN_UNABLE_CONNECT_MESSAGE);
}
