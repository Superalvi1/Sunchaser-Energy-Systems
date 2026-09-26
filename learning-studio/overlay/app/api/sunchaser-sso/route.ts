import { NextRequest, NextResponse } from 'next/server';

import {
  LEARNING_SESSION_TTL_SECONDS,
  normalizeNextPath,
  signLearningSession,
  stableOwnerUuid,
  verifyCrmSsoTicket,
} from '@/lib/server/sunchaser-sso';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const token = String(form.get('token') || '');
    const next = normalizeNextPath(form.get('next'));

    const identity = await verifyCrmSsoTicket(token);
    const [sessionToken, ownerUuid] = await Promise.all([
      signLearningSession(identity),
      stableOwnerUuid(identity.sub),
    ]);

    const response = NextResponse.redirect(new URL(next, req.url), 303);
    const secure = process.env.NODE_ENV === 'production';

    response.cookies.set('sunchaser_learning', sessionToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: LEARNING_SESSION_TTL_SECONDS,
    });

    // OpenMAIC's existing owner resolution accepts UUID-v4 anonymous_id values.
    // We provide a stable, HMAC-derived UUID per CRM user so its current storage
    // layer remains partitioned by authenticated Sunchaser identity.
    response.cookies.set('anonymous_id', ownerUuid, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: LEARNING_SESSION_TTL_SECONDS,
    });

    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid or expired Sunchaser Learning Studio ticket.' },
      {
        status: 401,
        headers: {
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      },
    );
  }
}
