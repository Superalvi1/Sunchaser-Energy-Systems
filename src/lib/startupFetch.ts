export const STARTUP_FETCH_TIMEOUT_MS = 12000;

export const CONNECTION_ERROR_MESSAGE =
  "Connection issue. Please check internet or try again.";

export function toConnectionError(err: unknown): Error {
  if (err instanceof Error && err.message === CONNECTION_ERROR_MESSAGE) {
    return err;
  }
  if (err instanceof Error && err.name === "AbortError") {
    return new Error(CONNECTION_ERROR_MESSAGE);
  }
  return new Error(CONNECTION_ERROR_MESSAGE);
}
