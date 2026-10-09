import type { User } from "../types";
import {
  clearAuthSession,
  fetchAuthMe,
  getStoredAuthToken,
  getStoredUser,
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
