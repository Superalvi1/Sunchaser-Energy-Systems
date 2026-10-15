import { isPublicApiRoute } from "../../server/middleware/publicRoutes";
export const SESSION_EXPIRED_EVENT = 'sunchaser:session-expired';
export const SESSION_RESTORED_EVENT = 'sunchaser:session-restored';

/** Only a rejected current credential triggers recovery; never replay a mutation. */
export async function fetchWithSessionRecovery(
  url: string,
  init: RequestInit,
  deps: { fetch: typeof fetch; getToken: () => string | null; onUnauthorized: () => void },
): Promise<Response> {
  const sentToken = new Headers(init.headers).get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
  const response = await deps.fetch(url, init);
  const path = new URL(url, 'https://crm.invalid').pathname;
  const protectedRequest = path.startsWith('/api/') && !path.startsWith('/api/auth/') && !isPublicApiRoute(init.method || 'GET', path);
  if (response.status === 401 && protectedRequest && deps.getToken() === sentToken) deps.onUnauthorized();
  return response;
}
