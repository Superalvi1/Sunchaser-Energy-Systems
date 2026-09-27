import { NextRequest } from 'next/server';

import { authenticateLearningUser } from '@/lib/server/learning-auth-db';
import {
  assertSameOrigin,
  authenticatedRedirect,
  authErrorRedirect,
} from '@/lib/server/learning-auth-http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get('email') || '').trim().toLowerCase();
  const password = String(form.get('password') || '');
  const next = form.get('next');

  try {
    assertSameOrigin(req);
    const identity = await authenticateLearningUser(email, password);
    if (!identity) return authErrorRedirect(req, 'login', 'credentials', next);
    return authenticatedRedirect(req, identity, next);
  } catch (error) {
    console.error('Learning Studio sign-in failed', error);
    return authErrorRedirect(req, 'login', 'unavailable', next);
  }
}
