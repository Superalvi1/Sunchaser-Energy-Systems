import type { User } from "../types";
import {
  clearAuthSession,
  fetchAuthMe,
  getStoredAuthToken,
  getStoredUser,
  logoutOnServer,
  persistAuthSession,
  refreshAuthToken,
} from "../services/api";

export type AuthSessionRestoreResult = {
  user: User | null;
  unauthorized: boolean;
  temporaryFailure?: boolean;
};

/** Restore staff session from JWT + /api/auth/me; clears stale local cache on 401. */
type RestoreDependencies = {
  getStoredAuthToken: typeof getStoredAuthToken;
  getStoredUser: typeof getStoredUser;
  clearAuthSession: typeof clearAuthSession;
  fetchAuthMe: typeof fetchAuthMe;
  persistAuthSession: typeof persistAuthSession;
  refreshAuthToken?: typeof refreshAuthToken;
};

export async function restoreAuthSessionUsing({
  getStoredAuthToken,
  getStoredUser,
  clearAuthSession,
  fetchAuthMe,
  persistAuthSession,
  refreshAuthToken,
}: RestoreDependencies): Promise<AuthSessionRestoreResult> {
  const token = getStoredAuthToken();
  if (!token) {
    const cached = getStoredUser();
    if (cached) {
      clearAuthSession();
      return { user: null, unauthorized: true };
    }
    return { user: null, unauthorized: false };
  }

  try {
    const { user } = await fetchAuthMe();
    let activeToken = token;
    try {
      if (refreshAuthToken) activeToken = await refreshAuthToken();
    } catch (refreshError) {
      const refreshStatus = (refreshError as { status?: number })?.status;
      if (refreshStatus === 401 || refreshStatus === 403) {
        // The server has just ended this session (absolute limit, password changed, account disabled): sign out.
        clearAuthSession();
        return { user: null, unauthorized: true };
      }
      // Offline, rate limited or a server error: the verified token is still valid until it expires; renewal is
      // retried on the next start.
    }
    persistAuthSession(user, activeToken);
    return { user, unauthorized: false };
  } catch (error) {
    const status = (error as { status?: number })?.status;
    if (status === 401 || status === 403) {
      clearAuthSession();
      return { user: null, unauthorized: true };
    }
    // A timeout/offline/5xx must not destroy credentials, or trust a cached role.
    return { user: null, unauthorized: false, temporaryFailure: true };
  }
}

export function restoreAuthSession() {
  return restoreAuthSessionUsing({
    getStoredAuthToken,
    getStoredUser,
    clearAuthSession,
    fetchAuthMe,
    persistAuthSession,
    refreshAuthToken,
  });
}

export { clearAuthSession, persistAuthSession, getStoredAuthToken };

type LogoutDependencies = {
  getStoredAuthToken: typeof getStoredAuthToken;
  clearAuthSession: typeof clearAuthSession;
  logoutOnServer: (token: string) => Promise<boolean>;
  /** Longest the sign-out waits for the server before clearing locally anyway. */
  maxWaitMs?: number;
};

/**
 * Sign out: ask the server to revoke this device's token FIRST (the request is sent before local storage is
 * touched), then always clear local state - even when the network call fails, times out or the token is already
 * dead. Never throws; resolves with whether the server confirmed.
 */
export async function logoutSessionUsing({
  getStoredAuthToken,
  clearAuthSession,
  logoutOnServer,
  maxWaitMs = 3500,
}: LogoutDependencies): Promise<{ serverConfirmed: boolean }> {
  let serverConfirmed = false;
  try {
    const token = getStoredAuthToken();
    if (token) {
      const request = logoutOnServer(token).then((ok) => ok, () => false);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wait = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), maxWaitMs);
      });
      serverConfirmed = await Promise.race([request, wait]);
      if (timer) clearTimeout(timer);
    }
  } catch {
    // A failed network call must never block signing out on this device.
  } finally {
    clearAuthSession();
  }
  return { serverConfirmed };
}

export function logoutSession() {
  return logoutSessionUsing({ getStoredAuthToken, clearAuthSession, logoutOnServer });
}
