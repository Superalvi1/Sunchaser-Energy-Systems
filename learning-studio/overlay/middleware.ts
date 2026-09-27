import { NextRequest, NextResponse } from 'next/server';

import { isAgentRuntimeConfigured, isProWorkbenchEnabled } from '@/lib/config/feature-flags';
import { verifyLearningSession } from '@/lib/server/learning-session';

function signInPage(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = '/auth';
  url.search = '';
  url.searchParams.set('mode', 'login');
  url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const canInspectServerRuntime = process.env.NEXT_RUNTIME !== 'edge';
  const workbenchEnabled =
    isProWorkbenchEnabled() && (!canInspectServerRuntime || isAgentRuntimeConfigured());
  if (!workbenchEnabled && (pathname === '/workbench' || pathname.startsWith('/workbench/'))) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (
    pathname === '/welcome' ||
    pathname === '/auth' ||
    pathname.startsWith('/api/auth/') ||
    pathname === '/api/health' ||
    pathname === '/api/server-providers' ||
    pathname === '/api/access-code/status' ||
    /\.(?:avif|gif|ico|jpe?g|png|svg|webp|woff2?)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  const session = request.cookies.get('sunchaser_learning')?.value;
  if (session) {
    try {
      await verifyLearningSession(session);
      return NextResponse.next();
    } catch {
      // Invalid or expired sessions are handled as unauthenticated below.
    }
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, errorCode: 'UNAUTHORIZED', error: 'Learning Studio sign-in required' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (pathname === '/') {
    return NextResponse.rewrite(new URL('/welcome', request.url));
  }

  return signInPage(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};
