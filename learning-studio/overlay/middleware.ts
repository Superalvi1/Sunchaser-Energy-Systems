import { NextRequest, NextResponse } from 'next/server';

import { isAgentRuntimeConfigured, isProWorkbenchEnabled } from '@/lib/config/feature-flags';
import { verifyLearningSession } from '@/lib/server/sunchaser-sso';

function unauthorizedPage(request: NextRequest): NextResponse {
  const crmUrl = String(process.env.SUNCHASER_CRM_URL || 'https://crm.sunchaserenergy.co').trim();
  try {
    return NextResponse.redirect(new URL(crmUrl));
  } catch {
    return new NextResponse('Sunchaser Learning Studio sign-in required.', { status: 401 });
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const canInspectServerRuntime = process.env.NEXT_RUNTIME !== 'edge';
  const workbenchEnabled =
    isProWorkbenchEnabled() && (!canInspectServerRuntime || isAgentRuntimeConfigured());
  if (!workbenchEnabled && (pathname === '/workbench' || pathname.startsWith('/workbench/'))) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (pathname === '/api/sunchaser-sso' || pathname === '/api/health') {
    return NextResponse.next();
  }

  const session = request.cookies.get('sunchaser_learning')?.value;
  if (session) {
    try {
      await verifyLearningSession(session);
      return NextResponse.next();
    } catch {
      // Invalid/expired sessions fall through to a fail-closed response below.
    }
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, errorCode: 'UNAUTHORIZED', error: 'Sunchaser Learning Studio session required' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return unauthorizedPage(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};
