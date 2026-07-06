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
};

/** Restore staff session from JWT + /api/auth/me; clears stale local cache on 401. */
export async function restoreAuthSession(): Promise<AuthSessionRestoreResult> {
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
  } catch {
    clearAuthSession();
    return { user: null, unauthorized: true };
  }
}

export { clearAuthSession, persistAuthSession, getStoredAuthToken };
