import { NextRequest, NextResponse } from 'next/server';

import {
  LEARNING_SESSION_TTL_SECONDS,
  type LearningIdentity,
  normalizeNextPath,
  signLearningSession,
  stableOwnerUuid,
} from '@/lib/server/learning-session';

function origin(req: NextRequest): string {
  const configured = String(process.env.LEARNING_PUBLIC_URL || '').trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fall through to the trusted proxy headers.
    }
  }
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (host) {
    const protocol = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'http'
      ? 'http'
      : 'https';
    return `${protocol}://${host}`;
  }
  return req.nextUrl.origin;
}

export function publicUrl(req: NextRequest, path: string): URL {
  return new URL(path, origin(req));
}

export function assertSameOrigin(req: NextRequest): void {
  const requestOrigin = req.headers.get('origin');
  if (!requestOrigin) return;
  if (new URL(requestOrigin).origin !== origin(req)) throw new Error('Invalid request origin');
}

export async function authenticatedRedirect(
  req: NextRequest,
  identity: LearningIdentity,
  nextValue: unknown,
): Promise<NextResponse> {
  const [session, ownerUuid] = await Promise.all([
    signLearningSession(identity),
    stableOwnerUuid(identity.sub),
  ]);
  const response = NextResponse.redirect(publicUrl(req, normalizeNextPath(nextValue)), 303);
  const secure = process.env.NODE_ENV === 'production';

  response.cookies.set('sunchaser_learning', session, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: LEARNING_SESSION_TTL_SECONDS,
  });
  response.cookies.set('anonymous_id', ownerUuid, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: LEARNING_SESSION_TTL_SECONDS,
  });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'same-origin');
  return response;
}

export function authErrorRedirect(
  req: NextRequest,
  mode: 'login' | 'register',
  error: string,
  nextValue: unknown,
): NextResponse {
  const url = publicUrl(req, '/auth');
  url.searchParams.set('mode', mode);
  url.searchParams.set('error', error);
  const next = normalizeNextPath(nextValue);
  if (next !== '/') url.searchParams.set('next', next);
  return NextResponse.redirect(url, 303);
}
