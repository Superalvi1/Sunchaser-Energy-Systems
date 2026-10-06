import type { User } from "../types";
import {
  clearAuthSession,
  fetchAuthMe,
  getStoredAuthToken,
  getStoredUser,
  persistAuthSession,
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
};

export async function restoreAuthSessionUsing({
  getStoredAuthToken,
  getStoredUser,
  clearAuthSession,
  fetchAuthMe,
  persistAuthSession,
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
    persistAuthSession(user, token);
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
  });
}

export { clearAuthSession, persistAuthSession, getStoredAuthToken };
