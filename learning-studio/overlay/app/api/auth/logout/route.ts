import { NextRequest, NextResponse } from 'next/server';

import { assertSameOrigin, publicUrl } from '@/lib/server/learning-auth-http';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  assertSameOrigin(req);
  const response = NextResponse.redirect(publicUrl(req, '/'), 303);
  response.cookies.set('sunchaser_learning', '', { path: '/', maxAge: 0 });
  response.cookies.set('anonymous_id', '', { path: '/', maxAge: 0 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
