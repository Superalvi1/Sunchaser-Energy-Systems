import { NextRequest, NextResponse } from 'next/server';

import {
  LEARNING_SESSION_TTL_SECONDS,
  normalizeNextPath,
  signLearningSession,
  stableOwnerUuid,
  verifyCrmSsoTicket,
} from '@/lib/server/sunchaser-sso';

export const dynamic = 'force-dynamic';

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function publicOrigin(req: NextRequest): string {
  const configured = process.env.LEARNING_PUBLIC_URL?.trim();
  if (configured) {
    const origin = normalizeOrigin(configured);
    if (origin) return origin;
  }

  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedHost) {
    const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const protocol = forwardedProto === 'http' ? 'http' : 'https';
    const origin = normalizeOrigin(`${protocol}://${forwardedHost}`);
    if (origin) return origin;
  }

  return req.nextUrl.origin;
}

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

    // Railway forwards requests to the container as http://0.0.0.0:<port>.
    // Building the redirect from req.url therefore leaks that internal address
    // to the browser. Prefer the explicit public URL, then trusted Railway
    // forwarding headers, and only fall back to the request origin.
    const response = NextResponse.redirect(new URL(next, publicOrigin(req)), 303);
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
